import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countMarketplaceListingIdsForBulkCrawl,
  countMarketplaceSellerIdsForBulkCrawl,
  selectMarketplaceListingIdsForBulkCrawl,
  selectMarketplaceSellerIdsForBulkCrawl
} from '../src/storage/postgres/marketplace_queue_repository';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];

  async query<T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    this.queries.push({ text, values });

    if (/COUNT\(\*\)::int AS count/.test(text)) {
      return { rows: [{ count: 3 } as T] };
    }

    return { rows: [{ entity_id: 'entity-1' } as T, { entity_id: 'entity-2' } as T] };
  }
}

test('countMarketplaceListingIdsForBulkCrawl uses uncrawled listing query', async () => {
  const client = new FakeClient();

  const count = await countMarketplaceListingIdsForBulkCrawl(client as never, {});

  assert.equal(count, 3);
  assert.match(client.queries[0]!.text, /LEFT JOIN scraper\.marketplace_listing_scrapes/);
  assert.match(client.queries[0]!.text, /WHERE mls\.listing_id IS NULL/);
});

test('selectMarketplaceListingIdsForBulkCrawl scopes by search query and location', async () => {
  const client = new FakeClient();

  const ids = await selectMarketplaceListingIdsForBulkCrawl(client as never, {
    sourceQuery: 'iphone',
    sourceLocation: 'Dhaka',
    limit: 25,
    offset: 0
  });

  assert.deepEqual(ids, ['entity-1', 'entity-2']);
  assert.match(client.queries[0]!.text, /mss\.query = \$1/);
  assert.match(client.queries[0]!.text, /mss\.location_text = \$2/);
  assert.match(client.queries[0]!.text, /LIMIT \$3 OFFSET \$4/);
});

test('countMarketplaceSellerIdsForBulkCrawl uses uncrawled seller query', async () => {
  const client = new FakeClient();

  const count = await countMarketplaceSellerIdsForBulkCrawl(client as never, {});

  assert.equal(count, 3);
  assert.match(client.queries[0]!.text, /LEFT JOIN scraper\.marketplace_seller_scrapes/);
  assert.match(client.queries[0]!.text, /WHERE mss\.seller_id IS NULL/);
});

test('selectMarketplaceSellerIdsForBulkCrawl respects requireListingHistory', async () => {
  const client = new FakeClient();

  const ids = await selectMarketplaceSellerIdsForBulkCrawl(client as never, {
    sourceQuery: 'iphone',
    sourceLocation: 'Dhaka',
    requireListingHistory: true,
    limit: 10,
    offset: 5
  });

  assert.deepEqual(ids, ['entity-1', 'entity-2']);
  assert.match(client.queries[0]!.text, /EXISTS \(SELECT 1 FROM scraper\.marketplace_listings mlh/);
  assert.match(client.queries[0]!.text, /mssrc\.query = \$1/);
  assert.match(client.queries[0]!.text, /mssrc\.location_text = \$2/);
  assert.match(client.queries[0]!.text, /LIMIT \$3 OFFSET \$4/);
});
