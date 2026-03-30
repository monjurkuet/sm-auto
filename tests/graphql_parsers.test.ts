import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  parseMarketplaceListingFragments,
  parseMarketplaceSearchFragments,
  parseMarketplaceSellerInventoryFragments,
  parseMarketplaceSellerFragments
} from '../src/parsers/graphql/marketplace_parser';
import {
  createEmbeddedDocumentFragment,
  extractMarketplaceQueryContextsFromHtml,
  extractMarketplaceSearchContextFromHtml,
  parseBulkRouteDefinitionsBody,
  selectRouteDefinition
} from '../src/parsers/embedded/marketplace_embedded_parser';
import { parseTimelineFragments, parseTimelineIdentity } from '../src/parsers/graphql/timeline_parser';
import type { GraphQLFragment } from '../src/types/contracts';

function loadFixture(name: string): GraphQLFragment[] {
  const fixturePath = path.join(process.cwd(), 'fixtures', 'graphql', name);
  const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  return [
    {
      url: 'https://www.facebook.com/api/graphql/',
      status: 200,
      timestamp: '2026-03-15T00:00:00.000Z',
      request: {
        friendlyName: 'fixture',
        rawFields: {}
      },
      fragments: [payload]
    }
  ];
}

test('parseMarketplaceSearchFragments extracts listing cards', () => {
  const listings = parseMarketplaceSearchFragments(loadFixture('marketplace_search_fragment.json'));
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.id, 'listing-1');
  assert.equal(listings[0]?.seller.name, 'Seller One');
  assert.equal(listings[0]?.deliveryOptions.length, 2);
});

test('parseMarketplaceSearchFragments prefers marketplace_search scoped payloads over unrelated embedded items', () => {
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
                        id: 'search-1',
                        marketplace_listing_title: 'Search Result Laptop',
                        listing_price: { formatted_amount: 'BDT15,000', amount: '15000.00', currency: 'BDT' }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        {
          data: {
            marketplace_home_feed: {
              marketplace_listings: [
                {
                  __typename: 'GroupCommerceProductItem',
                  id: 'home-1',
                  marketplace_listing_title: 'Unrelated Home Feed Item',
                  listing_price: { formatted_amount: 'BDT1,000', amount: '1000.00', currency: 'BDT' }
                }
              ]
            }
          }
        }
      ]
    }
  ];

  const listings = parseMarketplaceSearchFragments(fragments);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.id, 'search-1');
});

test('parseMarketplaceListingFragments extracts listing detail payload', () => {
  const listing = parseMarketplaceListingFragments(loadFixture('marketplace_listing_fragment.json'));
  assert.equal(listing?.id, 'listing-9');
  assert.equal(listing?.location.coordinates ? true : false, true);
  assert.equal(listing?.images[0]?.url, 'https://example.com/iphone.jpg');
});

test('parseMarketplaceSellerFragments extracts seller profile payload', () => {
  const seller = parseMarketplaceSellerFragments(loadFixture('marketplace_seller_fragment.json'), 'seller-1');
  assert.equal(seller.seller.id, 'seller-1');
  assert.equal(seller.seller.rating, 4.8);
  assert.equal(seller.seller.reviewCount, 37);
});

