import type { PoolClient } from 'pg';

import { SCHEMA_VERSIONS } from '../schema_versions';
import type {
  ExtractorResult,
  MarketplaceListing,
  MarketplaceListingResult,
  MarketplaceSearchResult,
  MarketplaceSellerResult,
  PageInfoResult,
  PagePost,
  PagePostsResult
} from '../../types/contracts';

export type ScrapeSurface = 'page_info' | 'page_posts' | 'marketplace_search' | 'marketplace_listing' | 'marketplace_seller';

export interface ScrapeRunStartInput {
  surface: ScrapeSurface;
  schemaVersion: string;
  entityExternalId?: string | null;
  sourceUrl?: string | null;
  inputPayload: Record<string, unknown>;
}

export interface ScrapeRunCompletion {
  entityExternalId?: string | null;
  sourceUrl?: string | null;
  outputSummary: Record<string, unknown>;
}

export interface PostgresJobPersistence<T> {
  start: ScrapeRunStartInput;
  persist: (client: PoolClient, scrapeRunId: string, result: ExtractorResult<T>) => Promise<ScrapeRunCompletion>;
}

function compactJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function toIsoTimestamp(value: number | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const millis = value > 1_000_000_000_000 ? value : value * 1000;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function startScrapeRun(client: PoolClient, input: ScrapeRunStartInput): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO scraper.scrape_runs (
        surface,
        status,
        entity_external_id,
        source_url,
        schema_version,
        input_payload
      ) VALUES ($1, 'running', $2, $3, $4, $5)
      RETURNING id
    `,
    [input.surface, input.entityExternalId ?? null, input.sourceUrl ?? null, input.schemaVersion, toJsonb(input.inputPayload)]
  );

  return inserted.rows[0].id;
}

async function completeScrapeRun(client: PoolClient, scrapeRunId: string, completion: ScrapeRunCompletion): Promise<void> {
  await client.query(
    `
      UPDATE scraper.scrape_runs
      SET
        status = 'completed',
        entity_external_id = COALESCE($2, entity_external_id),
        source_url = COALESCE($3, source_url),
        output_summary = $4,
        completed_at = now()
      WHERE id = $1
    `,
    [scrapeRunId, completion.entityExternalId ?? null, completion.sourceUrl ?? null, toJsonb(completion.outputSummary)]
  );
}

export async function failScrapeRun(client: PoolClient, scrapeRunId: string, errorMessage: string): Promise<void> {
  await client.query(
    `
      UPDATE scraper.scrape_runs
      SET
        status = 'failed',
        error_message = $2,
        completed_at = now()
      WHERE id = $1
    `,
    [scrapeRunId, errorMessage]
  );
}

async function insertArtifacts(client: PoolClient, scrapeRunId: string, artifacts?: Record<string, unknown>): Promise<void> {
  if (!artifacts) {
    return;
  }

  for (const [name, value] of Object.entries(artifacts)) {
    if (typeof value === 'string') {
      await client.query(
        `
          INSERT INTO scraper.scrape_artifacts (
            scrape_run_id,
            artifact_name,
            artifact_format,
            payload_text
          ) VALUES ($1, $2, 'text', $3)
          ON CONFLICT (scrape_run_id, artifact_name)
          DO UPDATE SET payload_text = EXCLUDED.payload_text, artifact_format = EXCLUDED.artifact_format
        `,
        [scrapeRunId, name, value]
      );
      continue;
    }

    await client.query(
      `
        INSERT INTO scraper.scrape_artifacts (
          scrape_run_id,
          artifact_name,
          artifact_format,
          payload
        ) VALUES ($1, $2, 'json', $3)
        ON CONFLICT (scrape_run_id, artifact_name)
        DO UPDATE SET payload = EXCLUDED.payload, artifact_format = EXCLUDED.artifact_format
      `,
      [scrapeRunId, name, toJsonb(value)]
    );
  }
}

async function upsertFacebookPage(client: PoolClient, page: PageInfoResult): Promise<string | null> {
  if (!page.pageId) {
    return null;
  }

  await client.query(
    `
      INSERT INTO scraper.facebook_pages (
        page_id,
        canonical_url,
        name,
        category,
        followers,
        creation_date_text,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
      ON CONFLICT (page_id)
      DO UPDATE SET
        canonical_url = COALESCE(EXCLUDED.canonical_url, scraper.facebook_pages.canonical_url),
        name = COALESCE(EXCLUDED.name, scraper.facebook_pages.name),
        category = COALESCE(EXCLUDED.category, scraper.facebook_pages.category),
        followers = COALESCE(EXCLUDED.followers, scraper.facebook_pages.followers),
        creation_date_text = COALESCE(EXCLUDED.creation_date_text, scraper.facebook_pages.creation_date_text),
        last_seen_at = now(),
        last_scraped_at = EXCLUDED.last_scraped_at,
        latest_payload = EXCLUDED.latest_payload
    `,
    [
      page.pageId,
      page.url,
      page.name,
      page.category,
      page.followers,
      page.transparency.creationDate,
      page.scrapedAt,
      toJsonb(page)
    ]
  );

  return page.pageId;
}

async function upsertFacebookPageStub(client: PoolClient, pageId: string, pageUrl: string): Promise<void> {
  await client.query(
    `
      INSERT INTO scraper.facebook_pages (
        page_id,
        canonical_url,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, now(), now(), $3)
      ON CONFLICT (page_id)
      DO UPDATE SET
        canonical_url = COALESCE(EXCLUDED.canonical_url, scraper.facebook_pages.canonical_url),
        last_seen_at = now(),
        last_scraped_at = now()
    `,
    [pageId, pageUrl, toJsonb({ pageId, url: pageUrl })]
  );
}

async function upsertFacebookPageContacts(client: PoolClient, pageId: string, page: PageInfoResult): Promise<void> {
  await client.query('UPDATE scraper.facebook_page_contacts SET is_active = false WHERE page_id = $1', [pageId]);

  const contactGroups: Array<{ type: 'phone' | 'email' | 'website' | 'address'; values: string[] }> = [
    { type: 'phone', values: page.contact.phones },
    { type: 'email', values: page.contact.emails },
    { type: 'website', values: page.contact.websites },
    { type: 'address', values: page.contact.addresses }
  ];

  for (const group of contactGroups) {
    for (const value of group.values.filter(Boolean)) {
      await client.query(
        `
          INSERT INTO scraper.facebook_page_contacts (
            page_id,
            contact_type,
            contact_value,
            last_seen_at,
            is_active
          ) VALUES ($1, $2, $3, now(), true)
          ON CONFLICT (page_id, contact_type, contact_value)
          DO UPDATE SET last_seen_at = now(), is_active = true
        `,
        [pageId, group.type, value]
      );
    }
  }
}

async function persistPageInfoSurface(client: PoolClient, scrapeRunId: string, result: ExtractorResult<PageInfoResult>): Promise<ScrapeRunCompletion> {
  const pageId = await upsertFacebookPage(client, result.data);
  if (pageId) {
    await upsertFacebookPageContacts(client, pageId, result.data);
  }

  await client.query(
    `
      INSERT INTO scraper.facebook_page_scrapes (
        scrape_run_id,
        page_id,
        page_url,
        page_name,
        category,
        followers,
        creation_date_text,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      scrapeRunId,
      pageId,
      result.data.url,
      result.data.name,
      result.data.category,
      result.data.followers,
      result.data.transparency.creationDate,
      toJsonb(result.data)
    ]
  );

  for (const [index, historyText] of result.data.transparency.history.entries()) {
    await client.query(
      `
        INSERT INTO scraper.facebook_page_transparency_history (
          scrape_run_id,
          position,
          history_text
        ) VALUES ($1, $2, $3)
      `,
      [scrapeRunId, index, historyText]
    );
  }

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: pageId,
    sourceUrl: result.data.url,
    outputSummary: {
      pageId,
      name: result.data.name,
      followers: result.data.followers,
      contactCount:
        result.data.contact.phones.length +
        result.data.contact.emails.length +
        result.data.contact.websites.length +
        result.data.contact.addresses.length
    }
  };
}

