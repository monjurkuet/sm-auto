import path from 'node:path';

import type { PoolClient } from 'pg';

import { runScrapeJob } from '../core/job_runner';
import { createChildScraperContext, type ScraperContext } from '../core/scraper_context';
import { writeJsonFile } from '../storage/json_writer';
import { ensurePostgresReady } from '../storage/postgres/migrator';
import { withTransaction } from '../storage/postgres/client';
import type { ExtractorResult } from '../types/contracts';
import type { PostgresJobPersistence } from '../storage/postgres/persistence_contracts';
import {
  createDelayPlanner,
  sleep,
  sampleNextDelay,
  sampleStartupDelay,
  type DelayMode,
  type DelayPlannerOptions,
  type DelayPlannerState,
  type DelayOutcome
} from './humanized_delay';

export interface MarketplaceBulkOptions {
  uncrawledOnly: boolean;
  continueOnError: boolean;
  dryRun: boolean;
  limit: number | null;
  offset: number;
  batchSize: number;
  delayMs: number;
  delayMode: DelayMode;
  delayJitterMs: number;
  pauseEveryMin: number;
  pauseEveryMax: number;
  pauseMinMs: number;
  pauseMaxMs: number;
  errorDelayMultiplier: number;
  seed?: number | null;
  sourceQuery: string | null;
  sourceLocation: string | null;
  requireListingHistory?: boolean;
}

export interface MarketplaceBulkSummary {
  startedAt: string;
  finishedAt: string;
  mode: 'uncrawled-only';
  sourceQuery: string | null;
  sourceLocation: string | null;
  delayMode: DelayMode;
  baseDelayMs: number;
  delayJitterMs: number;
  burstPauseCount: number;
  errorBackoffCount: number;
  totalDelayMs: number;
  candidateCount: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: Array<{ entityId: string; error: string }>;
}

export interface MarketplaceBulkCommand<T> {
  jobName: string;
  outputName: string;
  summaryFileName: string;
  entityLabel: string;
  countCandidates: (client: PoolClient, options: MarketplaceBulkOptions) => Promise<number>;
  selectCandidates: (
    client: PoolClient,
    options: MarketplaceBulkOptions & { limit: number; offset: number }
  ) => Promise<string[]>;
  buildPersistence: (entityId: string) => PostgresJobPersistence<T>;
  runExtractor: (context: ScraperContext, entityId: string) => Promise<ExtractorResult<T>>;
}

export interface MarketplaceBulkDependencies {
  createDelayPlanner?: (options: DelayPlannerOptions) => DelayPlannerState;
  sleep?: typeof sleep;
  ensurePostgresReady?: typeof ensurePostgresReady;
  withTransaction?: typeof withTransaction;
  writeJsonFile?: typeof writeJsonFile;
  runScrapeJob?: typeof runScrapeJob;
}

interface BulkEntityLabel {
  entityLabel: string;
}

async function readCandidates<T>(
  options: MarketplaceBulkOptions,
  transaction: typeof withTransaction,
  selectCandidates: (
    client: PoolClient,
    selection: MarketplaceBulkOptions & { limit: number; offset: number }
  ) => Promise<string[]>,
  totalLimit: number
): Promise<string[]> {
  const ids: string[] = [];
  let offset = options.offset;

  while (ids.length < totalLimit) {
    const pageLimit = Math.min(options.batchSize, totalLimit - ids.length);
    const pageIds = await transaction((client) =>
      selectCandidates(client, {
        ...options,
        limit: pageLimit,
        offset
      })
    );

    if (pageIds.length === 0) {
      break;
    }

    ids.push(...pageIds);
    offset += pageIds.length;

    if (pageIds.length < pageLimit) {
      break;
    }
  }

  return ids;
}

function buildDelayPlannerOptions(options: MarketplaceBulkOptions): DelayPlannerOptions {
  return {
    delayMode: options.delayMode,
    delayMs: options.delayMs,
    delayJitterMs: options.delayJitterMs,
    pauseEveryMin: options.pauseEveryMin,
    pauseEveryMax: options.pauseEveryMax,
    pauseMinMs: options.pauseMinMs,
    pauseMaxMs: options.pauseMaxMs,
    errorDelayMultiplier: options.errorDelayMultiplier,
    seed: options.seed ?? null
  };
}

function createSummary(options: MarketplaceBulkOptions, candidateCount: number): MarketplaceBulkSummary {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    mode: 'uncrawled-only',
    sourceQuery: options.sourceQuery,
    sourceLocation: options.sourceLocation,
    delayMode: options.delayMode,
    baseDelayMs: options.delayMs,
    delayJitterMs: options.delayJitterMs,
    burstPauseCount: 0,
    errorBackoffCount: 0,
    totalDelayMs: 0,
    candidateCount,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    failures: []
  };
}

