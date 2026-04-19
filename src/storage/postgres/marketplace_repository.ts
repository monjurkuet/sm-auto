import type { PoolClient } from 'pg';

import type {
  ExtractorResult,
  MarketplaceListing,
  MarketplaceListingResult,
  MarketplaceSearchResult,
  MarketplaceSellerResult
} from '../../types/contracts';
import type { ScrapeRunCompletion } from './persistence_contracts';
import { compactJson, insertArtifacts, toJsonb } from './persistence_utils';

async function replaceMarketplaceListingImages(
  client: PoolClient,
  listingId: string,
  images: MarketplaceListing['images']
): Promise<void> {
  const rows = images
    .map((image, position) => ({
      position,
      url: image.url,
      width: image.width ?? null,
      height: image.height ?? null
    }))
    .filter((row): row is { position: number; url: string; width: number | null; height: number | null } =>
      Boolean(row.url)
    );

  const activePositions = rows.map((row) => row.position);

  await client.query(
    `
      UPDATE scraper.marketplace_listing_images
      SET is_active = false, last_seen_at = now()
      WHERE listing_id = $1
        AND is_active = true
        AND NOT (position = ANY($2::int[]))
    `,
    [listingId, activePositions.length > 0 ? activePositions : [-1]]
  );

  if (rows.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO scraper.marketplace_listing_images (
        listing_id, position, url, width, height, first_seen_at, last_seen_at, is_active
      )
      SELECT
        $1, input.position, input.url, input.width, input.height, now(), now(), true
      FROM unnest($2::int[], $3::text[], $4::int[], $5::int[]) AS input(position, url, width, height)
      ON CONFLICT (listing_id, position)
      DO UPDATE SET
        url = EXCLUDED.url,
        width = COALESCE(EXCLUDED.width, scraper.marketplace_listing_images.width),
        height = COALESCE(EXCLUDED.height, scraper.marketplace_listing_images.height),
        last_seen_at = now(),
        is_active = true
    `,
    [
      listingId,
      rows.map((row) => row.position),
      rows.map((row) => row.url),
      rows.map((row) => row.width),
      rows.map((row) => row.height)
    ]
  );
}

async function replaceMarketplaceListingDeliveryOptions(
  client: PoolClient,
  listingId: string,
  deliveryOptions: string[]
): Promise<void> {
  await client.query(
    `
      UPDATE scraper.marketplace_listing_delivery_options
      SET is_active = false, last_seen_at = now()
      WHERE listing_id = $1
        AND is_active = true
        AND NOT (delivery_option = ANY($2::text[]))
    `,
    [listingId, deliveryOptions.length > 0 ? deliveryOptions : ['__none__']]
  );

  if (deliveryOptions.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO scraper.marketplace_listing_delivery_options (
        listing_id, delivery_option, first_seen_at, last_seen_at, is_active
      )
      SELECT
        $1, input.delivery_option, now(), now(), true
      FROM unnest($2::text[]) AS input(delivery_option)
      ON CONFLICT (listing_id, delivery_option)
      DO UPDATE SET last_seen_at = now(), is_active = true
    `,
    [listingId, deliveryOptions]
  );
}

