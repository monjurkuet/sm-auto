import path from 'node:path';

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import type { PoolClient } from 'pg';

import { runMarketplaceBulkCommand, type MarketplaceBulkOptions } from './marketplace_bulk';
import type { DelayMode } from './humanized_delay';
import { parseSharedOptions } from './shared';
import { extractGroupPostDetail } from '../extractors/group_post_detail_extractor';
import { buildGroupPostUrl } from '../routes/facebook_routes';
import { createGroupPostDetailPersistence } from '../storage/postgres/persistence';
import {
  selectGroupPostsForDetailCrawl,
  countGroupPostsForDetailCrawl,
  type GroupPostDetailCrawlOptions
} from '../storage/postgres/group_queue_repository';
import { closePostgresPool } from '../storage/postgres/client';

// ── Candidate adapter ──
// The marketplace bulk command works with string entity IDs, but group posts
// are identified by a composite key (postId + groupId). We encode the pair as
// `postId::groupId` so it fits the string-based interface.  The adapter
// functions below translate between the queue repository's object shape and
// the bulk command's string shape.

const COMPOSITE_SEPARATOR = '::';

function encodeCompositeId(postId: string, groupId: string): string {
  return `${postId}${COMPOSITE_SEPARATOR}${groupId}`;
}

function decodeCompositeId(compositeId: string): { postId: string; groupId: string } {
  const separatorIndex = compositeId.indexOf(COMPOSITE_SEPARATOR);
  if (separatorIndex === -1) {
    throw new Error(`Invalid composite entity id: ${compositeId}`);
  }
  return {
    postId: compositeId.substring(0, separatorIndex),
    groupId: compositeId.substring(separatorIndex + COMPOSITE_SEPARATOR.length)
  };
}

// ── CLI ──

interface GroupPostDetailsBulkArgs {
  'group-id': string | null;
  'uncrawled-only': boolean;
  limit: number | null;
  offset: number;
  'batch-size': number;
  'dry-run': boolean;
  'continue-on-error': boolean;
  'fail-fast': boolean;
  'delay-mode': string;
  'delay-ms': number;
  'delay-jitter-ms': number;
  'pause-every-min': number;
  'pause-every-max': number;
  'pause-min-ms': number;
  'pause-max-ms': number;
  'error-delay-multiplier': number;
  seed: number | null;
}

async function main(): Promise<void> {
  const args: GroupPostDetailsBulkArgs = yargs(hideBin(process.argv))
    .option('group-id', { type: 'string', default: null, describe: 'Filter to a specific group ID' })
    .option('uncrawled-only', { type: 'boolean', default: true, describe: 'Only crawl posts without comment scrapes' })
    .option('limit', { type: 'number', default: null, describe: 'Max number of posts to crawl' })
    .option('offset', { type: 'number', default: 0, describe: 'Skip this many candidate posts' })
    .option('batch-size', { type: 'number', default: 25, describe: 'Page size when reading candidates from DB' })
    .option('dry-run', { type: 'boolean', default: false, describe: 'List candidates without scraping' })
    .option('continue-on-error', { type: 'boolean', default: true, describe: 'Continue to next post on failure' })
    .option('fail-fast', { type: 'boolean', default: false, describe: 'Stop on first error (overrides continue-on-error)' })
    .option('delay-mode', { type: 'string', default: 'humanized', describe: 'Delay mode: off, fixed, humanized' })
    .option('delay-ms', { type: 'number', default: 2500, describe: 'Base delay between scrapes in ms' })
    .option('delay-jitter-ms', { type: 'number', default: 1500, describe: 'Jitter added to base delay' })
    .option('pause-every-min', { type: 'number', default: 4, describe: 'Min items before a burst pause' })
    .option('pause-every-max', { type: 'number', default: 9, describe: 'Max items before a burst pause' })
    .option('pause-min-ms', { type: 'number', default: 8000, describe: 'Min burst pause duration in ms' })
    .option('pause-max-ms', { type: 'number', default: 25000, describe: 'Max burst pause duration in ms' })
    .option('error-delay-multiplier', { type: 'number', default: 1.75, describe: 'Delay multiplier after errors' })
    .option('seed', { type: 'number', default: null, describe: 'RNG seed for reproducible delay scheduling' })
    .parseSync();

  const context = parseSharedOptions(process.argv);

  const groupIdFilter = args['group-id'];

  const bulkOptions: MarketplaceBulkOptions = {
    uncrawledOnly: args['uncrawled-only'],
    continueOnError: args['fail-fast'] ? false : args['continue-on-error'],
    dryRun: args['dry-run'],
    limit: args.limit,
    offset: args.offset,
    batchSize: args['batch-size'],
    delayMode: args['delay-mode'] as DelayMode,
    delayMs: args['delay-ms'],
    delayJitterMs: args['delay-jitter-ms'],
    pauseEveryMin: args['pause-every-min'],
    pauseEveryMax: args['pause-every-max'],
    pauseMinMs: args['pause-min-ms'],
    pauseMaxMs: args['pause-max-ms'],
    errorDelayMultiplier: args['error-delay-multiplier'],
    seed: args.seed,
    sourceQuery: null,
    sourceLocation: null
  };

  await runMarketplaceBulkCommand(
    context,
    bulkOptions,
    {
      jobName: 'group-post-details-bulk',
      outputName: 'group_post_detail.json',
      summaryFileName: 'group_post_details_bulk.json',
      entityLabel: 'group-post',
      countCandidates: async (client: PoolClient, options: MarketplaceBulkOptions) => {
        const crawlOptions: GroupPostDetailCrawlOptions = {
          groupId: groupIdFilter,
          limit: null,
          offset: null
        };
        return countGroupPostsForDetailCrawl(client, crawlOptions);
      },
      selectCandidates: async (
        client: PoolClient,
        options: MarketplaceBulkOptions & { limit: number; offset: number }
      ) => {
        const crawlOptions: GroupPostDetailCrawlOptions = {
          groupId: groupIdFilter,
          limit: options.limit,
          offset: options.offset
        };
        const rows = await selectGroupPostsForDetailCrawl(client, crawlOptions);
        return rows.map((row) => encodeCompositeId(row.postId, row.groupId));
      },
      buildPersistence: (entityId: string) => {
        const { postId, groupId } = decodeCompositeId(entityId);
        const postUrl = buildGroupPostUrl(groupId, postId);
        return createGroupPostDetailPersistence(postUrl);
      },
      runExtractor: (ctx, entityId: string) => {
        const { postId, groupId } = decodeCompositeId(entityId);
        const postUrl = buildGroupPostUrl(groupId, postId);
        return extractGroupPostDetail(ctx, postUrl);
      }
    }
  );

  await closePostgresPool();
}

void main();
