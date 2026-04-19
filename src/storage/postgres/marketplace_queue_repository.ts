import type { PoolClient } from 'pg';

export interface MarketplaceBulkSelectionOptions {
  sourceQuery?: string | null;
  sourceLocation?: string | null;
  requireListingHistory?: boolean;
}

export interface MarketplaceBulkPageOptions extends MarketplaceBulkSelectionOptions {
  limit: number;
  offset: number;
}

function buildListingScopedWhere(options: MarketplaceBulkSelectionOptions): { text: string; values: unknown[] } {
  const clauses: string[] = ['mls.listing_id IS NULL'];
  const values: unknown[] = [];

  if (options.sourceQuery) {
    values.push(options.sourceQuery);
    clauses.push(`mss.query = $${values.length}`);
  }

  if (options.sourceLocation) {
    values.push(options.sourceLocation);
    clauses.push(`mss.location_text = $${values.length}`);
  }

  return {
    text: clauses.join(' AND '),
    values
  };
}

function buildSellerScopedWhere(options: MarketplaceBulkSelectionOptions): { text: string; values: unknown[] } {
  const clauses: string[] = ['mss.seller_id IS NULL'];
  const values: unknown[] = [];

  if (options.sourceQuery) {
    values.push(options.sourceQuery);
    clauses.push(`mssrc.query = $${values.length}`);
  }

  if (options.sourceLocation) {
    values.push(options.sourceLocation);
    clauses.push(`mssrc.location_text = $${values.length}`);
  }

  if (options.requireListingHistory) {
    clauses.push('EXISTS (SELECT 1 FROM scraper.marketplace_listings mlh WHERE mlh.seller_id = ms.seller_id)');
  }

  return {
    text: clauses.join(' AND '),
    values
  };
}

async function countFromSubquery(client: PoolClient, text: string, values: unknown[]): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM (
${text}
) selected_entities`,
    values
  );
  return result.rows[0]?.count ?? 0;
}

function addLimitOffset(
  baseText: string,
  values: unknown[],
  limit: number,
  offset: number
): { text: string; values: unknown[] } {
  return {
    text: `${baseText}\nLIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    values: [...values, limit, offset]
  };
}

