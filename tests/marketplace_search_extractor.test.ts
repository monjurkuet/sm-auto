import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMarketplaceSearchFragments } from '../src/parsers/graphql/marketplace_parser';
import { buildMarketplaceSearchUrl } from '../src/routes/marketplace_routes';
import type { GraphQLFragment } from '../src/types/contracts';

test('parseMarketplaceSearchFragments keeps fallback payloads after structured payloads', () => {
  const fragments: GraphQLFragment[] = [
    {
      url: 'embedded-html',
      status: 200,
      timestamp: '2026-03-15T00:00:00.000Z',
      request: { friendlyName: 'embedded_document', rawFields: {} },
      fragments: [
        {
          data: {
            marketplace_search: {
              feed_units: {
                edges: [
                  {
                    node: {
                      listing: {
                        __typename: 'GroupCommerceProductItem',
                        id: 'structured-1',
                        marketplace_listing_title: 'Structured Listing',
                        listing_price: { formatted_amount: 'BDT1,000', amount: '1000.00', currency: 'BDT' }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        {
          path: ['marketplace_search', 'feed_units'],
          data: {
            marketplace_search: {
              feed_units: {
                edges: []
              }
            },
            marketplace_search_noise: {
              items: [
                {
                  __typename: 'GroupCommerceProductItem',
                  id: 'fallback-1',
                  marketplace_listing_title: 'Fallback Listing',
                  listing_price: { formatted_amount: 'BDT2,000', amount: '2000.00', currency: 'BDT' }
                }
              ]
            }
          }
        }
      ]
    }
  ];

  const listings = parseMarketplaceSearchFragments(fragments);

  assert.equal(listings.length, 2);
  assert.equal(
    listings.some((listing) => listing.id === 'structured-1'),
    true
  );
  assert.equal(
    listings.some((listing) => listing.id === 'fallback-1'),
    true
  );
});

test('buildMarketplaceSearchUrl preserves location casing in the path', () => {
  const url = buildMarketplaceSearchUrl('iphone 15', 'Dhaka City');

  assert.equal(url, 'https://www.facebook.com/marketplace/Dhaka%20City/search?query=iphone%2015');
});