async function insertMarketplaceSellerScrapeListings(
  client: PoolClient,
  scrapeRunId: string,
  listingIds: string[],
  observedAt: string | null
): Promise<void> {
  if (listingIds.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO scraper.marketplace_seller_scrape_listings (
        scrape_run_id,
        position,
        listing_id,
        observed_at
      )
      SELECT
        $1,
        input.position,
        input.listing_id,
        $2::timestamptz
      FROM unnest($3::int[], $4::text[]) AS input(position, listing_id)
    `,
    [scrapeRunId, observedAt, listingIds.map((_, index) => index), listingIds]
  );
}

async function insertMarketplaceSearchResults(
  client: PoolClient,
  scrapeRunId: string,
  observedAt: string | null,
  rows: Array<{
    position: number;
    listingId: string | null;
    sellerId: string | null;
    title: string | null;
    priceAmount: number | null;
    priceCurrency: string | null;
    priceFormatted: string | null;
    fullLocation: string | null;
    availability: string | null;
  }>
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const filteredRows = rows.filter(
    (row): row is (typeof rows)[number] & { listingId: string } => row.listingId !== null
  );

  if (filteredRows.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO scraper.marketplace_search_results (
        scrape_run_id,
        position,
        listing_id,
        seller_id,
        snapshot_title,
        snapshot_price_amount,
        snapshot_price_currency,
        snapshot_price_formatted,
        snapshot_full_location,
        snapshot_availability,
        observed_at
      )
      SELECT
        $1,
        input.position,
        input.listing_id,
        input.seller_id,
        input.snapshot_title,
        input.snapshot_price_amount,
        input.snapshot_price_currency,
        input.snapshot_price_formatted,
        input.snapshot_full_location,
        input.snapshot_availability,
        $2::timestamptz
      FROM unnest(
        $3::int[],
        $4::text[],
        $5::text[],
        $6::text[],
        $7::numeric[],
        $8::text[],
        $9::text[],
        $10::text[],
        $11::text[]
      ) AS input(
        position,
        listing_id,
        seller_id,
        snapshot_title,
        snapshot_price_amount,
        snapshot_price_currency,
        snapshot_price_formatted,
        snapshot_full_location,
        snapshot_availability
      )
      ON CONFLICT (listing_id)
      DO NOTHING
    `,
    [
      scrapeRunId,
      observedAt,
      filteredRows.map((row) => row.position),
      filteredRows.map((row) => row.listingId),
      filteredRows.map((row) => row.sellerId),
      filteredRows.map((row) => row.title),
      filteredRows.map((row) => row.priceAmount),
      filteredRows.map((row) => row.priceCurrency),
      filteredRows.map((row) => row.priceFormatted),
      filteredRows.map((row) => row.fullLocation),
      filteredRows.map((row) => row.availability)
    ]
  );
}

export async function upsertMarketplaceSeller(
  client: PoolClient,
  seller: MarketplaceListingResult['seller'] | MarketplaceSellerResult['seller'],
  latestPayload: unknown,
  fallbackSellerId?: string | null,
  scrapedAt?: string | null
): Promise<string | null> {
  const sellerId = seller.id ?? fallbackSellerId ?? null;
  if (!sellerId) {
    return null;
  }

  await client.query(
    `
      INSERT INTO scraper.marketplace_sellers (
        seller_id,
        name,
        about,
        rating,
        review_count,
        location_text,
        member_since_text,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9)
      ON CONFLICT (seller_id)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, scraper.marketplace_sellers.name),
        about = COALESCE(EXCLUDED.about, scraper.marketplace_sellers.about),
        rating = COALESCE(EXCLUDED.rating, scraper.marketplace_sellers.rating),
        review_count = COALESCE(EXCLUDED.review_count, scraper.marketplace_sellers.review_count),
        location_text = COALESCE(EXCLUDED.location_text, scraper.marketplace_sellers.location_text),
        member_since_text = COALESCE(EXCLUDED.member_since_text, scraper.marketplace_sellers.member_since_text),
        last_seen_at = now(),
        last_scraped_at = COALESCE(EXCLUDED.last_scraped_at, now()),
        latest_payload = EXCLUDED.latest_payload
    `,
    [
      sellerId,
      seller.name,
      'about' in seller ? seller.about : null,
      'rating' in seller ? seller.rating : null,
      'reviewCount' in seller ? seller.reviewCount : null,
      'location' in seller ? seller.location : null,
      'memberSince' in seller ? String(seller.memberSince ?? '') || null : null,
      scrapedAt ?? null,
      toJsonb(compactJson(latestPayload))
    ]
  );

  return sellerId;
}

