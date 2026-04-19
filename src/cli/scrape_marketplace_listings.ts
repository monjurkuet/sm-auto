import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runMarketplaceBulkCommand } from './marketplace_bulk';
import type { DelayMode } from './humanized_delay';
import { parseSharedOptions } from './shared';
import { extractMarketplaceListing } from '../extractors/marketplace_listing_extractor';
import { buildMarketplaceListingUrl } from '../routes/marketplace_routes';
import { createMarketplaceListingPersistence } from '../storage/postgres/persistence';
import {
  countMarketplaceListingIdsForBulkCrawl,
  selectMarketplaceListingIdsForBulkCrawl
} from '../storage/postgres/marketplace_queue_repository';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('uncrawled-only', { type: 'boolean', default: true })
    .option('limit', { type: 'number', default: null })
    .option('offset', { type: 'number', default: 0 })
    .option('batch-size', { type: 'number', default: 25 })
    .option('dry-run', { type: 'boolean', default: false })
    .option('continue-on-error', { type: 'boolean', default: true })
    .option('fail-fast', { type: 'boolean', default: false })
    .option('delay-mode', { type: 'string', default: 'humanized' })
    .option('delay-ms', { type: 'number', default: 2500 })
    .option('delay-jitter-ms', { type: 'number', default: 1500 })
    .option('pause-every-min', { type: 'number', default: 4 })
    .option('pause-every-max', { type: 'number', default: 9 })
    .option('pause-min-ms', { type: 'number', default: 8000 })
    .option('pause-max-ms', { type: 'number', default: 25000 })
    .option('error-delay-multiplier', { type: 'number', default: 1.75 })
    .option('seed', { type: 'number', default: null })
    .option('source-query', { type: 'string', default: null })
    .option('source-location', { type: 'string', default: null })
    .parseSync();

  const context = parseSharedOptions(process.argv);
  await runMarketplaceBulkCommand(
    context,
    {
      uncrawledOnly: args.uncrawledOnly,
      continueOnError: args.failFast ? false : args.continueOnError,
      dryRun: args.dryRun,
      limit: args.limit,
      offset: args.offset,
      batchSize: args.batchSize,
      delayMode: args.delayMode as DelayMode,
      delayMs: args.delayMs,
      delayJitterMs: args.delayJitterMs,
      pauseEveryMin: args.pauseEveryMin,
      pauseEveryMax: args.pauseEveryMax,
      pauseMinMs: args.pauseMinMs,
      pauseMaxMs: args.pauseMaxMs,
      errorDelayMultiplier: args.errorDelayMultiplier,
      seed: args.seed,
      sourceQuery: args.sourceQuery,
      sourceLocation: args.sourceLocation
    },
    {
      jobName: 'marketplace-listings-bulk',
      outputName: 'marketplace_listing.json',
      summaryFileName: 'marketplace_listings_bulk.json',
      entityLabel: 'listing',
      countCandidates: countMarketplaceListingIdsForBulkCrawl,
      selectCandidates: selectMarketplaceListingIdsForBulkCrawl,
      buildPersistence: (entityId) =>
        createMarketplaceListingPersistence(entityId, buildMarketplaceListingUrl(entityId)),
      runExtractor: extractMarketplaceListing
    }
  );
}

void main();