async function findFacebookPostRecordId(client: PoolClient, post: PagePost): Promise<number | null> {
  const lookups: Array<[string, string | null]> = [
    ['external_post_id', post.postId],
    ['story_id', post.id],
    ['permalink', post.permalink]
  ];

  for (const [column, value] of lookups) {
    if (!value) {
      continue;
    }

    const existing = await client.query<{ id: number }>(`SELECT id FROM scraper.facebook_posts WHERE ${column} = $1 LIMIT 1`, [value]);
    if (existing.rows[0]?.id) {
      return existing.rows[0].id;
    }
  }

  return null;
}

async function upsertFacebookPost(client: PoolClient, pageId: string | null, post: PagePost): Promise<number> {
  const existingId = await findFacebookPostRecordId(client, post);
  const createdAt = toIsoTimestamp(post.createdAt);

  if (!existingId) {
    const inserted = await client.query<{ id: number }>(
      `
        INSERT INTO scraper.facebook_posts (
          external_post_id,
          story_id,
          permalink,
          page_id,
          author_id,
          author_name,
          created_at,
          body_text,
          last_seen_at,
          last_scraped_at,
          latest_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), $9)
        RETURNING id
      `,
      [post.postId, post.id, post.permalink, pageId, post.author.id, post.author.name, createdAt, post.text, toJsonb(post)]
    );
    return inserted.rows[0].id;
  }

  await client.query(
    `
      UPDATE scraper.facebook_posts
      SET
        external_post_id = COALESCE($2, external_post_id),
        story_id = COALESCE($3, story_id),
        permalink = COALESCE($4, permalink),
        page_id = COALESCE($5, page_id),
        author_id = COALESCE($6, author_id),
        author_name = COALESCE($7, author_name),
        created_at = COALESCE($8, created_at),
        body_text = COALESCE($9, body_text),
        last_seen_at = now(),
        last_scraped_at = now(),
        latest_payload = $10
      WHERE id = $1
    `,
    [existingId, post.postId, post.id, post.permalink, pageId, post.author.id, post.author.name, createdAt, post.text, toJsonb(post)]
  );

  return existingId;
}

