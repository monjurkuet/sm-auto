export type DelayMode = 'off' | 'fixed' | 'humanized';

export type DelayOutcome = 'success' | 'failure';

export type DelayReason = 'startup-jitter' | 'fixed-delay' | 'normal-jitter' | 'burst-pause' | 'error-backoff';

export interface DelayPlannerOptions {
  delayMode: DelayMode;
  delayMs: number;
  delayJitterMs: number;
  pauseEveryMin: number;
  pauseEveryMax: number;
  pauseMinMs: number;
  pauseMaxMs: number;
  errorDelayMultiplier: number;
  seed?: number | null;
}

export interface DelayPlan {
  delayMs: number;
  reason: DelayReason;
}

export interface DelayPlannerState {
  options: DelayPlannerOptions;
  nextRandom: () => number;
  entitiesSincePause: number;
  nextPauseAfter: number;
}

const MAX_COMPUTED_DELAY_MS = 60_000;
const STARTUP_JITTER_MIN_MS = 500;
const STARTUP_JITTER_MAX_MS = 2_500;

function assertFiniteNumber(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function assertInteger(name: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  assertFiniteNumber(name, value);
  assertInteger(name, value);
  if (value < 0) {
    throw new Error(`${name} must be greater than or equal to 0`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  assertFiniteNumber(name, value);
  assertInteger(name, value);
  if (value < 1) {
    throw new Error(`${name} must be greater than or equal to 1`);
  }
}

function assertPositiveMultiplier(name: string, value: number): void {
  assertFiniteNumber(name, value);
  if (value < 1) {
    throw new Error(`${name} must be greater than or equal to 1`);
  }
}

function randomIntInclusive(nextRandom: () => number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return min + Math.floor(nextRandom() * (max - min + 1));
}

function createRandomSource(seed?: number | null): () => number {
  if (seed === undefined || seed === null) {
    return () => Math.random();
  }

  let state = Math.trunc(seed) >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function sampleBurstThreshold(options: DelayPlannerOptions, nextRandom: () => number): number {
  return randomIntInclusive(nextRandom, options.pauseEveryMin, options.pauseEveryMax);
}

export function validateDelayPlannerOptions(options: DelayPlannerOptions): DelayPlannerOptions {
  if (!['off', 'fixed', 'humanized'].includes(options.delayMode)) {
    throw new Error(`delayMode must be one of: off, fixed, humanized`);
  }

  assertNonNegativeInteger('delayMs', options.delayMs);
  assertNonNegativeInteger('delayJitterMs', options.delayJitterMs);
  assertPositiveInteger('pauseEveryMin', options.pauseEveryMin);
  assertPositiveInteger('pauseEveryMax', options.pauseEveryMax);
  assertNonNegativeInteger('pauseMinMs', options.pauseMinMs);
  assertNonNegativeInteger('pauseMaxMs', options.pauseMaxMs);
  assertPositiveMultiplier('errorDelayMultiplier', options.errorDelayMultiplier);

  if (options.pauseEveryMin > options.pauseEveryMax) {
    throw new Error('pauseEveryMin must be less than or equal to pauseEveryMax');
  }

  if (options.pauseMinMs > options.pauseMaxMs) {
    throw new Error('pauseMinMs must be less than or equal to pauseMaxMs');
  }

  if (options.seed !== undefined && options.seed !== null) {
    assertFiniteNumber('seed', options.seed);
    assertInteger('seed', options.seed);
  }

  return options;
}

export function createDelayPlanner(options: DelayPlannerOptions): DelayPlannerState {
  const normalized = validateDelayPlannerOptions(options);
  const nextRandom = createRandomSource(normalized.seed);

  return {
    options: normalized,
    nextRandom,
    entitiesSincePause: 0,
    nextPauseAfter: sampleBurstThreshold(normalized, nextRandom)
  };
}

export function sampleStartupDelay(state: DelayPlannerState): DelayPlan {
  if (state.options.delayMode !== 'humanized') {
    return { delayMs: 0, reason: 'fixed-delay' };
  }

  return {
    delayMs: Math.min(
      MAX_COMPUTED_DELAY_MS,
      randomIntInclusive(state.nextRandom, STARTUP_JITTER_MIN_MS, STARTUP_JITTER_MAX_MS)
    ),
    reason: 'startup-jitter'
  };
}

export function sampleNextDelay(state: DelayPlannerState, outcome: DelayOutcome): DelayPlan {
  const { options } = state;

  if (options.delayMode === 'off') {
    return { delayMs: 0, reason: 'normal-jitter' };
  }

  if (options.delayMode === 'fixed') {
    return { delayMs: options.delayMs, reason: 'fixed-delay' };
  }

  const jitter = randomIntInclusive(state.nextRandom, 0, options.delayJitterMs);
  let delayMs = options.delayMs + jitter;
  let reason: DelayReason = outcome === 'failure' ? 'error-backoff' : 'normal-jitter';

  if (outcome === 'failure') {
    delayMs = Math.ceil(delayMs * options.errorDelayMultiplier);
  }

  state.entitiesSincePause += 1;

  if (state.entitiesSincePause >= state.nextPauseAfter) {
    const burstDelay = randomIntInclusive(state.nextRandom, options.pauseMinMs, options.pauseMaxMs);
    delayMs = Math.max(delayMs, burstDelay);
    reason = 'burst-pause';

    state.entitiesSincePause = 0;
    state.nextPauseAfter = sampleBurstThreshold(options, state.nextRandom);
  }

  return {
    delayMs: Math.min(MAX_COMPUTED_DELAY_MS, delayMs),
    reason
  };
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
