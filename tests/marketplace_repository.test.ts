import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistMarketplaceSearchSurface,
  persistMarketplaceSellerSurface,
  upsertMarketplaceListing
} from '../src/storage/postgres/marketplace_repository';
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
  assert.match(searchResultInsert.text, /FROM unnest\(\s*\$2::int\[],\s*\$3::text\[],\s*\$4::text\[],\s*\$5::text\[],\s*\$6::numeric\[],\s*\$7::text\[],\s*\$8::text\[],\s*\$9::text\[],\s*\$10::text\[]/);
  assert.deepEqual(completion.outputSummary, {
    query: 'iPhone 15',
    location: 'Dhaka',
    listingCount: 1
  });
});

test('upsertMarketplaceListing batches listing images and delivery options', async () => {
  const client = new FakeClient();
  const listing = createMarketplaceListing();

  const listingId = await upsertMarketplaceListing(client as never, listing, listing, 'https://example.com/listing-1');

  assert.equal(listingId, 'listing-1');
  assert.ok(
    client.queries.some(
      (query) =>
        /INSERT INTO scraper\.marketplace_listing_images/.test(query.text) && /FROM unnest\(\$2::int\[], \$3::text\[], \$4::int\[], \$5::int\[]\)/.test(query.text)
    )
  );
  assert.ok(
    client.queries.some(
      (query) =>
        /INSERT INTO scraper\.marketplace_listing_delivery_options/.test(query.text) &&
        /FROM unnest\(\$2::text\[]\)/.test(query.text)
    )
  );
});

test('upsertMarketplaceListing clears stale images when the latest scrape has none', async () => {
  const client = new FakeClient();
  const listing = { ...createMarketplaceListing(), images: [] };

  await upsertMarketplaceListing(client as never, listing, listing, 'https://example.com/listing-1');

  const imageDelete = client.queries.find((query) => /DELETE FROM scraper\.marketplace_listing_images/.test(query.text));
  const imageInsert = client.queries.find((query) => /INSERT INTO scraper\.marketplace_listing_images/.test(query.text));

  assert.ok(imageDelete);
  assert.equal(imageInsert, undefined);
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

  assert.ok(scrapeListingInsert);
  assert.match(scrapeListingInsert.text, /FROM unnest\(\$2::int\[], \$3::text\[]\)/);
  assert.deepEqual(completion.outputSummary, {
    sellerId: 'seller-1',
    sellerName: 'Dhaka Gadgets',
    listingCount: 2
  });
});
