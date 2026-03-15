import path from 'node:path';

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runScrapeJob } from '../core/job_runner';
import { extractMarketplaceListing } from '../extractors/marketplace_listing_extractor';
import { extractMarketplaceSearch } from '../extractors/marketplace_search_extractor';
import { extractMarketplaceSeller } from '../extractors/marketplace_seller_extractor';
import { extractPageInfo } from '../extractors/page_info_extractor';
import { extractPagePosts } from '../extractors/page_posts_extractor';
import { createScraperContext } from '../core/scraper_context';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('page-url', { type: 'string', demandOption: true })
    .option('query', { type: 'string', demandOption: true })
    .option('location', { type: 'string', demandOption: true })
    .option('listing-id', { type: 'string' })
    .option('seller-id', { type: 'string' })
    .option('chrome-port', { type: 'number', default: 9222 })
    .option('output-dir', { type: 'string', default: './output/smoke' })
    .option('include-artifacts', { type: 'boolean', default: true })
    .option('timeout-ms', { type: 'number', default: 90_000 })
    .option('max-scrolls', { type: 'number', default: 8 })
    .option('scroll-delay-ms', { type: 'number', default: 2000 })
    .parseSync();

  const baseContext = createScraperContext({
    chromePort: args.chromePort,
    outputDir: args.outputDir,
    includeArtifacts: args.includeArtifacts,
    timeoutMs: args.timeoutMs,
    maxScrolls: args.maxScrolls,
    scrollDelayMs: args.scrollDelayMs
  });

  const withDir = (name: string) =>
    createScraperContext({
      chromePort: baseContext.chromePort,
      outputDir: path.join(baseContext.outputDir, name),
      includeArtifacts: baseContext.includeArtifacts,
      timeoutMs: baseContext.timeoutMs,
      maxScrolls: baseContext.maxScrolls,
      scrollDelayMs: baseContext.scrollDelayMs
    });

  await runScrapeJob(withDir('page_info'), 'page-info', 'page_info.json', () =>
    extractPageInfo(withDir('page_info'), args.pageUrl)
  );

  await runScrapeJob(withDir('page_posts'), 'page-posts', 'page_posts.json', () =>
    extractPagePosts(withDir('page_posts'), args.pageUrl)
  );

  const searchResult = await runScrapeJob(withDir('marketplace_search'), 'marketplace-search', 'marketplace_search.json', () =>
    extractMarketplaceSearch(withDir('marketplace_search'), args.query, args.location)
  );

  const listingId = args.listingId ?? searchResult.data.listings[0]?.id;
  const sellerId = args.sellerId ?? searchResult.data.listings[0]?.seller.id;

  if (!listingId) {
    throw new Error('Smoke run could not determine a listing id from the search results.');
  }

  if (!sellerId) {
    throw new Error('Smoke run could not determine a seller id from the search results.');
  }

  await runScrapeJob(withDir('marketplace_listing'), 'marketplace-listing', 'marketplace_listing.json', () =>
    extractMarketplaceListing(withDir('marketplace_listing'), listingId)
  );

  await runScrapeJob(withDir('marketplace_seller'), 'marketplace-seller', 'marketplace_seller.json', () =>
    extractMarketplaceSeller(withDir('marketplace_seller'), sellerId)
  );
}

void main();
