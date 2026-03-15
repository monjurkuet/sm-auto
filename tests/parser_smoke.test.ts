import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMarketplaceListing } from '../src/normalizers/marketplace_listing_normalizer';

test('normalizeMarketplaceListing preserves id and stamps url', () => {
  const result = normalizeMarketplaceListing('https://www.facebook.com/marketplace/item/1/', {
    id: '1',
    title: 'Listing',
    description: 'Desc',
    price: { amount: 100, currency: 'BDT', formatted: '৳100' },
    seller: { id: '2', name: 'Seller' },
    location: { city: 'Dhaka', fullLocation: 'Dhaka, Bangladesh' },
    images: [],
    availability: 'available',
    categoryId: '123',
    deliveryOptions: []
  });

  assert.equal(result.id, '1');
  assert.equal(result.url, 'https://www.facebook.com/marketplace/item/1/');
});
