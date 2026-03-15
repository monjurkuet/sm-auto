import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runScrapeJob } from '../core/job_runner';
import { extractMarketplaceListing } from '../extractors/marketplace_listing_extractor';
import { buildMarketplaceListingUrl } from '../routes/marketplace_routes';
import { createMarketplaceListingPersistence } from '../storage/postgres/persistence';
import { parseSharedOptions } from './shared';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('listing-id', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runScrapeJob(context, 'marketplace-listing', 'marketplace_listing.json', () =>
    extractMarketplaceListing(context, args.listingId)
  , createMarketplaceListingPersistence(args.listingId, buildMarketplaceListingUrl(args.listingId)));
}

void main();
