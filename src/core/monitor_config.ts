import { readFileSync, existsSync } from 'node:path';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface LLMConfig {
  base_url: string;
  model: string;
  strong_model: string;
  context_length: number;
}

export interface DelayConfig {
  mode: 'off' | 'fixed' | 'humanized';
  base_ms: number;
  jitter_ms: number;
  burst_pause_every_min: number;
  burst_pause_every_max: number;
  burst_pause_min_ms: number;
  burst_pause_max_ms: number;
  error_backoff_multiplier: number;
}

export interface PhaseConfig {
  enabled: boolean;
  weight: number;
  max_per_run?: number;
  limit?: number;
  default_interval_hours?: number;
  max_scrolls?: number;
  min_join_interval_ms?: number;
  auto_join?: boolean;
  skip_if_questions?: boolean;
  queries?: string[];
  discovery?: {
    min_members: number;
    max_members: number;
    require_public: boolean;
    default_priority: number;
    auto_register: boolean;
  };
  stale_after_hours?: number;
}

export interface GroupOverride {
  group_id?: string;
  group_url?: string;
  skip_posts_scrape?: boolean;
  skip_join?: boolean;
  notes?: string;
}

export interface TrainingDataConfig {
  enabled: boolean;
  repo_path: string;
  push_after_export: boolean;
}

export interface ObservationConfig {
  enabled: boolean;
  repo_path: string;
  push_after_export: boolean;
}

export interface MonitorConfig {
  chrome_port: number;
  max_cycle_runtime_minutes: number;
  db_persist: boolean;
  log_dir: string;
  training_data: TrainingDataConfig;
  observations: ObservationConfig;
  llm: LLMConfig;
  delays: DelayConfig;
  phases: Record<string, PhaseConfig>;
  group_overrides: GroupOverride[];
}

const DEFAULT_CONFIG: MonitorConfig = {
  chrome_port: 9222,
  max_cycle_runtime_minutes: 45,
  db_persist: true,
  log_dir: 'output/logs',
  training_data: { enabled: true, repo_path: '/root/codebase/training-data', push_after_export: true },
  observations: { enabled: true, repo_path: '/root/codebase/hermesagent', push_after_export: true },
  llm: {
    base_url: 'https://llm.datasolved.org/v1',
    model: 'gpt-5.4-mini',
    strong_model: 'gpt-5.4',
    context_length: 262144,
  },
  delays: {
    mode: 'humanized',
    base_ms: 3000,
    jitter_ms: 2000,
    burst_pause_every_min: 4,
    burst_pause_every_max: 8,
    burst_pause_min_ms: 15000,
    burst_pause_max_ms: 45000,
    error_backoff_multiplier: 1.75,
  },
  phases: {
    info_scrape: { enabled: true, weight: 1, max_per_run: 10, default_interval_hours: 24 },
    posts_scrape: { enabled: true, weight: 4, max_per_run: 10, default_interval_hours: 6, max_scrolls: 15 },
    detail_crawl: { enabled: true, weight: 3, limit: 30 },
    join_group: { enabled: false, weight: 1, max_per_run: 3, min_join_interval_ms: 30000, auto_join: false, skip_if_questions: true },
    search_groups: { enabled: false, weight: 1, max_per_run: 3, max_scrolls: 5, queries: [], discovery: { min_members: 50, max_members: 10000000, require_public: false, default_priority: 5, auto_register: false } },
    check_membership: { enabled: true, weight: 1, max_per_run: 10, stale_after_hours: 24 },
    compute_vitality: { enabled: true, weight: 1 },
  },
  group_overrides: [],
};

export function loadConfig(configPath?: string): MonitorConfig {
  const resolvedPath = configPath ?? resolve(process.cwd(), 'group_monitor.yaml');

  if (!existsSync(resolvedPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    const parsed = parseYaml(raw) as Partial<MonitorConfig>;

    // Deep merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      delays: { ...DEFAULT_CONFIG.delays, ...parsed.delays },
      llm: { ...DEFAULT_CONFIG.llm, ...parsed.llm },
      training_data: { ...DEFAULT_CONFIG.training_data, ...parsed.training_data },
      observations: { ...DEFAULT_CONFIG.observations, ...parsed.observations },
      phases: { ...DEFAULT_CONFIG.phases, ...parsed.phases },
      group_overrides: parsed.group_overrides ?? DEFAULT_CONFIG.group_overrides,
    };
  } catch (err) {
    console.error(`[CONFIG] Failed to load ${resolvedPath}: ${err}`);
    return DEFAULT_CONFIG;
  }
}