export async function countMarketplaceListingIdsForBulkCrawl(
  client: PoolClient,
  options: MarketplaceBulkSelectionOptions
): Promise<number> {
  if (!options.sourceQuery && !options.sourceLocation) {
    const result = await client.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM scraper.marketplace_listings ml
        LEFT JOIN scraper.marketplace_listing_scrapes mls ON mls.listing_id = ml.listing_id
        WHERE mls.listing_id IS NULL
      `
    );
    return result.rows[0]?.count ?? 0;
  }

  const where = buildListingScopedWhere(options);
  return countFromSubquery(
    client,
    `
      SELECT ml.listing_id AS entity_id, ml.last_seen_at AS sort_key
      FROM scraper.marketplace_search_scrapes mss
      JOIN scraper.marketplace_search_results msr ON msr.scrape_run_id = mss.scrape_run_id
      JOIN scraper.marketplace_listings ml ON ml.listing_id = msr.listing_id
      LEFT JOIN scraper.marketplace_listing_scrapes mls ON mls.listing_id = ml.listing_id
      WHERE ${where.text}
      GROUP BY ml.listing_id, ml.last_seen_at
    `,
    where.values
  );
}

export async function selectMarketplaceListingIdsForBulkCrawl(
  client: PoolClient,
  options: MarketplaceBulkPageOptions
): Promise<string[]> {
  if (!options.sourceQuery && !options.sourceLocation) {
    const query = addLimitOffset(
      `
        SELECT ml.listing_id AS entity_id
        FROM scraper.marketplace_listings ml
        LEFT JOIN scraper.marketplace_listing_scrapes mls ON mls.listing_id = ml.listing_id
        WHERE mls.listing_id IS NULL
        ORDER BY ml.last_seen_at DESC NULLS LAST, ml.listing_id
      `,
      [],
      options.limit,
      options.offset
    );
    const result = await client.query<{ entity_id: string }>(query.text, query.values);
    return result.rows.map((row) => row.entity_id);
  }

  const where = buildListingScopedWhere(options);
  const query = addLimitOffset(
    `
      SELECT ml.listing_id AS entity_id, ml.last_seen_at AS sort_key
      FROM scraper.marketplace_search_scrapes mss
      JOIN scraper.marketplace_search_results msr ON msr.scrape_run_id = mss.scrape_run_id
      JOIN scraper.marketplace_listings ml ON ml.listing_id = msr.listing_id
      LEFT JOIN scraper.marketplace_listing_scrapes mls ON mls.listing_id = ml.listing_id
      WHERE ${where.text}
      GROUP BY ml.listing_id, ml.last_seen_at
      ORDER BY sort_key DESC NULLS LAST, entity_id
    `,
    where.values,
    options.limit,
    options.offset
  );
  const result = await client.query<{ entity_id: string }>(query.text, query.values);
  return result.rows.map((row) => row.entity_id);
}

export async function countMarketplaceSellerIdsForBulkCrawl(
  client: PoolClient,
  options: MarketplaceBulkSelectionOptions
): Promise<number> {
  if (!options.sourceQuery && !options.sourceLocation) {
    const result = await client.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM scraper.marketplace_sellers ms
        LEFT JOIN scraper.marketplace_seller_scrapes mss ON mss.seller_id = ms.seller_id
        WHERE mss.seller_id IS NULL
      `
    );
    return result.rows[0]?.count ?? 0;
  }

  const where = buildSellerScopedWhere(options);
  return countFromSubquery(
    client,
    `
      SELECT ms.seller_id AS entity_id, ms.last_seen_at AS sort_key
      FROM scraper.marketplace_search_scrapes mssrc
      JOIN scraper.marketplace_search_results msr ON msr.scrape_run_id = mssrc.scrape_run_id
      JOIN scraper.marketplace_sellers ms ON ms.seller_id = msr.seller_id
      LEFT JOIN scraper.marketplace_seller_scrapes mss ON mss.seller_id = ms.seller_id
      WHERE ${where.text}
      GROUP BY ms.seller_id, ms.last_seen_at
    `,
    where.values
  );
}

export async function selectMarketplaceSellerIdsForBulkCrawl(
  client: PoolClient,
  options: MarketplaceBulkPageOptions
): Promise<string[]> {
  if (!options.sourceQuery && !options.sourceLocation) {
    const query = addLimitOffset(
      `
        SELECT ms.seller_id AS entity_id
        FROM scraper.marketplace_sellers ms
        LEFT JOIN scraper.marketplace_seller_scrapes mss ON mss.seller_id = ms.seller_id
        WHERE mss.seller_id IS NULL
        ORDER BY ms.last_seen_at DESC NULLS LAST, ms.seller_id
      `,
      [],
      options.limit,
      options.offset
    );
    const result = await client.query<{ entity_id: string }>(query.text, query.values);
    return result.rows.map((row) => row.entity_id);
  }

  const where = buildSellerScopedWhere(options);
  const query = addLimitOffset(
    `
      SELECT ms.seller_id AS entity_id, ms.last_seen_at AS sort_key
      FROM scraper.marketplace_search_scrapes mssrc
      JOIN scraper.marketplace_search_results msr ON msr.scrape_run_id = mssrc.scrape_run_id
      JOIN scraper.marketplace_sellers ms ON ms.seller_id = msr.seller_id
      LEFT JOIN scraper.marketplace_seller_scrapes mss ON mss.seller_id = ms.seller_id
      WHERE ${where.text}
      GROUP BY ms.seller_id, ms.last_seen_at
      ORDER BY sort_key DESC NULLS LAST, entity_id
    `,
    where.values,
    options.limit,
    options.offset
  );
  const result = await client.query<{ entity_id: string }>(query.text, query.values);
  return result.rows.map((row) => row.entity_id);
}
