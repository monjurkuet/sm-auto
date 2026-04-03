import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { query, closePostgresPool } from '../storage/postgres/client';
import { ensurePostgresReady } from '../storage/postgres/migrator';

interface CleanupStats {
  deletedRuns: number;
  deletedArtifacts: number;
  deletedPageScrapes: number;
  deletedPostScrapes: number;
  deletedPostTags: number;
  deletedPostMedia: number;
  deletedSearchResults: number;
  deletedSearchScrapes: number;
  deletedListingScrapes: number;
  deletedListingImages: number;
  deletedListingDeliveryOptions: number;
  deletedSellerScrapeListings: number;
  deletedSellerScrapes: number;
}

async function parseDuration(value: string): Promise<number> {
  const match = value.match(/^(\d+)([dhms])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${value}. Use format like "30d", "24h", "3600s".`);
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 's':
      return amount * 1000;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

async function cleanupOldRuns(cutoffDate: Date, dryRun: boolean, verbose: boolean): Promise<CleanupStats> {
  const stats: CleanupStats = {
    deletedRuns: 0,
    deletedArtifacts: 0,
    deletedPageScrapes: 0,
    deletedPostScrapes: 0,
    deletedPostTags: 0,
    deletedPostMedia: 0,
    deletedSearchResults: 0,
    deletedSearchScrapes: 0,
    deletedListingScrapes: 0,
    deletedListingImages: 0,
    deletedListingDeliveryOptions: 0,
    deletedSellerScrapeListings: 0,
    deletedSellerScrapes: 0
  };

  const oldRuns = await query<{ id: string }>(
    `
      SELECT id FROM scraper.scrape_runs
      WHERE completed_at < $1 AND status IN ('completed', 'failed')
    `,
    [cutoffDate.toISOString()]
  );

  if (oldRuns.rows.length === 0) {
    if (verbose) {
      console.log('No old scrape runs found for cleanup.');
    }
    return stats;
  }

  if (verbose) {
    console.log(`Found ${oldRuns.rows.length} old scrape runs to clean up.`);
  }

  if (dryRun) {
    if (verbose) {
      console.log('DRY RUN: Would delete the following scrape runs:');
      for (const row of oldRuns.rows) {
        console.log(`  - ${row.id}`);
      }
    }
    return { ...stats, deletedRuns: oldRuns.rows.length };
  }

  const runIds = oldRuns.rows.map((r) => r.id);

  const artifactsResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.scrape_artifacts WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedArtifacts = parseInt(artifactsResult.rows[0].count, 10);

  const pageScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.facebook_page_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedPageScrapes = parseInt(pageScrapesResult.rows[0].count, 10);

  const postScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.facebook_post_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedPostScrapes = parseInt(postScrapesResult.rows[0].count, 10);

  const postTagsResult = await query<{ count: string }>(
    `
      SELECT COUNT(*) FROM scraper.facebook_post_tags fpt
      JOIN scraper.facebook_post_scrapes fps ON fps.id = fpt.post_scrape_id
      WHERE fps.scrape_run_id = ANY($1::uuid[])
    `,
    [runIds]
  );
  stats.deletedPostTags = parseInt(postTagsResult.rows[0].count, 10);

  const postMediaResult = await query<{ count: string }>(
    `
      SELECT COUNT(*) FROM scraper.facebook_post_media fpm
      JOIN scraper.facebook_post_scrapes fps ON fps.id = fpm.post_scrape_id
      WHERE fps.scrape_run_id = ANY($1::uuid[])
    `,
    [runIds]
  );
  stats.deletedPostMedia = parseInt(postMediaResult.rows[0].count, 10);

  const searchResultsResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.marketplace_search_results WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedSearchResults = parseInt(searchResultsResult.rows[0].count, 10);

  const searchScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.marketplace_search_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedSearchScrapes = parseInt(searchScrapesResult.rows[0].count, 10);

  const listingScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.marketplace_listing_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedListingScrapes = parseInt(listingScrapesResult.rows[0].count, 10);

  const sellerScrapeListingsResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.marketplace_seller_scrape_listings WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedSellerScrapeListings = parseInt(sellerScrapeListingsResult.rows[0].count, 10);

  const sellerScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.marketplace_seller_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedSellerScrapes = parseInt(sellerScrapesResult.rows[0].count, 10);

  await query('DELETE FROM scraper.scrape_artifacts WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.facebook_page_transparency_history WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.facebook_page_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);

  await query(
    `
      DELETE FROM scraper.facebook_post_tags
      WHERE post_scrape_id IN (
        SELECT id FROM scraper.facebook_post_scrapes WHERE scrape_run_id = ANY($1::uuid[])
      )
    `,
    [runIds]
  );

  await query(
    `
      DELETE FROM scraper.facebook_post_media
      WHERE post_scrape_id IN (
        SELECT id FROM scraper.facebook_post_scrapes WHERE scrape_run_id = ANY($1::uuid[])
      )
    `,
    [runIds]
  );

  await query('DELETE FROM scraper.facebook_post_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.marketplace_search_results WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.marketplace_search_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.marketplace_listing_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.marketplace_seller_scrape_listings WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.marketplace_seller_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);

  const deleteResult = await query('DELETE FROM scraper.scrape_runs WHERE id = ANY($1::uuid[]) RETURNING id', [runIds]);
  stats.deletedRuns = deleteResult.rows.length;

  return stats;
}

function printStats(stats: CleanupStats): void {
  console.log('');
  console.log('Cleanup Summary:');
  console.log(`  Scrape runs deleted:          ${stats.deletedRuns}`);
  console.log(`  Artifacts deleted:            ${stats.deletedArtifacts}`);
  console.log(`  Page scrapes deleted:         ${stats.deletedPageScrapes}`);
  console.log(`  Post scrapes deleted:         ${stats.deletedPostScrapes}`);
  console.log(`  Post tags deleted:            ${stats.deletedPostTags}`);
  console.log(`  Post media deleted:           ${stats.deletedPostMedia}`);
  console.log(`  Search results deleted:       ${stats.deletedSearchResults}`);
  console.log(`  Search scrapes deleted:       ${stats.deletedSearchScrapes}`);
  console.log(`  Listing scrapes deleted:      ${stats.deletedListingScrapes}`);
  console.log(`  Seller scrape listings:       ${stats.deletedSellerScrapeListings}`);
  console.log(`  Seller scrapes deleted:       ${stats.deletedSellerScrapes}`);
}

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('older-than', {
      type: 'string',
      demandOption: true,
      describe: 'Delete runs older than this duration (e.g., "30d", "24h", "3600s")'
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Show what would be deleted without actually deleting'
    })
    .option('verbose', {
      type: 'boolean',
      default: false,
      describe: 'Verbose output'
    })
    .parseSync();

  const cutoffDate = new Date(Date.now() - (await parseDuration(args.olderThan)));

  if (args.verbose) {
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
    console.log(`Dry run: ${args.dryRun}`);
  }

  await ensurePostgresReady();
  const stats = await cleanupOldRuns(cutoffDate, args.dryRun, args.verbose);
  printStats(stats);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
