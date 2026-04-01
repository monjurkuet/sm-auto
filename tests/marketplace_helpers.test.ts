import assert from 'node:assert/strict';
import test from 'node:test';

import { collectMarketplaceSearchFragments, mergeMarketplaceLocationContext } from '../src/extractors/marketplace_helpers';
import type { GraphQLFragment, MarketplaceRouteLocationContext } from '../src/types/contracts';

function createFragment(overrides: Partial<GraphQLFragment>): GraphQLFragment {
  return {
    url: 'https://www.facebook.com/api/graphql/',
    status: 200,
    timestamp: '2026-03-30T00:00:00.000Z',
    request: {
      rawFields: {},
      ...overrides.request
    },
    fragments: overrides.fragments ?? [],
    ...overrides
  };
}

test('collectMarketplaceSearchFragments keeps both friendly-name and marketplace_search path matches', () => {
  const fragments = [
    createFragment({
      request: { friendlyName: 'CometMarketplaceSearchRootQuery', rawFields: {} },
      fragments: [{ data: { marketplace_search: { feed_units: { edges: [] } } } }]
    }),
    createFragment({
      request: { friendlyName: 'CometMarketplaceBrowseQuery', rawFields: {} },
      fragments: [{ path: ['marketplace_search', 'feed_units'], data: { node: { id: '1' } } }]
    }),
    createFragment({
      request: { friendlyName: 'CometMarketplaceListingSellerCardQuery', rawFields: {} },
      fragments: [{ data: { listing: { id: '2' } } }]
    })
  ];

  const relevant = collectMarketplaceSearchFragments(fragments);

  assert.equal(relevant.length, 2);
  assert.equal(relevant[0]?.request.friendlyName, 'CometMarketplaceSearchRootQuery');
  assert.equal(relevant[1]?.request.friendlyName, 'CometMarketplaceBrowseQuery');
});

test('mergeMarketplaceLocationContext prefers primary fields and only keeps numeric vanity ids', () => {
  const primary: MarketplaceRouteLocationContext = {
    radius: null,
    latitude: 23.8103,
    longitude: 90.4125,
    vanityPageId: 'Dhaka'
  };
  const fallback: MarketplaceRouteLocationContext = {
    radius: 65,
    latitude: 23.7,
    longitude: 90.3,
    vanityPageId: '101889586519301'
  };

  assert.deepEqual(mergeMarketplaceLocationContext(primary, fallback), {
    radius: 65,
    latitude: 23.8103,
    longitude: 90.4125,
    vanityPageId: '101889586519301'
  });
});
