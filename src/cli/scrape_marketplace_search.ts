import yargs from 'yargs/yargs';
import { closePostgresPool } from '../storage/postgres/client';
import { hideBin } from 'yargs/helpers';

import { runScrapeJob } from '../core/job_runner';
import { extractMarketplaceSearch } from '../extractors/marketplace_search_extractor';
import { buildMarketplaceSearchUrl } from '../routes/marketplace_routes';
import { createMarketplaceSearchPersistence } from '../storage/postgres/persistence';
import { parseSharedOptions } from './shared';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('query', { type: 'string', demandOption: true })
    .option('location', { type: 'string', demandOption: true })
    .parseSync();
  const context = parseSharedOptions(process.argv);
  await runScrapeJob(
    context,
    'marketplace-search',
    'marketplace_search.json',
    () => extractMarketplaceSearch(context, args.query, args.location),
    createMarketplaceSearchPersistence(args.query, args.location, buildMarketplaceSearchUrl(args.query, args.location))
  );
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
