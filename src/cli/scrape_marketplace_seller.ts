import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractMarketplaceSeller } from '../extractors/marketplace_seller_extractor';
import { buildMarketplaceSellerUrl } from '../routes/marketplace_routes';
import { createMarketplaceSellerPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('seller-id', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'marketplace-seller',
    outputName: 'marketplace_seller.json',
    run: (ctx) => extractMarketplaceSeller(ctx, args.sellerId),
    persistence: createMarketplaceSellerPersistence(args.sellerId, buildMarketplaceSellerUrl(args.sellerId))
  });
}

void main();