export async function upsertMarketplaceListing(
  client: PoolClient,
  listing: MarketplaceListing,
  latestPayload: unknown,
  canonicalUrl?: string | null,
  sellerIdCache?: Map<string, string>,
  scrapedAt?: string | null
): Promise<string | null> {
  if (!listing.id) {
    return null;
  }

  let sellerId = listing.seller.id ?? null;
  if (sellerId && sellerIdCache?.has(sellerId)) {
    sellerId = sellerIdCache.get(sellerId) ?? sellerId;
  } else {
    sellerId = await upsertMarketplaceSeller(client, listing.seller, { seller: listing.seller }, sellerId, scrapedAt);
    if (sellerId && sellerIdCache && listing.seller.id) {
      sellerIdCache.set(listing.seller.id, sellerId);
    }
  }
  await client.query(
    `
      INSERT INTO scraper.marketplace_listings (
        listing_id,
        canonical_url,
        seller_id,
        title,
        description,
        price_amount,
        price_currency,
        price_formatted,
        city,
        full_location,
        coordinates,
        availability,
        category_id,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14, $15)
      ON CONFLICT (listing_id)
      DO UPDATE SET
        canonical_url = COALESCE(EXCLUDED.canonical_url, scraper.marketplace_listings.canonical_url),
        seller_id = COALESCE(EXCLUDED.seller_id, scraper.marketplace_listings.seller_id),
        title = COALESCE(EXCLUDED.title, scraper.marketplace_listings.title),
        description = COALESCE(EXCLUDED.description, scraper.marketplace_listings.description),
        price_amount = COALESCE(EXCLUDED.price_amount, scraper.marketplace_listings.price_amount),
        price_currency = COALESCE(EXCLUDED.price_currency, scraper.marketplace_listings.price_currency),
        price_formatted = COALESCE(EXCLUDED.price_formatted, scraper.marketplace_listings.price_formatted),
        city = COALESCE(EXCLUDED.city, scraper.marketplace_listings.city),
        full_location = COALESCE(EXCLUDED.full_location, scraper.marketplace_listings.full_location),
        coordinates = COALESCE(EXCLUDED.coordinates, scraper.marketplace_listings.coordinates),
        availability = COALESCE(EXCLUDED.availability, scraper.marketplace_listings.availability),
        category_id = COALESCE(EXCLUDED.category_id, scraper.marketplace_listings.category_id),
        last_seen_at = now(),
        last_scraped_at = COALESCE(EXCLUDED.last_scraped_at, now()),
        latest_payload = EXCLUDED.latest_payload
    `,
    [
      listing.id,
      canonicalUrl ?? null,
      sellerId,
      listing.title,
      listing.description,
      listing.price.amount,
      listing.price.currency,
      listing.price.formatted,
      listing.location.city,
      listing.location.fullLocation,
      toJsonb(listing.location.coordinates ?? null),
      listing.availability,
      listing.categoryId,
      scrapedAt ?? null,
      toJsonb(compactJson(latestPayload))
    ]
  );

  await replaceMarketplaceListingImages(client, listing.id, listing.images);
  await replaceMarketplaceListingDeliveryOptions(client, listing.id, listing.deliveryOptions);

  return listing.id;
}

