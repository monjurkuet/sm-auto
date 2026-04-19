import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistMarketplaceSearchSurface,
  persistMarketplaceListingSurface,
  persistMarketplaceSellerSurface,
  upsertMarketplaceListing
} from '../src/storage/postgres/marketplace_repository';
import {
  countMarketplaceListingIdsForBulkCrawl,
  countMarketplaceSellerIdsForBulkCrawl,
  selectMarketplaceListingIdsForBulkCrawl,
  selectMarketplaceSellerIdsForBulkCrawl
} from '../src/storage/postgres/marketplace_queue_repository';
import type { MarketplaceListing, MarketplaceSearchResult, MarketplaceSellerResult } from '../src/types/contracts';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];

  async query(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.queries.push({ text, values });
    return { rows: [] };
  }
}

function createMarketplaceSearchResult(): MarketplaceSearchResult {
  return {
    query: 'iPhone 15',
    location: 'Dhaka',
    searchUrl: 'https://www.facebook.com/marketplace/dhaka/search?query=iPhone%2015',
    searchContext: {
      buyLocation: {
        radius: 65,
        latitude: 23.8103,
        longitude: 90.4125,
        vanityPageId: '101889586519301'
      }
    },
    listings: [
      {
        id: 'listing-1',
        title: 'iPhone 15 Pro Max',
        description: '256GB, good condition',
        price: {
          amount: 120000,
          currency: 'BDT',
          formatted: '৳120,000'
        },
        seller: {
          id: 'seller-1',
          name: 'Dhaka Gadgets'
        },
        location: {
          city: 'Dhaka',
          fullLocation: 'Dhaka, Bangladesh'
        },
        images: [
          {
            url: 'https://example.com/listing-1.jpg',
            width: 1080,
            height: 1080
          }
        ],
        availability: 'available',
        categoryId: 'electronics',
        deliveryOptions: ['local_pick_up']
      }
    ],
    scrapedAt: '2026-03-30T00:00:00.000Z'
  };
}

function createMarketplaceListing(): MarketplaceListing {
  return {
    id: 'listing-1',
    title: 'iPhone 15 Pro Max',
    description: '256GB, good condition',
    price: {
      amount: 120000,
      currency: 'BDT',
      formatted: '৳120,000'
    },
    seller: {
      id: 'seller-1',
      name: 'Dhaka Gadgets'
    },
    location: {
      city: 'Dhaka',
      fullLocation: 'Dhaka, Bangladesh'
    },
    images: [
      {
        url: 'https://example.com/listing-1.jpg',
        width: 1080,
        height: 1080
      },
      {
        url: 'https://example.com/listing-2.jpg',
        width: 720,
        height: 720
      }
    ],
    availability: 'available',
    categoryId: 'electronics',
    deliveryOptions: ['local_pick_up', 'shipping']
  };
}

function createMarketplaceSellerResult(): MarketplaceSellerResult {
  return {
    sellerId: 'seller-1',
    seller: {
      id: 'seller-1',
      name: 'Dhaka Gadgets',
      about: 'Trusted seller',
      rating: 4.9,
      reviewCount: 27,
      location: 'Dhaka',
      memberSince: '2019'
    },
    context: {
      routeName: 'CometMarketplaceSellerProfileDialogRoute',
      routeLocation: null,
      buyLocation: null,
      queryNames: ['MarketplaceSellerProfileInventoryQuery'],
      sellerId: 'seller-1'
    },
    listings: [createMarketplaceListing(), { ...createMarketplaceListing(), id: 'listing-2' }],
    scrapedAt: '2026-03-30T00:00:00.000Z'
  };
}

