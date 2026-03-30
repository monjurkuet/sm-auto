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

export async function upsertMarketplaceSeller(
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

export async function upsertMarketplaceListing(
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

export async function persistMarketplaceListingSurface(
    client: PoolClient,
    scrapeRunId: string,
    result: ExtractorResult<MarketplaceListingResult>
): Promise<ScrapeRunCompletion> {
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

export async function persistMarketplaceSellerSurface(
    client: PoolClient,
    scrapeRunId: string,
    result: ExtractorResult<MarketplaceSellerResult>
): Promise<ScrapeRunCompletion> {
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