/**
 * group_monitor.ts — Agentic Facebook Group Monitor Orchestrator
 *
 * Replaces the bash group_monitor.sh with a TypeScript orchestrator that:
 * 1. Loads YAML config (with CLI overrides)
 * 2. Queries DB for current state (groups, posts, membership)
 * 3. Builds a weighted task queue (info/posts/detail/join/search)
 * 4. Executes tasks with humanized delays
 * 5. Calls LLM for decisions during execution (join? organic? spam?)
 * 6. After cycle: exports training data + generates observations
 * 7. Pushes to git repos (training-data, hermesagent)
 *
 * Usage:
 *   bun run src/cli/group_monitor.ts [--config path.yaml] [--phase info_scrape,posts_scrape]
 *   bun run src/cli/group_monitor.ts --dry-run   # show what would be done
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { loadConfig, type MonitorConfig, type PhaseConfig } from '../core/monitor_config';
import { llmDecideJoin, llmClassifyPosts, detectLanguage } from '../core/llm_decisions';
import { sleep } from '../core/sleep';
import {
  createDelayPlanner,
  sampleNextDelay,
  type DelayPlannerState,
  type DelayOutcome,
} from './humanized_delay';
import { ensurePostgresReady } from '../storage/postgres/migrator';
import { getPostgresPool, closePostgresPool, withTransaction } from '../storage/postgres/client';
import type { PoolClient } from 'pg';
import { buildGroupUrl, buildGroupPostUrl } from '../routes/facebook_routes';
import { ConsoleLogger } from '../core/logger';

const execFile = promisify(execFileCb);

// ── Types ──

type TaskType =
  | 'info_scrape'
  | 'posts_scrape'
  | 'detail_crawl'
  | 'join_group'
  | 'search_groups'
  | 'check_membership'
  | 'compute_vitality';

interface MonitorTask {
  type: TaskType;
  groupId?: string;
  groupUrl?: string;
  groupName?: string;
  query?: string;          // for search_groups
  postId?: string;         // for detail_crawl
  permalink?: string;      // for detail_crawl
  weight: number;
}

interface TaskResult {
  task: MonitorTask;
  success: boolean;
  durationMs: number;
  error?: string;
  data?: unknown;
}

interface GroupRecord {
  group_id: string;
  name: string;
  group_url: string;
  membership_status: string | null;
  priority: number;
  is_active: boolean;
  last_info_scrape_at: Date | null;
  last_posts_scrape_at: Date | null;
  info_scrape_interval_hrs: number | null;
  posts_scrape_interval_hrs: number | null;
}

interface CycleResult {
  startTime: Date;
  endTime: Date;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  results: TaskResult[];
  trainingExported: boolean;
  observationsGenerated: boolean;
  pushedToGit: boolean;
}

// ── CLI ──

interface CliArgs {
  config?: string;
  phase?: string;
  'dry-run'?: boolean;
  'max-runtime'?: number;
  'skip-llm'?: boolean;
  'skip-export'?: boolean;
  'skip-push'?: boolean;
  verbose?: boolean;
}

function parseArgs(): CliArgs {
  return yargs(hideBin(process.argv))
    .option('config', { type: 'string', description: 'Path to YAML config file' })
    .option('phase', { type: 'string', description: 'Comma-separated phases to run (default: all enabled)' })
    .option('dry-run', { type: 'boolean', default: false, description: 'Show plan without executing' })
    .option('max-runtime', { type: 'number', description: 'Override max cycle runtime (minutes)' })
    .option('skip-llm', { type: 'boolean', default: false, description: 'Skip all LLM decision calls' })
    .option('skip-export', { type: 'boolean', default: false, description: 'Skip training data + observation export' })
    .option('skip-push', { type: 'boolean', default: false, description: 'Skip git push after export' })
    .option('verbose', { type: 'boolean', default: false, description: 'Verbose logging' })
    .strict()
    .parseSync();
}

// ── DB Queries ──

async function getActiveGroups(client: PoolClient): Promise<GroupRecord[]> {
  const result = await client.query<GroupRecord>(
    `SELECT group_id, name, group_url, membership_status, priority, is_active,
            last_info_scrape_at, last_posts_scrape_at,
            info_scrape_interval_hrs, posts_scrape_interval_hrs
     FROM scraper.facebook_group_registry
     WHERE is_active = true
     ORDER BY priority DESC, name ASC`
  );
  return result.rows;
}

async function getPostsForDetailCrawl(
  client: PoolClient,
  limit: number,
): Promise<Array<{ postId: string; groupId: string; permalink: string | null }>> {
  const result = await client.query<{
    post_id: string;
    group_id: string;
    permalink: string | null;
  }>(
    `SELECT p.post_id, p.group_id, p.permalink
     FROM scraper.facebook_group_posts p
     WHERE NOT EXISTS (
       SELECT 1 FROM scraper.facebook_group_post_scrapes ps WHERE ps.post_id = p.post_id
     )
     ORDER BY p.last_seen_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    postId: r.post_id,
    groupId: r.group_id,
    permalink: r.permalink,
  }));
}

async function getPostsForClassification(
  client: PoolClient,
  since: Date,
): Promise<Array<{
  postId: string;
  text: string | null;
  authorName: string | null;
  reactions: number | null;
  comments: number | null;
}>> {
  const result = await client.query<{
    post_id: string;
    text_content: string | null;
    author_name: string | null;
    reaction_count: number | null;
    comment_count: number | null;
  }>(
    `SELECT p.post_id, p.text_content, p.author_name,
            p.reaction_count, p.comment_count
     FROM scraper.facebook_group_posts p
     WHERE p.last_seen_at >= $1
     ORDER BY p.last_seen_at DESC
     LIMIT 50`,
    [since]
  );
  return result.rows.map((r) => ({
    postId: r.post_id,
    text: r.text_content,
    authorName: r.author_name,
    reactions: r.reaction_count,
    comments: r.comment_count,
  }));
}

// ── Task Queue Builder ──

function isOverdue(
  lastScrape: Date | null,
  intervalHours: number | null,
  defaultHours: number,
): boolean {
  if (!lastScrape) return true;
  const intervalMs = (intervalHours ?? defaultHours) * 3600_000;
  return Date.now() - lastScrape.getTime() > intervalMs;
}

function buildTaskQueue(
  groups: GroupRecord[],
  detailCandidates: Array<{ postId: string; groupId: string; permalink: string | null }>,
  config: MonitorConfig,
  phaseFilter?: Set<string>,
): MonitorTask[] {
  const tasks: MonitorTask[] = [];
  const phases = config.phases;

  for (const group of groups) {
    const groupOverride = config.group_overrides.find(
      (o) => o.group_id === group.group_id || o.group_url === group.group_url
    );

    // Info scrape
    if (phases.info_scrape?.enabled && (!phaseFilter || phaseFilter.has('info_scrape'))) {
      if (isOverdue(group.last_info_scrape_at, group.info_scrape_interval_hrs, phases.info_scrape.default_interval_hours ?? 24)) {
        tasks.push({
          type: 'info_scrape',
          groupId: group.group_id,
          groupUrl: group.group_url,
          groupName: group.name,
          weight: phases.info_scrape.weight,
        });
      }
    }

    // Posts scrape
    if (phases.posts_scrape?.enabled && (!phaseFilter || phaseFilter.has('posts_scrape'))) {
      if (isOverdue(group.last_posts_scrape_at, group.posts_scrape_interval_hrs, phases.posts_scrape.default_interval_hours ?? 6)) {
        if (!groupOverride?.skip_posts_scrape) {
          tasks.push({
            type: 'posts_scrape',
            groupId: group.group_id,
            groupUrl: group.group_url,
            groupName: group.name,
            weight: phases.posts_scrape.weight,
          });
        }
      }
    }

    // Check membership
    if (phases.check_membership?.enabled && (!phaseFilter || phaseFilter.has('check_membership'))) {
      const staleHrs = phases.check_membership.stale_after_hours ?? 24;
      if (!group.membership_status || group.membership_status === 'unknown') {
        tasks.push({
          type: 'check_membership',
          groupId: group.group_id,
          groupUrl: group.group_url,
          groupName: group.name,
          weight: phases.check_membership.weight,
        });
      }
    }

    // Join group
    if (phases.join_group?.enabled && (!phaseFilter || phaseFilter.has('join_group'))) {
      if (group.membership_status === 'not_joined' && !groupOverride?.skip_join) {
        tasks.push({
          type: 'join_group',
          groupId: group.group_id,
          groupUrl: group.group_url,
          groupName: group.name,
          weight: phases.join_group.weight,
        });
      }
    }
  }

  // Detail crawl (batch, not per-group)
  if (phases.detail_crawl?.enabled && (!phaseFilter || phaseFilter.has('detail_crawl'))) {
    const limit = phases.detail_crawl.limit ?? 30;
    for (const candidate of detailCandidates.slice(0, limit)) {
      tasks.push({
        type: 'detail_crawl',
        postId: candidate.postId,
        groupId: candidate.groupId,
        permalink: candidate.permalink ?? undefined,
        weight: phases.detail_crawl.weight,
      });
    }
  }

  // Search groups
  if (phases.search_groups?.enabled && (!phaseFilter || phaseFilter.has('search_groups'))) {
    const queries = phases.search_groups.queries ?? [];
    const maxPerRun = phases.search_groups.max_per_run ?? 3;
    for (const query of queries.slice(0, maxPerRun)) {
      tasks.push({
        type: 'search_groups',
        query,
        weight: phases.search_groups.weight,
      });
    }
  }

  // Compute vitality (single task)
  if (phases.compute_vitality?.enabled && (!phaseFilter || phaseFilter.has('compute_vitality'))) {
    tasks.push({
      type: 'compute_vitality',
      weight: phases.compute_vitality.weight,
    });
  }

  // Weighted shuffle: tasks with higher weight appear more often
  return weightedShuffle(tasks);
}

function weightedShuffle(tasks: MonitorTask[]): MonitorTask[] {
  // Expand by weight, shuffle, then deduplicate keeping first occurrence
  const expanded: { task: MonitorTask; sortKey: number }[] = [];
  for (const task of tasks) {
    const copies = Math.max(1, task.weight);
    for (let i = 0; i < copies; i++) {
      expanded.push({ task, sortKey: Math.random() });
    }
  }
  expanded.sort((a, b) => a.sortKey - b.sortKey);

  const seen = new Set<string>();
  const result: MonitorTask[] = [];
  for (const { task } of expanded) {
    const key = taskKey(task);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(task);
    }
  }
  return result;
}

function taskKey(task: MonitorTask): string {
  switch (task.type) {
    case 'info_scrape':
    case 'posts_scrape':
    case 'check_membership':
    case 'join_group':
      return `${task.type}:${task.groupId}`;
    case 'detail_crawl':
      return `detail_crawl:${task.postId}`;
    case 'search_groups':
      return `search_groups:${task.query}`;
    case 'compute_vitality':
      return 'compute_vitality';
  }
}

// ── Task Executor ──

async function executeTask(
  task: MonitorTask,
  config: MonitorConfig,
  skipLlm: boolean,
  verbose: boolean,
): Promise<TaskResult> {
  const start = Date.now();
  const logger = new ConsoleLogger();

  try {
    switch (task.type) {
      case 'info_scrape': {
        logger.info(`[INFO] Scraping group info: ${task.groupName} (${task.groupId})`);
        await runBunCli('src/cli/scrape_group_info.ts', ['--url', task.groupUrl!], config, verbose);
        break;
      }

      case 'posts_scrape': {
        logger.info(`[POSTS] Scraping group posts: ${task.groupName} (${task.groupId})`);
        const maxScrolls = config.phases.posts_scrape?.max_scrolls ?? 15;
        await runBunCli('src/cli/scrape_group_posts.ts', ['--url', task.groupUrl!, '--max-scrolls', String(maxScrolls)], config, verbose);
        break;
      }

      case 'detail_crawl': {
        const postUrl = task.permalink ?? buildGroupPostUrl(task.groupId!, task.postId!);
        logger.info(`[DETAIL] Crawling post: ${task.postId}`);
        await runBunCli('src/cli/scrape_group_post_detail.ts', ['--post-url', postUrl], config, verbose);
        break;
      }

      case 'check_membership':
      case 'join_group': {
        logger.info(`[JOIN] ${task.type === 'join_group' ? 'Joining' : 'Checking membership of'}: ${task.groupName} (${task.groupId})`);

        if (task.type === 'join_group' && !skipLlm && config.phases.join_group?.auto_join) {
          // Ask LLM whether we should join
          const pool = getPostgresPool();
          if (pool) {
            const client = await pool.connect();
            try {
              const vitalityResult = await client.query<{ vitality_score: number }>(
                `SELECT vitality_score FROM scraper.v_group_vitality WHERE group_id = $1`,
                [task.groupId]
              );
              const infoResult = await client.query<{ member_count: number; privacy_type: string }>(
                `SELECT member_count, privacy_type FROM scraper.facebook_groups WHERE group_id = $1`,
                [task.groupId]
              );
              const decision = await llmDecideJoin(config.llm, {
                name: task.groupName ?? 'Unknown',
                memberCount: infoResult.rows[0]?.member_count ?? null,
                privacyType: infoResult.rows[0]?.privacy_type ?? null,
                vitalityScore: vitalityResult.rows[0]?.vitality_score ?? null,
              });
              logger.info(`[LLM] Join decision for ${task.groupName}: ${decision.shouldJoin ? 'YES' : 'NO'} — ${decision.reason}`);
              if (!decision.shouldJoin) {
                return { task, success: true, durationMs: Date.now() - start, data: { skipped: true, reason: decision.reason } };
              }
            } finally {
              client.release();
            }
          }
        }

        await runBunCli('src/cli/scrape_group_join.ts', ['--url', task.groupUrl!], config, verbose);
        break;
      }

      case 'search_groups': {
        logger.info(`[SEARCH] Searching for groups: "${task.query}"`);
        const maxScrolls = config.phases.search_groups?.max_scrolls ?? 5;
        await runBunCli('src/cli/scrape_group_search.ts', ['--query', task.query!, '--max-scrolls', String(maxScrolls)], config, verbose);
        break;
      }

      case 'compute_vitality': {
        logger.info(`[VITALITY] Computing group vitality scores`);
        await runPythonScript('scripts/compute_group_vitality.py', [], verbose);
        break;
      }
    }

    return { task, success: true, durationMs: Date.now() - start };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`[FAIL] ${task.type} failed: ${errorMessage}`);
    return { task, success: false, durationMs: Date.now() - start, error: errorMessage };
  }
}

async function runBunCli(
  script: string,
  args: string[],
  config: MonitorConfig,
  verbose: boolean,
): Promise<void> {
  const fullArgs = [
    'run', script,
    '--chrome-port', String(config.chrome_port),
    '--persist-db', String(config.db_persist),
    ...args,
  ];
  if (verbose) {
    console.log(`  $ bun ${fullArgs.join(' ')}`);
  }
  const { stdout, stderr } = await execFile('bun', fullArgs, {
    cwd: process.cwd(),
    timeout: 120_000,
    env: { ...process.env },
  });
  if (verbose && stdout) console.log(stdout);
  if (stderr && !stderr.includes('[INFO]')) console.error(stderr);
}

async function runPythonScript(
  script: string,
  args: string[],
  verbose: boolean,
): Promise<void> {
  const { stdout, stderr } = await execFile('python3', [script, ...args], {
    cwd: process.cwd(),
    timeout: 60_000,
    env: { ...process.env },
  });
  if (verbose && stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

// ── Post-cycle: Training data export + observations ──

async function exportTrainingData(config: MonitorConfig, verbose: boolean): Promise<boolean> {
  if (!config.training_data.enabled) return false;
  try {
    console.log('[EXPORT] Exporting training data...');
    await runPythonScript('scripts/export_training_data.py', [], verbose);

    if (config.training_data.push_after_export) {
      console.log('[EXPORT] Pushing training data to git...');
      await gitPush(config.training_data.repo_path, 'auto: training data export');
    }
    return true;
  } catch (err) {
    console.error(`[EXPORT] Training data export failed: ${err}`);
    return false;
  }
}

async function generateObservations(config: MonitorConfig, verbose: boolean): Promise<boolean> {
  if (!config.observations.enabled) return false;
  try {
    console.log('[OBSERVE] Generating observations...');
    await runPythonScript('scripts/generate_observations.py', [], verbose);

    if (config.observations.push_after_export) {
      console.log('[OBSERVE] Pushing observations to git...');
      await gitPush(config.observations.repo_path, 'auto: observation generation');
    }
    return true;
  } catch (err) {
    console.error(`[OBSERVE] Observation generation failed: ${err}`);
    return false;
  }
}

async function gitPush(repoPath: string, message: string): Promise<void> {
  const { execFile: exec } = require('node:child_process');
  const execAsync = promisify(exec);

  const gitCommands: Array<[string, string[]]> = [
    ['git', ['add', '-A']],
    ['git', ['commit', '-m', message, '--allow-empty']],
    ['git', ['push']],
  ];
  for (const [cmd, cmdArgs] of gitCommands) {
    await execAsync(cmd, cmdArgs, { cwd: repoPath, timeout: 30_000 });
  }
}

// ── Post-cycle: LLM classification ──

async function classifyRecentPosts(
  config: MonitorConfig,
  cycleStart: Date,
  skipLlm: boolean,
  verbose: boolean,
): Promise<void> {
  if (skipLlm) return;

  const pool = getPostgresPool();
  if (!pool) return;

  const client = await pool.connect();
  try {
    const posts = await getPostsForClassification(client, cycleStart);
    if (posts.length === 0) {
      console.log('[LLM] No new posts to classify');
      return;
    }

    console.log(`[LLM] Classifying ${posts.length} recent posts...`);
    const classifications = await llmClassifyPosts(config.llm, posts);

    // Store classifications to a JSON file (no metadata column on posts table yet)
    const outputPath = resolve(process.cwd(), 'output/logs/post_classifications.json');
    const { writeFileSync, mkdirSync, existsSync } = require('node:fs');
    mkdirSync(resolve(process.cwd(), 'output/logs'), { recursive: true });

  let existing: Array<Record<string, unknown>> = [];
  if (existsSync(outputPath)) {
    try { existing = JSON.parse(readFileSync(outputPath, 'utf-8')); } catch { /* empty */ }
  }

  let classified = 0;
  for (let i = 0; i < posts.length && i < classifications.length; i++) {
      const post = posts[i];
      const cls = classifications[i];
      const lang = detectLanguage(post.text ?? '');
      existing.push({
        post_id: post.postId,
        language: cls.language,
        language_heuristic: lang,
        conversation_type: cls.conversation_type,
        author_type: cls.author_type,
        is_organic: cls.is_organic,
        classified_at: new Date().toISOString(),
      });
      classified++;
    }
    writeFileSync(outputPath, JSON.stringify(existing, null, 2));
    console.log(`[LLM] Classified ${classified}/${posts.length} posts`);
  } catch (err) {
    console.error(`[LLM] Post classification failed: ${err}`);
  } finally {
    client.release();
  }
}

