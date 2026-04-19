import assert from 'node:assert/strict';
import test from 'node:test';

import { runMarketplaceBulkCommand, type MarketplaceBulkOptions } from '../src/cli/marketplace_bulk';
import type { DelayPlannerState } from '../src/cli/humanized_delay';
import type { Logger } from '../src/core/logger';
import type { ScraperContext } from '../src/core/scraper_context';
import type { ExtractorResult } from '../src/types/contracts';
import type { PostgresJobPersistence } from '../src/storage/postgres/persistence_contracts';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];

  async query(text: string, values: unknown[] = []): Promise<{ rows: Array<{ count?: number; entity_id?: string }> }> {
    this.queries.push({ text, values });

    if (/COUNT\(\*\)::int AS count/.test(text)) {
      return { rows: [{ count: 2 }] };
    }

    return { rows: [{ entity_id: 'entity-1' }, { entity_id: 'entity-2' }] };
  }
}

class FakeLogger implements Logger {
  readonly infoMessages: Array<{ message: string; details?: unknown }> = [];
  readonly warnMessages: Array<{ message: string; details?: unknown }> = [];
  readonly errorMessages: Array<{ message: string; details?: unknown }> = [];

  info(message: string, details?: unknown): void {
    this.infoMessages.push({ message, details });
  }

  warn(message: string, details?: unknown): void {
    this.warnMessages.push({ message, details });
  }

  error(message: string, details?: unknown): void {
    this.errorMessages.push({ message, details });
  }
}

function createContext(): ScraperContext {
  return {
    chromePort: 9222,
    timeoutMs: 90_000,
    maxScrolls: 8,
    scrollDelayMs: 2000,
    outputDir: '/tmp/output',
    includeArtifacts: false,
    persistDb: false,
    logger: new FakeLogger()
  };
}

function createOptions(overrides: Partial<MarketplaceBulkOptions> = {}): MarketplaceBulkOptions {
  return {
    uncrawledOnly: true,
    continueOnError: true,
    dryRun: false,
    limit: null,
    offset: 0,
    batchSize: 25,
    delayMs: 2500,
    delayMode: 'humanized',
    delayJitterMs: 0,
    pauseEveryMin: 10,
    pauseEveryMax: 10,
    pauseMinMs: 8000,
    pauseMaxMs: 25000,
    errorDelayMultiplier: 1.75,
    seed: 1,
    sourceQuery: null,
    sourceLocation: null,
    ...overrides
  };
}

function createPlanner(): DelayPlannerState {
  return {
    options: {
      delayMode: 'humanized',
      delayMs: 2500,
      delayJitterMs: 0,
      pauseEveryMin: 10,
      pauseEveryMax: 10,
      pauseMinMs: 8000,
      pauseMaxMs: 25000,
      errorDelayMultiplier: 1.75,
      seed: 1
    },
    nextRandom: () => 0,
    entitiesSincePause: 0,
    nextPauseAfter: 10
  };
}

function createPersistence(): PostgresJobPersistence<never> {
  return {
    start: {},
    persist: async () => ({ outputSummary: {} })
  };
}

test('runMarketplaceBulkCommand skips sleeping in dry run mode', async () => {
  const context = createContext();
  const plannerCalls: Array<string> = [];
  const sleepCalls: Array<number> = [];

  await runMarketplaceBulkCommand(
    context,
    createOptions({ dryRun: true }),
    {
      jobName: 'marketplace-listings-bulk',
      outputName: 'marketplace_listing.json',
      summaryFileName: 'marketplace_listings_bulk.json',
      entityLabel: 'listing',
      countCandidates: async () => 2,
      selectCandidates: async () => ['entity-1', 'entity-2'],
      buildPersistence: () => createPersistence(),
      runExtractor: async () => ({ data: {} as never }) as ExtractorResult<never>
    },
    {
      createDelayPlanner: () => {
        plannerCalls.push('created');
        return createPlanner();
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    }
  );

  assert.equal(plannerCalls.length, 0);
  assert.deepEqual(sleepCalls, []);
});

test('runMarketplaceBulkCommand records delay metrics and sleeps between entities', async () => {
  const context = createContext();
  const sleepCalls: Array<number> = [];
  const planner: DelayPlannerState = {
    options: {
      delayMode: 'humanized',
      delayMs: 2500,
      delayJitterMs: 0,
      pauseEveryMin: 10,
      pauseEveryMax: 10,
      pauseMinMs: 8000,
      pauseMaxMs: 25000,
      errorDelayMultiplier: 1.75,
      seed: 1
    },
    nextRandom: () => 0,
    entitiesSincePause: 0,
    nextPauseAfter: 10
  };

  await runMarketplaceBulkCommand(
    context,
    createOptions({ delayMode: 'humanized', delayJitterMs: 0 }),
    {
      jobName: 'marketplace-listings-bulk',
      outputName: 'marketplace_listing.json',
      summaryFileName: 'marketplace_listings_bulk.json',
      entityLabel: 'listing',
      countCandidates: async () => 2,
      selectCandidates: async () => ['entity-1', 'entity-2'],
      buildPersistence: () => createPersistence(),
      runExtractor: async () => ({ data: {} as never }) as ExtractorResult<never>
    },
    {
      createDelayPlanner: () => ({
        ...planner,
        nextRandom: () => 0,
        entitiesSincePause: 0,
        nextPauseAfter: 10
      }),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    }
  );

  assert.deepEqual(sleepCalls, [500, 2500]);
  assert.ok(
    (context.logger as FakeLogger).infoMessages.some(({ message }) =>
      message.includes('Completed marketplace-listings-bulk')
    )
  );
});

test('runMarketplaceBulkCommand does not sleep after terminal failure', async () => {
  const context = createContext();
  const sleepCalls: Array<number> = [];

  await runMarketplaceBulkCommand(
    context,
    createOptions({ continueOnError: false }),
    {
      jobName: 'marketplace-listings-bulk',
      outputName: 'marketplace_listing.json',
      summaryFileName: 'marketplace_listings_bulk.json',
      entityLabel: 'listing',
      countCandidates: async () => 2,
      selectCandidates: async () => ['entity-1', 'entity-2'],
      buildPersistence: () => createPersistence(),
      runExtractor: async (_context, entityId) => {
        if (entityId === 'entity-1') {
          throw new Error('boom');
        }

        return { data: {} as never } as ExtractorResult<never>;
      }
    },
    {
      createDelayPlanner: () => ({
        options: {
          delayMode: 'humanized',
          delayMs: 2500,
          delayJitterMs: 0,
          pauseEveryMin: 10,
          pauseEveryMax: 10,
          pauseMinMs: 8000,
          pauseMaxMs: 25000,
          errorDelayMultiplier: 1.75,
          seed: 1
        },
        nextRandom: () => 0,
        entitiesSincePause: 0,
        nextPauseAfter: 10
      }),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      }
    }
  );

  assert.deepEqual(sleepCalls, [500]);
});
