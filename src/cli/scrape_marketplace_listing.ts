import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractMarketplaceListing } from '../extractors/marketplace_listing_extractor';
import { buildMarketplaceListingUrl } from '../routes/marketplace_routes';
import { createMarketplaceListingPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('listing-id', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'marketplace-listing',
    outputName: 'marketplace_listing.json',
    run: (ctx) => extractMarketplaceListing(ctx, args.listingId),
    persistence: createMarketplaceListingPersistence(args.listingId, buildMarketplaceListingUrl(args.listingId))
  });
}

void main();
