import yargs from 'yargs/yargs';
import { closePostgresPool } from '../storage/postgres/client';
import { hideBin } from 'yargs/helpers';

import { runScrapeJob } from '../core/job_runner';
import { extractMarketplaceSeller } from '../extractors/marketplace_seller_extractor';
import { buildMarketplaceSellerUrl } from '../routes/marketplace_routes';
import { createMarketplaceSellerPersistence } from '../storage/postgres/persistence';
import { parseSharedOptions } from './shared';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('seller-id', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runScrapeJob(
    context,
    'marketplace-seller',
    'marketplace_seller.json',
    () => extractMarketplaceSeller(context, args.sellerId),
    createMarketplaceSellerPersistence(args.sellerId, buildMarketplaceSellerUrl(args.sellerId))
  );
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
