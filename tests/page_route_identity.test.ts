import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFacebookPageRouteIdentity } from '../src/parsers/embedded/page_route_identity';
import type { MarketplaceRouteDefinition } from '../src/parsers/embedded/marketplace_embedded_parser';

test('extractFacebookPageRouteIdentity selects the profile timeline route identity', () => {
  const routes: MarketplaceRouteDefinition[] = [
    {
      routeUrl: '/other',
      canonicalRouteName: 'CometMarketplaceSearchRoute',
      location: null,
      raw: {}
    },
    {
      routeUrl: '/ryanscomputers',
      canonicalRouteName: 'ProfileTimelineRoute',
      location: null,
      raw: {
        result: {
          exports: {
            rootView: {
              props: {
                userID: '100064688828733',
                userVanity: 'ryanscomputers'
              }
            }
          }
        }
      }
    }
  ];

  assert.deepEqual(extractFacebookPageRouteIdentity(routes), {
    pageId: '100064688828733',
    vanity: 'ryanscomputers',
    matchedRouteName: 'ProfileTimelineRoute',
    matchedRouteUrl: '/ryanscomputers'
  });
});

test('extractFacebookPageRouteIdentity returns null when no timeline identity is present', () => {
  const routes: MarketplaceRouteDefinition[] = [
    {
      routeUrl: '/listing',
      canonicalRouteName: 'CometMarketplacePermalinkRoute',
      location: null,
      raw: {}
    }
  ];

  assert.equal(extractFacebookPageRouteIdentity(routes), null);
});
