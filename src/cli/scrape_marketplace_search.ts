import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractMarketplaceSearch } from '../extractors/marketplace_search_extractor';
import { buildMarketplaceSearchUrl } from '../routes/marketplace_routes';
import { createMarketplaceSearchPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('query', { type: 'string', demandOption: true })
    .option('location', { type: 'string', demandOption: true })
    .parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'marketplace-search',
    outputName: 'marketplace_search.json',
    run: (ctx) => extractMarketplaceSearch(ctx, args.query, args.location),
    persistence: createMarketplaceSearchPersistence(
      args.query,
      args.location,
      buildMarketplaceSearchUrl(args.query, args.location)
    )
  });
}

void main();