test('embedded seller inventory payloads are extracted from document html', () => {
  const firstPayload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              result: {
                data: {
                  profile: {
                    marketplace_listing_sets: {
                      edges: [
                        {
                          node: {
                            canonical_listing: {
                              __typename: 'GroupCommerceProductItem',
                              id: '1484770273045671',
                              listing_price: {
                                formatted_amount: 'BDT4,999',
                                amount: '4999.00'
                              },
                              location: {
                                reverse_geocode: {
                                  city: 'ঢাকা',
                                  city_page: { display_name: 'Dhaka, Bangladesh' }
                                }
                              },
                              marketplace_listing_title: 'Lenovo Centrino Duo fresh Laptop',
                              marketplace_listing_seller: { id: '61572591435930', name: 'DI PU' }
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        ]
      ]
    ]
  };
  const secondPayload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              result: {
                label:
                  'MarketplaceSellerProfileInventoryList_profile$stream$MarketplaceSellerProfileInventoryList_profile_marketplace_listing_sets',
                path: ['profile', 'marketplace_listing_sets', 'edges', 2],
                data: {
                  node: {
                    canonical_listing: {
                      __typename: 'GroupCommerceProductItem',
                      id: '950298004113842',
                      listing_price: {
                        formatted_amount: 'BDT4,200',
                        amount: '4200.00',
                        currency: 'BDT'
                      },
                      location: {
                        reverse_geocode: {
                          city: 'ঢাকা',
                          city_page: { display_name: 'Dhaka, Bangladesh' }
                        }
                      },
                      marketplace_listing_title: 'Samsung Netbook',
                      marketplace_listing_seller: { id: '61572591435930', name: 'DI PU' }
                    }
                  }
                }
              }
            }
          }
        ]
      ]
    ]
  };
  const html = `<html><body><script type="application/json" data-sjs>${JSON.stringify(firstPayload)}</script><script type="application/json" data-sjs>${JSON.stringify(secondPayload)}</script></body></html>`;

  const embedded = createEmbeddedDocumentFragment('https://www.facebook.com/marketplace/profile/61572591435930/', html);
  assert.ok(embedded);

  const listings = parseMarketplaceSellerInventoryFragments([embedded]);
  assert.equal(listings.length, 2);
  assert.equal(listings[0]?.price.currency, 'BDT');
  assert.equal(listings[0]?.seller.id, '61572591435930');
});

test('listing parser prefers richer embedded product item nodes', () => {
  const sparsePayload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              result: {
                data: {
                  marketplace_listing_item: {
                    __typename: 'GroupCommerceProductItem',
                    id: '1244539514326495',
                    listing_photos: [],
                    pre_recorded_videos: [],
                    is_hidden: false
                  }
                }
              }
            }
          }
        ]
      ]
    ]
  };
  const richPayload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              result: {
                data: {
                  marketplace_listing_item: {
                    __typename: 'GroupCommerceProductItem',
                    id: '1244539514326495',
                    marketplace_listing_title:
                      'Urgent Sell 13th Gen core i3 Hp Laptop 8GB RAM 512GB SSD New conditions',
                    listing_price: {
                      formatted_amount_zeros_stripped: 'BDT0',
                      amount: '0.00',
                      currency: 'BDT'
                    },
                    location: {
                      reverse_geocode: {
                        city: 'ঢাকা',
                        city_page: { display_name: 'Dhaka, Bangladesh' }
                      }
                    },
                    marketplace_listing_seller: { id: '100009372925453', name: 'Md Obaidur Rahman' },
                    delivery_types: ['IN_PERSON']
                  }
                }
              }
            }
          }
        ]
      ]
    ]
  };
  const html = `<html><body><script type="application/json" data-sjs>${JSON.stringify(sparsePayload)}</script><script type="application/json" data-sjs>${JSON.stringify(richPayload)}</script></body></html>`;

  const embedded = createEmbeddedDocumentFragment('https://www.facebook.com/marketplace/item/1244539514326495/', html);
  assert.ok(embedded);

  const listing = parseMarketplaceListingFragments([embedded], '1244539514326495');
  assert.equal(listing?.title, 'Urgent Sell 13th Gen core i3 Hp Laptop 8GB RAM 512GB SSD New conditions');
  assert.equal(listing?.price.currency, 'BDT');
  assert.equal(listing?.seller.id, '100009372925453');
});

