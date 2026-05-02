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
  deletedGroupInfoScrapes: number;
  deletedGroupPostScrapes: number;
  deletedGroupCommentScrapes: number;
  deletedGroupJoinScrapes: number;
  staleRunsMarkedFailed: number;
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

async function cleanupOldRuns(cutoffDate: Date, dryRun: boolean, verbose: boolean, statusFilter: string[] = ['completed', 'failed']): Promise<CleanupStats> {
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
    deletedSellerScrapes: 0,
    deletedGroupInfoScrapes: 0,
    deletedGroupPostScrapes: 0,
    deletedGroupCommentScrapes: 0,
    deletedGroupJoinScrapes: 0,
    staleRunsMarkedFailed: 0
  };

  const oldRuns = await query<{ id: string }>(
    `
    SELECT id FROM scraper.scrape_runs
    WHERE completed_at < $1 AND status = ANY($2::text[])
    `,
    [cutoffDate.toISOString(), statusFilter]
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

  // Group surface tables
  const groupInfoScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.facebook_group_info_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedGroupInfoScrapes = parseInt(groupInfoScrapesResult.rows[0].count, 10);

  const groupPostScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.facebook_group_post_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedGroupPostScrapes = parseInt(groupPostScrapesResult.rows[0].count, 10);

  const groupCommentScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.facebook_group_comment_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedGroupCommentScrapes = parseInt(groupCommentScrapesResult.rows[0].count, 10);

  const groupJoinScrapesResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM scraper.facebook_group_join_scrapes WHERE scrape_run_id = ANY($1::uuid[])',
    [runIds]
  );
  stats.deletedGroupJoinScrapes = parseInt(groupJoinScrapesResult.rows[0].count, 10);

  await query('DELETE FROM scraper.facebook_group_info_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.facebook_group_post_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.facebook_group_comment_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);
  await query('DELETE FROM scraper.facebook_group_join_scrapes WHERE scrape_run_id = ANY($1::uuid[])', [runIds]);

  const deleteResult = await query('DELETE FROM scraper.scrape_runs WHERE id = ANY($1::uuid[]) RETURNING id', [runIds]);
  stats.deletedRuns = deleteResult.rows.length;

  return stats;
}

function printStats(stats: CleanupStats): void {
  console.log('');
  console.log('Cleanup Summary:');
  console.log(`  Scrape runs deleted: ${stats.deletedRuns}`);
  console.log(`  Artifacts deleted: ${stats.deletedArtifacts}`);
  console.log(`  Page scrapes deleted: ${stats.deletedPageScrapes}`);
  console.log(`  Post scrapes deleted: ${stats.deletedPostScrapes}`);
  console.log(`  Post tags deleted: ${stats.deletedPostTags}`);
  console.log(`  Post media deleted: ${stats.deletedPostMedia}`);
  console.log(`  Search results deleted: ${stats.deletedSearchResults}`);
  console.log(`  Search scrapes deleted: ${stats.deletedSearchScrapes}`);
  console.log(`  Listing scrapes deleted: ${stats.deletedListingScrapes}`);
  console.log(`  Seller scrape listings: ${stats.deletedSellerScrapeListings}`);
  console.log(`  Seller scrapes deleted: ${stats.deletedSellerScrapes}`);
  console.log(`  Group info scrapes deleted: ${stats.deletedGroupInfoScrapes}`);
  console.log(`  Group post scrapes deleted: ${stats.deletedGroupPostScrapes}`);
  console.log(`  Group comment scrapes deleted: ${stats.deletedGroupCommentScrapes}`);
  console.log(`  Group join scrapes deleted: ${stats.deletedGroupJoinScrapes}`);
  if (stats.staleRunsMarkedFailed > 0) {
    console.log(`  Stale "running" runs marked failed: ${stats.staleRunsMarkedFailed}`);
  }
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
  .option('status', {
    type: 'string',
    choices: ['completed', 'failed', 'both'],
    default: 'both',
    describe: 'Only clean up runs with this status (default: both completed and failed)'
  })
  .option('stale-running', {
    type: 'boolean',
    default: false,
    describe: 'Mark "running" runs older than the cutoff as "failed" before cleanup'
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
    deletedSellerScrapes: 0,
    deletedGroupInfoScrapes: 0,
    deletedGroupPostScrapes: 0,
    deletedGroupCommentScrapes: 0,
    deletedGroupJoinScrapes: 0,
    staleRunsMarkedFailed: 0
  };

  // Mark stale "running" runs as failed if requested
  if (args.staleRunning && !args.dryRun) {
    const staleResult = await query<{ id: string }>(
      `UPDATE scraper.scrape_runs
       SET status = 'failed', error_message = 'Marked failed by cleanup: stale running run'
       WHERE status = 'running' AND started_at < $1
       RETURNING id`,
      [cutoffDate.toISOString()]
    );
    stats.staleRunsMarkedFailed = staleResult.rows.length;
    if (args.verbose && stats.staleRunsMarkedFailed > 0) {
      console.log(`Marked ${stats.staleRunsMarkedFailed} stale "running" runs as failed.`);
    }
  } else if (args.staleRunning && args.dryRun) {
    const staleCount = await query<{ count: string }>(
      `SELECT COUNT(*) FROM scraper.scrape_runs
       WHERE status = 'running' AND started_at < $1`,
      [cutoffDate.toISOString()]
    );
    const count = parseInt(staleCount.rows[0].count, 10);
    if (count > 0) {
      console.log(`DRY RUN: Would mark ${count} stale "running" runs as failed.`);
    }
  }

  // Build status filter for cleanup
  const statusFilter = args.status === 'both'
    ? ['completed', 'failed']
    : [args.status];

  const cleanupStats = await cleanupOldRuns(cutoffDate, args.dryRun, args.verbose, statusFilter);

  // Merge stale-runs count into the cleanup stats
  cleanupStats.staleRunsMarkedFailed = stats.staleRunsMarkedFailed;

  printStats(cleanupStats);
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