export async function persistMarketplaceSearchSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<MarketplaceSearchResult>
): Promise<ScrapeRunCompletion> {
  await client.query(
    `
      INSERT INTO scraper.marketplace_search_scrapes (
        scrape_run_id,
        query,
        location_text,
        search_url,
        buy_radius,
        buy_latitude,
        buy_longitude,
        buy_vanity_page_id,
        scraped_at,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      scrapeRunId,
      result.data.query,
      result.data.location,
      result.data.searchUrl,
      result.data.searchContext?.buyLocation?.radius ?? null,
      result.data.searchContext?.buyLocation?.latitude ?? null,
      result.data.searchContext?.buyLocation?.longitude ?? null,
      result.data.searchContext?.buyLocation?.vanityPageId ?? null,
      result.data.scrapedAt,
      toJsonb(result.data)
    ]
  );

  const searchRows: Array<{
    position: number;
    listingId: string | null;
    sellerId: string | null;
    title: string | null;
    priceAmount: number | null;
    priceCurrency: string | null;
    priceFormatted: string | null;
    fullLocation: string | null;
    availability: string | null;
  }> = [];
  const sellerIdCache = new Map<string, string>();

  for (const [index, listing] of result.data.listings.entries()) {
    const listingId = await upsertMarketplaceListing(
      client,
      listing,
      listing,
      null,
      sellerIdCache,
      result.data.scrapedAt
    );
    searchRows.push({
      position: index,
      listingId,
      sellerId: listing.seller.id ?? null,
      title: listing.title,
      priceAmount: listing.price.amount,
      priceCurrency: listing.price.currency,
      priceFormatted: listing.price.formatted,
      fullLocation: listing.location.fullLocation,
      availability: listing.availability
    });
  }
  await insertMarketplaceSearchResults(client, scrapeRunId, result.data.scrapedAt, searchRows);

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    sourceUrl: result.data.searchUrl,
    outputSummary: {
      query: result.data.query,
      location: result.data.location,
      listingCount: result.data.listings.length
    }
  };
}

export async function persistMarketplaceListingSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<MarketplaceListingResult>
): Promise<ScrapeRunCompletion> {
  const sellerId = result.data.seller.id
    ? await upsertMarketplaceSeller(
        client,
        result.data.seller,
        { seller: result.data.seller },
        result.data.seller.id,
        result.data.scrapedAt
      )
    : null;

  const listingId = await upsertMarketplaceListing(
    client,
    result.data,
    result.data,
    result.data.url,
    undefined,
    result.data.scrapedAt
  );

  if (listingId && sellerId) {
    await client.query(
      'UPDATE scraper.marketplace_listings SET seller_id = COALESCE(seller_id, $2) WHERE listing_id = $1',
      [listingId, sellerId]
    );
  }

  await client.query(
    `
      INSERT INTO scraper.marketplace_listing_scrapes (
        scrape_run_id,
        listing_id,
        route_name,
        route_location,
        buy_location,
        query_names,
        scraped_at,
        target_id,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      scrapeRunId,
      listingId,
      result.data.context?.routeName ?? null,
      toJsonb(result.data.context?.routeLocation ?? null),
      toJsonb(result.data.context?.buyLocation ?? null),
      result.data.context?.queryNames ?? [],
      result.data.scrapedAt,
      result.data.context?.targetId ?? result.data.id,
      toJsonb(result.data)
    ]
  );

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: listingId,
    sourceUrl: result.data.url,
    outputSummary: {
      listingId,
      sellerId,
      title: result.data.title,
      imageCount: result.data.images.length
    }
  };
}

export async function persistMarketplaceSellerSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<MarketplaceSellerResult>
): Promise<ScrapeRunCompletion> {
  const sellerId = await upsertMarketplaceSeller(
    client,
    result.data.seller,
    result.data.seller,
    result.data.sellerId,
    result.data.scrapedAt
  );

  await client.query(
    `
      INSERT INTO scraper.marketplace_seller_scrapes (
        scrape_run_id,
        seller_id,
        route_name,
        route_location,
        buy_location,
        query_names,
        scraped_at,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      scrapeRunId,
      sellerId,
      result.data.context?.routeName ?? null,
      toJsonb(result.data.context?.routeLocation ?? null),
      toJsonb(result.data.context?.buyLocation ?? null),
      result.data.context?.queryNames ?? [],
      result.data.scrapedAt,
      toJsonb(result.data)
    ]
  );

  const listingIds: string[] = [];
  for (const listing of result.data.listings) {
    const listingId = await upsertMarketplaceListing(
      client,
      listing,
      listing,
      undefined,
      undefined,
      result.data.scrapedAt
    );
    if (listingId) {
      listingIds.push(listingId);
    }
  }
  await insertMarketplaceSellerScrapeListings(client, scrapeRunId, listingIds, result.data.scrapedAt);

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: sellerId,
    outputSummary: {
      sellerId,
      sellerName: result.data.seller.name,
      listingCount: result.data.listings.length
    }
  };
}