async function persistPagePostsSurface(client: PoolClient, scrapeRunId: string, result: ExtractorResult<PagePostsResult>): Promise<ScrapeRunCompletion> {
  if (result.data.pageId) {
    await upsertFacebookPageStub(client, result.data.pageId, result.data.url);
  }

  for (const [index, post] of result.data.posts.entries()) {
    const recordId = await upsertFacebookPost(client, result.data.pageId, post);
    const inserted = await client.query<{ id: number }>(
      `
        INSERT INTO scraper.facebook_post_scrapes (
          scrape_run_id,
          post_record_id,
          position,
          reactions,
          comments,
          shares,
          raw_result
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [scrapeRunId, recordId, index, post.metrics.reactions, post.metrics.comments, post.metrics.shares, toJsonb(post)]
    );

    const postScrapeId = inserted.rows[0].id;
    const tags = [
      ...post.hashtags.map((value, position) => ({ type: 'hashtag' as const, value, position })),
      ...post.mentions.map((value, position) => ({ type: 'mention' as const, value, position })),
      ...post.links.map((value, position) => ({ type: 'link' as const, value, position }))
    ];

    for (const tag of tags) {
      await client.query(
        `
          INSERT INTO scraper.facebook_post_tags (
            post_scrape_id,
            tag_type,
            tag_value,
            position
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (post_scrape_id, tag_type, tag_value, position)
          DO NOTHING
        `,
        [postScrapeId, tag.type, tag.value, tag.position]
      );
    }

    for (const [mediaIndex, media] of post.media.entries()) {
      await client.query(
        `
          INSERT INTO scraper.facebook_post_media (
            post_scrape_id,
            position,
            media_type,
            media_external_id,
            url,
            width,
            height,
            duration_sec
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (post_scrape_id, position)
          DO UPDATE SET
            media_type = EXCLUDED.media_type,
            media_external_id = EXCLUDED.media_external_id,
            url = EXCLUDED.url,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            duration_sec = EXCLUDED.duration_sec
        `,
        [postScrapeId, mediaIndex, media.type, media.id, media.url, media.width ?? null, media.height ?? null, media.durationSec ?? null]
      );
    }
  }

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: result.data.pageId,
    sourceUrl: result.data.url,
    outputSummary: {
      pageId: result.data.pageId,
      postCount: result.data.posts.length
    }
  };
}

async function upsertMarketplaceSeller(
  client: PoolClient,
  seller: MarketplaceListingResult['seller'] | MarketplaceSellerResult['seller'],
  latestPayload: unknown,
  fallbackSellerId?: string | null
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), $8)
      ON CONFLICT (seller_id)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, scraper.marketplace_sellers.name),
        about = COALESCE(EXCLUDED.about, scraper.marketplace_sellers.about),
        rating = COALESCE(EXCLUDED.rating, scraper.marketplace_sellers.rating),
        review_count = COALESCE(EXCLUDED.review_count, scraper.marketplace_sellers.review_count),
        location_text = COALESCE(EXCLUDED.location_text, scraper.marketplace_sellers.location_text),
        member_since_text = COALESCE(EXCLUDED.member_since_text, scraper.marketplace_sellers.member_since_text),
        last_seen_at = now(),
        last_scraped_at = now(),
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
      toJsonb(compactJson(latestPayload))
    ]
  );

  return sellerId;
}

async function upsertMarketplaceListing(
  client: PoolClient,
  listing: MarketplaceListing,
  latestPayload: unknown,
  canonicalUrl?: string | null
): Promise<string | null> {
  if (!listing.id) {
    return null;
  }

  const sellerId = await upsertMarketplaceSeller(client, listing.seller, { seller: listing.seller }, listing.seller.id);
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), $14)
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
        last_scraped_at = now(),
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
      toJsonb(compactJson(latestPayload))
    ]
  );

  if (listing.images.length > 0) {
    await client.query('DELETE FROM scraper.marketplace_listing_images WHERE listing_id = $1', [listing.id]);
  }

  for (const [index, image] of listing.images.entries()) {
    if (!image.url) {
      continue;
    }

    await client.query(
      `
        INSERT INTO scraper.marketplace_listing_images (
          listing_id,
          position,
          url,
          width,
          height
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (listing_id, position)
        DO UPDATE SET
          url = EXCLUDED.url,
          width = COALESCE(EXCLUDED.width, scraper.marketplace_listing_images.width),
          height = COALESCE(EXCLUDED.height, scraper.marketplace_listing_images.height)
      `,
      [listing.id, index, image.url, image.width ?? null, image.height ?? null]
    );
  }

  await client.query('DELETE FROM scraper.marketplace_listing_delivery_options WHERE listing_id = $1', [listing.id]);
  for (const deliveryOption of listing.deliveryOptions) {
    await client.query(
      `
        INSERT INTO scraper.marketplace_listing_delivery_options (
          listing_id,
          delivery_option
        ) VALUES ($1, $2)
        ON CONFLICT (listing_id, delivery_option)
        DO NOTHING
      `,
      [listing.id, deliveryOption]
    );
  }

  return listing.id;
}

async function persistMarketplaceSearchSurface(client: PoolClient, scrapeRunId: string, result: ExtractorResult<MarketplaceSearchResult>): Promise<ScrapeRunCompletion> {
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
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      toJsonb(result.data)
    ]
  );

  for (const [index, listing] of result.data.listings.entries()) {
    const listingId = await upsertMarketplaceListing(client, listing, listing);
    const sellerId = listing.seller.id ? await upsertMarketplaceSeller(client, listing.seller, { seller: listing.seller }, listing.seller.id) : null;
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
          snapshot_availability
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        scrapeRunId,
        index,
        listingId,
        sellerId,
        listing.title,
        listing.price.amount,
        listing.price.currency,
        listing.price.formatted,
        listing.location.fullLocation,
        listing.availability
      ]
    );
  }

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

async function persistMarketplaceListingSurface(client: PoolClient, scrapeRunId: string, result: ExtractorResult<MarketplaceListingResult>): Promise<ScrapeRunCompletion> {
  const sellerId = result.data.seller.id
    ? await upsertMarketplaceSeller(client, result.data.seller, { seller: result.data.seller }, result.data.seller.id)
    : null;

  const listingId = await upsertMarketplaceListing(client, result.data, result.data, result.data.url);

  if (listingId && sellerId) {
    await client.query('UPDATE scraper.marketplace_listings SET seller_id = COALESCE(seller_id, $2) WHERE listing_id = $1', [listingId, sellerId]);
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
        target_id,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      scrapeRunId,
      listingId,
      result.data.context?.routeName ?? null,
      toJsonb(result.data.context?.routeLocation ?? null),
      toJsonb(result.data.context?.buyLocation ?? null),
      result.data.context?.queryNames ?? [],
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

async function persistMarketplaceSellerSurface(client: PoolClient, scrapeRunId: string, result: ExtractorResult<MarketplaceSellerResult>): Promise<ScrapeRunCompletion> {
  const sellerId = await upsertMarketplaceSeller(client, result.data.seller, result.data.seller, result.data.sellerId);

  await client.query(
    `
      INSERT INTO scraper.marketplace_seller_scrapes (
        scrape_run_id,
        seller_id,
        route_name,
        route_location,
        buy_location,
        query_names,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      scrapeRunId,
      sellerId,
      result.data.context?.routeName ?? null,
      toJsonb(result.data.context?.routeLocation ?? null),
      toJsonb(result.data.context?.buyLocation ?? null),
      result.data.context?.queryNames ?? [],
      toJsonb(result.data)
    ]
  );

  for (const [index, listing] of result.data.listings.entries()) {
    const listingId = await upsertMarketplaceListing(client, listing, listing);
    await client.query(
      `
        INSERT INTO scraper.marketplace_seller_scrape_listings (
          scrape_run_id,
          position,
          listing_id
        ) VALUES ($1, $2, $3)
      `,
      [scrapeRunId, index, listingId]
    );
  }

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

export async function startPersistenceRun(client: PoolClient, input: ScrapeRunStartInput): Promise<string> {
  return startScrapeRun(client, input);
}

export async function completePersistenceRun(client: PoolClient, scrapeRunId: string, completion: ScrapeRunCompletion): Promise<void> {
  return completeScrapeRun(client, scrapeRunId, completion);
}

export function createPageInfoPersistence(url: string): PostgresJobPersistence<PageInfoResult> {
  return {
    start: {
      surface: 'page_info',
      schemaVersion: SCHEMA_VERSIONS.pageInfo,
      sourceUrl: url,
      inputPayload: { url }
    },
    persist: persistPageInfoSurface
  };
}

export function createPagePostsPersistence(url: string): PostgresJobPersistence<PagePostsResult> {
  return {
    start: {
      surface: 'page_posts',
      schemaVersion: SCHEMA_VERSIONS.pagePosts,
      sourceUrl: url,
      inputPayload: { url }
    },
    persist: persistPagePostsSurface
  };
}

export function createMarketplaceSearchPersistence(queryText: string, location: string, searchUrl: string): PostgresJobPersistence<MarketplaceSearchResult> {
  return {
    start: {
      surface: 'marketplace_search',
      sourceUrl: searchUrl,
      schemaVersion: SCHEMA_VERSIONS.marketplaceSearch,
      inputPayload: {
        query: queryText,
        location,
        searchUrl
      }
    },
    persist: persistMarketplaceSearchSurface
  };
}

export function createMarketplaceListingPersistence(listingId: string, url: string): PostgresJobPersistence<MarketplaceListingResult> {
  return {
    start: {
      surface: 'marketplace_listing',
      entityExternalId: listingId,
      sourceUrl: url,
      schemaVersion: SCHEMA_VERSIONS.marketplaceListing,
      inputPayload: { listingId, url }
    },
    persist: persistMarketplaceListingSurface
  };
}

export function createMarketplaceSellerPersistence(sellerId: string, url: string): PostgresJobPersistence<MarketplaceSellerResult> {
  return {
    start: {
      surface: 'marketplace_seller',
      entityExternalId: sellerId,
      sourceUrl: url,
      schemaVersion: SCHEMA_VERSIONS.marketplaceSeller,
      inputPayload: { sellerId, url }
    },
    persist: persistMarketplaceSellerSurface
  };
}