test('bulk route definitions parser extracts location metadata', () => {
  const body =
    'for (;;);' +
    JSON.stringify({
      payload: {
        payloads: {
          '/marketplace/profile/61572591435930/': {
            result: {
              exports: {
                canonicalRouteName: 'comet.fbweb.CometMarketplaceSellerProfileDialogRoute',
                rootView: {
                  props: {
                    location: {
                      radius: 65,
                      latitude: 23.7302,
                      longitude: 90.4152,
                      vanityPageId: '101889586519301'
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

  const routes = parseBulkRouteDefinitionsBody(body);
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.location?.radius, 65);
  assert.equal(routes[0]?.location?.vanityPageId, '101889586519301');
});

test('extractMarketplaceSearchContextFromHtml extracts embedded buyLocation variables', () => {
  const payload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            preloaders: [
              {
                queryName: 'CometMarketplaceSearchRootQuery',
                variables: {
                  buyLocation: {
                    latitude: 23.7302,
                    longitude: 90.4152
                  }
                }
              }
            ]
          }
        ]
      ]
    ]
  };

  const html = `<html><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`;
  const context = extractMarketplaceSearchContextFromHtml(html);

  assert.equal(context?.latitude, 23.7302);
  assert.equal(context?.longitude, 90.4152);
});

test('extractMarketplaceQueryContextsFromHtml extracts listing target and buyLocation preloaders', () => {
  const payload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            preloaders: [
              {
                queryName: 'MarketplacePDPContainerQuery',
                variables: {
                  targetId: '1244539514326495'
                }
              },
              {
                queryName: 'CometMarketplaceLeftRailNavigationContainerQuery',
                variables: {
                  buyLocation: {
                    radius: 65,
                    latitude: 23.7302,
                    longitude: 90.4152,
                    vanityPageId: '101889586519301'
                  }
                }
              }
            ]
          }
        ]
      ]
    ]
  };

  const html = `<html><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`;
  const contexts = extractMarketplaceQueryContextsFromHtml(html);
  const listingQuery = contexts.find((context) => context.queryName === 'MarketplacePDPContainerQuery');
  const browseQuery = contexts.find(
    (context) => context.queryName === 'CometMarketplaceLeftRailNavigationContainerQuery'
  );

  assert.equal(listingQuery?.targetId, '1244539514326495');
  assert.equal(browseQuery?.buyLocation?.radius, 65);
  assert.equal(browseQuery?.buyLocation?.vanityPageId, '101889586519301');
});

test('extractMarketplaceQueryContextsFromHtml extracts seller profile query ids', () => {
  const payload = {
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            preloaders: [
              {
                queryName: 'MarketplaceSellerProfileInventoryQuery',
                variables: {
                  sellerID: '61572591435930',
                  scale: 2
                }
              }
            ]
          }
        ]
      ]
    ]
  };

  const html = `<html><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`;
  const contexts = extractMarketplaceQueryContextsFromHtml(html);

  assert.equal(contexts[0]?.queryName, 'MarketplaceSellerProfileInventoryQuery');
  assert.equal(contexts[0]?.sellerId, '61572591435930');
});

test('selectRouteDefinition prefers route definitions with location and numeric vanity ids', () => {
  const body =
    'for (;;);' +
    JSON.stringify({
      payload: {
        payloads: {
          '/marketplace/item/1/': {
            result: {
              exports: {
                canonicalRouteName: 'comet.fbweb.CometMarketplacePermalinkRoute',
                rootView: {
                  props: {
                    location: {
                      latitude: 1,
                      longitude: 2,
                      vanityPageId: 'category'
                    }
                  }
                }
              }
            }
          },
          '/marketplace/item/1/#bg': {
            result: {
              exports: {
                canonicalRouteName: 'comet.fbweb.CometMarketplacePermalinkRoute',
                rootView: {
                  props: {
                    location: {
                      latitude: 3,
                      longitude: 4,
                      vanityPageId: '101889586519301'
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

  const selected = selectRouteDefinition(parseBulkRouteDefinitionsBody(body), /CometMarketplacePermalinkRoute/);
  assert.equal(selected?.location?.latitude, 3);
  assert.equal(selected?.location?.vanityPageId, '101889586519301');
});

test('timeline parsers extract posts and page identity', () => {
  const fragments = loadFixture('timeline_fragment.json');
  const posts = parseTimelineFragments(fragments);
  const identity = parseTimelineIdentity(fragments);

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.hashtags.includes('launch'), true);
  assert.equal(identity.pageId, 'page-1');
  assert.equal(identity.pageName, 'Sample Page');
});