// ── Main Cycle ──

async function runCycle(args: CliArgs): Promise<CycleResult> {
  const config = loadConfig(args.config);
  const startTime = new Date();
  const maxRuntimeMs = (args['max-runtime'] ?? config.max_cycle_runtime_minutes) * 60_000;
  const verbose = args.verbose ?? false;
  const skipLlm = args['skip-llm'] ?? false;
  const skipExport = args['skip-export'] ?? false;
  const skipPush = args['skip-push'] ?? false;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`GROUP MONITOR — Cycle starting at ${startTime.toISOString()}`);
  console.log(`Max runtime: ${maxRuntimeMs / 60_000}min | LLM: ${skipLlm ? 'OFF' : 'ON'} | Export: ${skipExport ? 'OFF' : 'ON'}`);
  console.log(`${'='.repeat(60)}\n`);

  // Parse phase filter
  let phaseFilter: Set<string> | undefined;
  if (args.phase) {
    phaseFilter = new Set(args.phase.split(',').map((p) => p.trim()));
    console.log(`Phase filter: ${[...phaseFilter].join(', ')}`);
  }

  // Init DB
  await ensurePostgresReady();
  const pool = getPostgresPool();
  if (!pool) throw new Error('Postgres not configured');

  // Build task queue
  const client = await pool.connect();
  let groups: GroupRecord[];
  let detailCandidates: Array<{ postId: string; groupId: string; permalink: string | null }>;

  try {
    groups = await getActiveGroups(client);
    console.log(`Found ${groups.length} active groups in registry`);

    const detailLimit = config.phases.detail_crawl?.limit ?? 30;
    detailCandidates = await getPostsForDetailCrawl(client, detailLimit);
    console.log(`Found ${detailCandidates.length} posts needing detail crawl`);
  } finally {
    client.release();
  }

  const tasks = buildTaskQueue(groups, detailCandidates, config, phaseFilter);
  console.log(`Built task queue: ${tasks.length} tasks`);
  console.log(`  info_scrape: ${tasks.filter((t) => t.type === 'info_scrape').length}`);
  console.log(`  posts_scrape: ${tasks.filter((t) => t.type === 'posts_scrape').length}`);
  console.log(`  detail_crawl: ${tasks.filter((t) => t.type === 'detail_crawl').length}`);
  console.log(`  join_group: ${tasks.filter((t) => t.type === 'join_group').length}`);
  console.log(`  check_membership: ${tasks.filter((t) => t.type === 'check_membership').length}`);
  console.log(`  search_groups: ${tasks.filter((t) => t.type === 'search_groups').length}`);
  console.log(`  compute_vitality: ${tasks.filter((t) => t.type === 'compute_vitality').length}`);

  if (args['dry-run']) {
    console.log('\n[DRY RUN] Task queue built. Exiting without execution.');
    for (const task of tasks) {
      const label = task.groupName ?? task.query ?? task.postId ?? '';
      console.log(`  ${task.type}: ${label}`);
    }
    return {
      startTime,
      endTime: new Date(),
      totalTasks: tasks.length,
      successfulTasks: 0,
      failedTasks: 0,
      results: [],
      trainingExported: false,
      observationsGenerated: false,
      pushedToGit: false,
    };
  }

  // Create delay planner
  const delayConfig = config.delays;
  const planner = createDelayPlanner({
    delayMode: delayConfig.mode,
    delayMs: delayConfig.base_ms,
    delayJitterMs: delayConfig.jitter_ms,
    pauseEveryMin: delayConfig.burst_pause_every_min,
    pauseEveryMax: delayConfig.burst_pause_every_max,
    pauseMinMs: delayConfig.burst_pause_min_ms,
    pauseMaxMs: delayConfig.burst_pause_max_ms,
    errorDelayMultiplier: delayConfig.error_backoff_multiplier,
  });

  // Execute tasks
  const results: TaskResult[] = [];
  let consecutiveErrors = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const label = task.groupName ?? task.query ?? task.postId ?? '';
    console.log(`\n[${i + 1}/${tasks.length}] ${task.type}: ${label}`);

    // Check runtime cap
    if (Date.now() - startTime.getTime() > maxRuntimeMs) {
      console.log('[CYCLE] Max runtime reached, stopping early');
      break;
    }

    const result = await executeTask(task, config, skipLlm, verbose);
    results.push(result);

    // Apply delay
    const outcome: DelayOutcome = result.success ? 'success' : 'failure';
    if (!result.success) consecutiveErrors++;
    else consecutiveErrors = 0;

    const delay = sampleNextDelay(planner, outcome);
    if (delay.delayMs > 0) {
      console.log(`  delay ${delay.delayMs}ms (${delay.reason})`);
      await sleep(delay.delayMs);
    }

    // Safety: too many consecutive errors → abort
    if (consecutiveErrors >= 5) {
      console.log('[CYCLE] 5 consecutive errors, aborting cycle');
      break;
    }
  }

  // Post-cycle: LLM classification
  await classifyRecentPosts(config, startTime, skipLlm, verbose);

  // Post-cycle: training data export + observations
  let trainingExported = false;
  let observationsGenerated = false;
  let pushedToGit = false;

  if (!skipExport) {
    trainingExported = await exportTrainingData(config, verbose);
    observationsGenerated = await generateObservations(config, verbose);
    pushedToGit = trainingExported || observationsGenerated;
  }

  const endTime = new Date();
  const successfulTasks = results.filter((r) => r.success).length;
  const failedTasks = results.filter((r) => !r.success).length;

  // Cycle summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CYCLE COMPLETE — ${endTime.toISOString()}`);
  console.log(`Duration: ${((endTime.getTime() - startTime.getTime()) / 60_000).toFixed(1)}min`);
  console.log(`Tasks: ${successfulTasks} ok / ${failedTasks} fail / ${results.length} total`);
  console.log(`Training data: ${trainingExported ? 'exported' : 'skipped'}`);
  console.log(`Observations: ${observationsGenerated ? 'generated' : 'skipped'}`);
  console.log(`Git push: ${pushedToGit ? 'done' : 'skipped'}`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    startTime,
    endTime,
    totalTasks: results.length,
    successfulTasks,
    failedTasks,
    results,
    trainingExported,
    observationsGenerated,
    pushedToGit,
  };
}

// ── Entry Point ──

async function main(): Promise<void> {
  const args = parseArgs();

  try {
    const result = await runCycle(args);

    // Write cycle result to log
    const logDir = resolve(process.cwd(), 'output/logs');
    const logFile = resolve(logDir, `cycle_${result.startTime.toISOString().replace(/[:.]/g, '-')}.json`);
    const { writeFileSync, mkdirSync } = require('node:fs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(logFile, JSON.stringify(result, null, 2));
    console.log(`Cycle log: ${logFile}`);

    // Exit with error code if too many failures
    if (result.failedTasks > result.successfulTasks && result.totalTasks > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Fatal error: ${err}`);
    process.exitCode = 2;
  } finally {
    await closePostgresPool();
  }
}

void main();