test('persistMarketplaceSearchSurface upserts each seller only once per listing', async () => {
  const client = new FakeClient();
  const result = createMarketplaceSearchResult();
  result.listings = [result.listings[0]!, { ...result.listings[0]!, id: 'listing-2' }];

  const completion = await persistMarketplaceSearchSurface(client as never, 'run-1', {
    data: result,
    artifacts: {
      graphql_summary: { responseCount: 1 }
    }
  });

  const sellerUpserts = client.queries.filter((query) => /INSERT INTO scraper\.marketplace_sellers/.test(query.text));
  const searchScrapeInsert = client.queries.find((query) =>
    /INSERT INTO scraper\.marketplace_search_scrapes/.test(query.text)
  );
  const searchResultInsert = client.queries.find((query) =>
    /INSERT INTO scraper\.marketplace_search_results/.test(query.text)
  );

  assert.equal(sellerUpserts.length, 1);
  assert.ok(searchScrapeInsert);
  assert.ok(searchResultInsert);
  assert.match(searchScrapeInsert.text, /scraped_at/);
  assert.equal(
    client.queries.filter((query) => /INSERT INTO scraper\.marketplace_listings/.test(query.text)).length,
    2
  );
  assert.match(
    searchResultInsert.text,
    /observed_at[\s\S]*FROM unnest\(\s*\$3::int\[],\s*\$4::text\[],\s*\$5::text\[],\s*\$6::text\[],\s*\$7::numeric\[],\s*\$8::text\[],\s*\$9::text\[],\s*\$10::text\[],\s*\$11::text\[]/
  );
  assert.match(searchResultInsert.text, /ON CONFLICT \(listing_id\)\s+DO NOTHING/);
  assert.equal(searchScrapeInsert.values[8], '2026-03-30T00:00:00.000Z');
  assert.equal(searchResultInsert.values[0], 'run-1');
  assert.equal(searchResultInsert.values[1], '2026-03-30T00:00:00.000Z');
  assert.deepEqual(completion.outputSummary, {
    query: 'iPhone 15',
    location: 'Dhaka',
    listingCount: 2
  });
});

test('persistMarketplaceSearchSurface deduplicates repeated listing ids in one run', async () => {
  const client = new FakeClient();
  const result = createMarketplaceSearchResult();
  result.listings = [result.listings[0]!, { ...result.listings[0]!, title: 'Duplicate title update' }];

  await persistMarketplaceSearchSurface(client as never, 'run-2', {
    data: result,
    artifacts: {}
  });

  const searchResultInserts = client.queries.filter((query) =>
    /INSERT INTO scraper\.marketplace_search_results/.test(query.text)
  );

  assert.equal(searchResultInserts.length, 1);
  assert.match(searchResultInserts[0]!.text, /ON CONFLICT \(listing_id\)\s+DO NOTHING/);
});

test('persistMarketplaceSearchSurface skips rows without listing ids', async () => {
  const client = new FakeClient();
  const result = createMarketplaceSearchResult();
  result.listings = [{ ...result.listings[0]!, id: null }];

  await persistMarketplaceSearchSurface(client as never, 'run-3', {
    data: result,
    artifacts: {}
  });

  const searchResultInsert = client.queries.find((query) =>
    /INSERT INTO scraper\.marketplace_search_results/.test(query.text)
  );

  assert.equal(searchResultInsert, undefined);
});

test('upsertMarketplaceListing batches listing images and delivery options', async () => {
  const client = new FakeClient();
  const listing = createMarketplaceListing();

  const listingId = await upsertMarketplaceListing(
    client as never,
    listing,
    listing,
    'https://example.com/listing-1',
    undefined,
    '2026-03-30T00:00:00.000Z'
  );

  assert.equal(listingId, 'listing-1');
  const listingInsert = client.queries.find((query) => /INSERT INTO scraper\.marketplace_listings/.test(query.text));
  assert.ok(listingInsert);
  assert.equal(listingInsert!.values[13], '2026-03-30T00:00:00.000Z');
  assert.ok(
    client.queries.some(
      (query) =>
        /INSERT INTO scraper\.marketplace_listing_images/.test(query.text) &&
        /first_seen_at/.test(query.text) &&
        /FROM unnest\(\$2::int\[], \$3::text\[], \$4::int\[], \$5::int\[]\)/.test(query.text)
    )
  );
  assert.ok(
    client.queries.some(
      (query) =>
        /INSERT INTO scraper\.marketplace_listing_delivery_options/.test(query.text) &&
        /first_seen_at/.test(query.text) &&
        /FROM unnest\(\$2::text\[]\)/.test(query.text)
    )
  );
});

test('upsertMarketplaceListing marks missing images inactive instead of deleting', async () => {
  const client = new FakeClient();
  const listing = { ...createMarketplaceListing(), images: [] };

  await upsertMarketplaceListing(
    client as never,
    listing,
    listing,
    'https://example.com/listing-1',
    undefined,
    '2026-03-30T00:00:00.000Z'
  );

  const imageDelete = client.queries.find((query) =>
    /DELETE FROM scraper\.marketplace_listing_images/.test(query.text)
  );
  const imageDeactivate = client.queries.find(
    (query) => /UPDATE scraper\.marketplace_listing_images/.test(query.text) && /is_active = false/.test(query.text)
  );
  const imageInsert = client.queries.find((query) =>
    /INSERT INTO scraper\.marketplace_listing_images/.test(query.text)
  );

  assert.equal(imageDelete, undefined);
  assert.ok(imageDeactivate);
  assert.equal(imageInsert, undefined);
});

test('upsertMarketplaceListing uses scrapedAt for durable timestamps', async () => {
  const client = new FakeClient();
  const listing = createMarketplaceListing();

  await upsertMarketplaceListing(
    client as never,
    listing,
    listing,
    'https://example.com/listing-1',
    undefined,
    '2026-03-30T00:00:00.000Z'
  );

  const listingInsert = client.queries.find((query) => /INSERT INTO scraper\.marketplace_listings/.test(query.text));
  const sellerInsert = client.queries.find((query) => /INSERT INTO scraper\.marketplace_sellers/.test(query.text));

  assert.ok(listingInsert);
  assert.ok(sellerInsert);
  assert.equal(listingInsert.values[13], '2026-03-30T00:00:00.000Z');
  assert.equal(sellerInsert.values[7], '2026-03-30T00:00:00.000Z');
});

test('upsertMarketplaceListing upserts images with is_active and no delete', async () => {
  const client = new FakeClient();
  const listing = createMarketplaceListing();

  await upsertMarketplaceListing(
    client as never,
    listing,
    listing,
    'https://example.com/listing-1',
    undefined,
    '2026-03-30T00:00:00.000Z'
  );

  const imageDelete = client.queries.find((query) =>
    /DELETE FROM scraper\.marketplace_listing_images/.test(query.text)
  );
  const imageUpsert = client.queries.find(
    (query) => /INSERT INTO scraper\.marketplace_listing_images/.test(query.text) && /is_active/.test(query.text)
  );

  assert.equal(imageDelete, undefined);
  assert.ok(imageUpsert);
  assert.match(imageUpsert!.text, /is_active/);
});

test('upsertMarketplaceListing marks missing delivery options inactive instead of deleting', async () => {
  const client = new FakeClient();
  const listing = { ...createMarketplaceListing(), deliveryOptions: [] };

  await upsertMarketplaceListing(
    client as never,
    listing,
    listing,
    'https://example.com/listing-1',
    undefined,
    '2026-03-30T00:00:00.000Z'
  );

  const deliveryDelete = client.queries.find((query) =>
    /DELETE FROM scraper\.marketplace_listing_delivery_options/.test(query.text)
  );
  const deliveryDeactivate = client.queries.find(
    (query) =>
      /UPDATE scraper\.marketplace_listing_delivery_options/.test(query.text) && /is_active = false/.test(query.text)
  );

  assert.equal(deliveryDelete, undefined);
  assert.ok(deliveryDeactivate);
});

test('persistMarketplaceSellerSurface batches scrape listing links after listing upserts', async () => {
  const client = new FakeClient();
  const result = createMarketplaceSellerResult();

  const completion = await persistMarketplaceSellerSurface(client as never, 'run-2', {
    data: result,
    artifacts: {
      collection_stats: { usedEmbeddedDocument: true }
    }
  });

  const scrapeListingInsert = client.queries.find((query) =>
    /INSERT INTO scraper\.marketplace_seller_scrape_listings/.test(query.text)
  );
  const sellerScrapeInsert = client.queries.find((query) =>
    /INSERT INTO scraper\.marketplace_seller_scrapes/.test(query.text)
  );

  assert.ok(scrapeListingInsert);
  assert.match(scrapeListingInsert.text, /observed_at/);
  assert.ok(sellerScrapeInsert);
  assert.equal(sellerScrapeInsert!.values[6], '2026-03-30T00:00:00.000Z');
  assert.equal(scrapeListingInsert!.values[1], '2026-03-30T00:00:00.000Z');
  assert.deepEqual(completion.outputSummary, {
    sellerId: 'seller-1',
    sellerName: 'Dhaka Gadgets',
    listingCount: 2
  });
});

test('persistMarketplaceListingSurface and seller surface write scraped_at', async () => {
  const client = new FakeClient();
  const listingResult = {
    data: {
      ...createMarketplaceListing(),
      url: 'https://www.facebook.com/marketplace/item/1',
      scrapedAt: '2026-03-30T00:00:00.000Z',
      context: {
        routeName: 'TestRoute',
        routeLocation: null,
        buyLocation: null,
        queryNames: ['QueryA'],
        targetId: 'listing-1'
      }
    },
    artifacts: {}
  } as never;
  const sellerResult = {
    data: {
      sellerId: 'seller-1',
      seller: createMarketplaceSellerResult().seller,
      listings: [createMarketplaceListing()],
      scrapedAt: '2026-03-30T00:00:00.000Z',
      context: {
        routeName: 'TestRoute',
        routeLocation: null,
        buyLocation: null,
        queryNames: ['QueryA'],
        sellerId: 'seller-1'
      }
    },
    artifacts: {}
  } as never;

  await persistMarketplaceSearchSurface(client as never, 'run-1', {
    data: createMarketplaceSearchResult(),
    artifacts: {}
  });

  await persistMarketplaceListingSurface(client as never, 'run-2', listingResult);
  await persistMarketplaceSellerSurface(client as never, 'run-3', sellerResult);

  assert.ok(
    client.queries.some(
      (query) => /INSERT INTO scraper\.marketplace_listing_scrapes/.test(query.text) && /scraped_at/.test(query.text)
    )
  );
  assert.ok(
    client.queries.some(
      (query) => /INSERT INTO scraper\.marketplace_seller_scrapes/.test(query.text) && /scraped_at/.test(query.text)
    )
  );
});

test('selectMarketplaceListingIdsForBulkCrawl filters uncrawled listings', async () => {
  const client = new FakeClient();

  await selectMarketplaceListingIdsForBulkCrawl(client as never, {
    sourceQuery: null,
    sourceLocation: null,
    limit: 10,
    offset: 5
  });

  assert.match(client.queries[0]!.text, /FROM scraper\.marketplace_listings ml/);
  assert.match(
    client.queries[0]!.text,
    /LEFT JOIN scraper\.marketplace_listing_scrapes mls ON mls\.listing_id = ml\.listing_id/
  );
  assert.match(client.queries[0]!.text, /WHERE mls\.listing_id IS NULL/);
  assert.match(client.queries[0]!.text, /ORDER BY ml\.last_seen_at DESC NULLS LAST, ml\.listing_id/);
  assert.match(client.queries[0]!.text, /LIMIT \$1 OFFSET \$2/);
});

test('selectMarketplaceSellerIdsForBulkCrawl scopes seller selection by query and location', async () => {
  const client = new FakeClient();

  await selectMarketplaceSellerIdsForBulkCrawl(client as never, {
    sourceQuery: 'iphone',
    sourceLocation: 'Dhaka',
    requireListingHistory: true,
    limit: 10,
    offset: 0
  });

  assert.match(client.queries[0]!.text, /FROM scraper\.marketplace_search_scrapes mssrc/);
  assert.match(
    client.queries[0]!.text,
    /JOIN scraper\.marketplace_search_results msr ON msr\.scrape_run_id = mssrc\.scrape_run_id/
  );
  assert.match(client.queries[0]!.text, /JOIN scraper\.marketplace_sellers ms ON ms\.seller_id = msr\.seller_id/);
  assert.match(
    client.queries[0]!.text,
    /LEFT JOIN scraper\.marketplace_seller_scrapes mss ON mss\.seller_id = ms\.seller_id/
  );
  assert.match(client.queries[0]!.text, /mssrc\.query = \$1/);
  assert.match(client.queries[0]!.text, /mssrc\.location_text = \$2/);
  assert.match(
    client.queries[0]!.text,
    /EXISTS \(SELECT 1 FROM scraper\.marketplace_listings mlh WHERE mlh\.seller_id = ms\.seller_id\)/
  );
});

test('countMarketplaceListingIdsForBulkCrawl wraps the listing selector in a count query', async () => {
  const client = new FakeClient();

  await countMarketplaceListingIdsForBulkCrawl(client as never, {
    sourceQuery: 'iphone',
    sourceLocation: 'Dhaka'
  });

  assert.match(client.queries[0]!.text, /SELECT COUNT\(\*\)::int AS count/);
  assert.match(client.queries[0]!.text, /FROM scraper\.marketplace_search_scrapes mss/);
});

test('countMarketplaceSellerIdsForBulkCrawl wraps the seller selector in a count query', async () => {
  const client = new FakeClient();

  await countMarketplaceSellerIdsForBulkCrawl(client as never, {
    sourceQuery: null,
    sourceLocation: null,
    requireListingHistory: false
  });

  assert.match(client.queries[0]!.text, /SELECT COUNT\(\*\)::int AS count/);
  assert.match(client.queries[0]!.text, /FROM scraper\.marketplace_sellers ms/);
});