function logDelay(
  context: ScraperContext,
  command: BulkEntityLabel,
  mode: DelayMode,
  delayMs: number,
  reason: string
): void {
  if (delayMs > 0) {
    context.logger.info(`Waiting ${delayMs}ms before next ${command.entityLabel} (mode=${mode}, reason=${reason})`);
  }
}

export async function runMarketplaceBulkCommand<T>(
  context: ScraperContext,
  options: MarketplaceBulkOptions,
  command: MarketplaceBulkCommand<T>,
  dependencies: MarketplaceBulkDependencies = {}
): Promise<void> {
  const ensureReady = dependencies.ensurePostgresReady ?? ensurePostgresReady;
  const transaction = dependencies.withTransaction ?? withTransaction;
  const jsonWriter = dependencies.writeJsonFile ?? writeJsonFile;
  const scrapeJobRunner = dependencies.runScrapeJob ?? runScrapeJob;

  await ensureReady();

  const candidateCount = await transaction((client) => command.countCandidates(client, options));
  const effectiveLimit = options.limit === null ? candidateCount : Math.min(options.limit, candidateCount);
  const candidateIds = await readCandidates(options, transaction, command.selectCandidates, effectiveLimit);
  const summary = createSummary(options, candidateCount);
  const planner = options.dryRun
    ? null
    : (dependencies.createDelayPlanner ?? createDelayPlanner)(buildDelayPlannerOptions(options));
  const sleeper = dependencies.sleep ?? sleep;

  context.logger.info(`Selected ${candidateCount} ${command.entityLabel} ids`);

  if (options.dryRun) {
    summary.skipped = candidateIds.length;
    summary.finishedAt = new Date().toISOString();
    await jsonWriter(context.outputDir, command.summaryFileName, summary);
    context.logger.info(`Dry run selected ${candidateIds.length} ${command.entityLabel} ids`, candidateIds);
    return;
  }

  if (planner) {
    const startupDelay = sampleStartupDelay(planner);
    if (startupDelay.delayMs > 0) {
      summary.totalDelayMs += startupDelay.delayMs;
      logDelay(context, command, options.delayMode, startupDelay.delayMs, startupDelay.reason);
      await sleeper(startupDelay.delayMs);
    }
  }

  for (const [index, entityId] of candidateIds.entries()) {
    context.logger.info(`[${index + 1}/${candidateIds.length}] Scraping ${command.entityLabel} ${entityId}`);
    let outcome: DelayOutcome = 'success';

    try {
      const entityContext = createChildScraperContext(context, path.join(context.outputDir, command.jobName, entityId));
      await scrapeJobRunner(
        entityContext,
        `${command.jobName}-${entityId}`,
        command.outputName,
        () => command.runExtractor(entityContext, entityId),
        command.buildPersistence(entityId)
      );
      summary.attempted += 1;
      summary.succeeded += 1;
    } catch (error) {
      summary.attempted += 1;
      summary.failed += 1;
      summary.failures.push({ entityId, error: error instanceof Error ? error.message : String(error) });
      context.logger.warn(`Failed to scrape ${command.entityLabel} ${entityId}`, error);
      outcome = 'failure';
      if (!options.continueOnError) {
        break;
      }
    }

    if (planner && index < candidateIds.length - 1) {
      const plannedDelay = sampleNextDelay(planner, outcome);
      if (plannedDelay.reason === 'burst-pause') {
        summary.burstPauseCount += 1;
      }
      if (plannedDelay.reason === 'error-backoff') {
        summary.errorBackoffCount += 1;
      }
      if (plannedDelay.delayMs > 0) {
        summary.totalDelayMs += plannedDelay.delayMs;
        logDelay(context, command, options.delayMode, plannedDelay.delayMs, plannedDelay.reason);
        await sleeper(plannedDelay.delayMs);
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  await jsonWriter(context.outputDir, command.summaryFileName, summary);
  context.logger.info(
    `Completed ${command.jobName}: succeeded=${summary.succeeded} failed=${summary.failed} skipped=${summary.skipped}`,
    {
      delayMode: summary.delayMode,
      baseDelayMs: summary.baseDelayMs,
      delayJitterMs: summary.delayJitterMs,
      burstPauseCount: summary.burstPauseCount,
      errorBackoffCount: summary.errorBackoffCount,
      totalDelayMs: summary.totalDelayMs
    }
  );
}
