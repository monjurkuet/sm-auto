import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';

import {
  extractMarketplaceSellerLocationText,
  normalizeMarketplaceListingDomSnapshot,
  normalizeMarketplaceSellerListingCards,
  parseMarketplaceSellerFromDom
} from '../src/parsers/dom/marketplace_dom_parser';

function createSellerDomDocument() {
  const spans = [
    'John Smith',
    'Joined Facebook in 2021',
    '4.8 (12)',
    'Responsive to messages',
    'Just listed',
    'BDT20,000',
    'Austin, Texas, United States'
  ].map((text) => ({ textContent: text }));

  const listingSpan = (text: string) => ({ textContent: text });

  const listingAnchor = {
    href: '/marketplace/item/123/?ref=marketplace_profile',
    getAttribute(name: string) {
      return name === 'href' ? this.href : null;
    },
    textContent: 'BDT20,000 Used Bike Austin, Texas, United States',
    querySelectorAll(selector: string) {
      return selector === 'span'
        ? [listingSpan('BDT20,000'), listingSpan('Used Bike'), listingSpan('Austin, Texas, United States')]
        : [];
    }
  };

  return {
    querySelectorAll(selector: string) {
      if (selector === 'span') {
        return spans;
      }

      if (selector === 'a[href]') {
        return [
          {
            href: '/profile/ignore',
            getAttribute(name: string) {
              return name === 'href' ? '/profile/ignore' : null;
            },
            textContent: 'Seller details',
            querySelectorAll() {
              return [];
            }
          },
          listingAnchor
        ];
      }

      if (selector === 'a[href*="/marketplace/profile/"]') {
        return [listingAnchor];
      }

      return [];
    },
    title: 'Marketplace - John Smith | Facebook'
  };
}

function createSandboxedPage() {
  const document = createSellerDomDocument();

  return {
    async evaluate<T>(fn: (...args: unknown[]) => T, sellerId: string): Promise<T> {
      const sandbox = {
        document,
        URL,
        Set,
        Array,
        Math,
        Number,
        String,
        Boolean,
        RegExp,
        JSON,
        sellerId,
        console,
        result: undefined as T | undefined
      };

      vm.createContext(sandbox);
      vm.runInContext(`result = (${fn.toString()})(sellerId)`, sandbox);
      return sandbox.result as T;
    }
  };
}

test('normalizeMarketplaceListingDomSnapshot parses numeric price and listed-in location text', () => {
  const listing = normalizeMarketplaceListingDomSnapshot('listing-1', {
    title: 'Iphone 15 pro max',
    searchTexts: [
      'Iphone 15 pro max',
      'BDT90,000',
      'Listed a day ago in ঢাকা, বাংলাদেশ',
      'a day ago',
      'ঢাকা, বাংলাদেশ',
      'Send'
    ],
    descriptionTexts: ['A clean device with box and charger included.'],
    sellerHref: '/marketplace/profile/100015054489436/',
    sellerName: 'M.A. Rasel',
    images: [
      {
        url: 'https://example.com/listing.jpg',
        width: 1080,
        height: 1080
      }
    ]
  });

  assert.equal(listing.price.amount, 90000);
  assert.equal(listing.price.currency, 'BDT');
  assert.equal(listing.location.city, 'ঢাকা');
  assert.equal(listing.location.fullLocation, 'ঢাকা, বাংলাদেশ');
  assert.equal(listing.seller.id, '100015054489436');
});

test('normalizeMarketplaceListingDomSnapshot accepts spaced currency formats', () => {
  const listing = normalizeMarketplaceListingDomSnapshot('listing-1', {
    title: 'Iphone 15 pro max',
    searchTexts: ['Iphone 15 pro max', 'BDT 90,000', 'Dhaka, Bangladesh'],
    descriptionTexts: [],
    sellerHref: '/marketplace/profile/100015054489436/',
    sellerName: 'M.A. Rasel',
    images: []
  });

  assert.equal(listing.price.amount, 90000);
  assert.equal(listing.price.currency, 'BDT');
  assert.equal(listing.price.formatted, 'BDT 90,000');
});

test('normalizeMarketplaceListingDomSnapshot falls back to a location-like tail entry when listed-in text is absent', () => {
  const listing = normalizeMarketplaceListingDomSnapshot('listing-2', {
    title: 'Yamaha Rx 100',
    searchTexts: ['Yamaha Rx 100', 'BDT20,000', 'Narayanganj'],
    descriptionTexts: [],
    sellerHref: '/marketplace/profile/200/',
    sellerName: 'Seller Two',
    images: []
  });

  assert.equal(listing.price.amount, 20000);
  assert.equal(listing.location.fullLocation, 'Narayanganj');
  assert.equal(listing.location.city, 'Narayanganj');
});

test('normalizeMarketplaceSellerListingCards prefers marketplace profile inventory over browse recommendations', () => {
  const listings = normalizeMarketplaceSellerListingCards(
    [
      {
        href: '/marketplace/item/111/?ref=browse_tab&referral_code=marketplace_top_picks',
        text: 'BDT5,000 Noise Item Dhaka, Bangladesh',
        spanTexts: ['BDT5,000', 'Noise Item', 'Dhaka, Bangladesh']
      },
      {
        href: '/marketplace/item/222/?ref=marketplace_profile&referral_code=undefined',
        text: 'BDT90,000 Iphone 15 pro max Dhaka, Bangladesh',
        spanTexts: ['BDT90,000', 'Iphone 15 pro max', 'Dhaka, Bangladesh']
      },
      {
        href: '/marketplace/item/333/?ref=marketplace_profile&referral_code=undefined',
        text: 'BDT52,500 MSI Modern 15 Ryzen 5 5500U Dhaka, Bangladesh',
        spanTexts: ['BDT52,500', 'MSI Modern 15 Ryzen 5 5500U', 'Dhaka, Bangladesh']
      }
    ],
    'seller-1',
    'Seller One'
  );

  assert.deepEqual(
    listings.map((listing) => listing.id),
    ['222', '333']
  );
  assert.equal(listings[0]?.seller.id, 'seller-1');
  assert.equal(listings[0]?.seller.name, 'Seller One');
});

test('normalizeMarketplaceSellerListingCards falls back to generic item links when profile refs are absent', () => {
  const listings = normalizeMarketplaceSellerListingCards(
    [
      {
        href: '/marketplace/item/444/?ref=browse_tab',
        text: 'BDT20,000 Yamaha Rx 100 Narayanganj',
        spanTexts: ['BDT20,000', 'Yamaha Rx 100', 'Narayanganj']
      }
    ],
    'seller-1',
    'Seller One'
  );

  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.id, '444');
  assert.equal(listings[0]?.title, 'Yamaha Rx 100');
  assert.equal(listings[0]?.location.fullLocation, 'Narayanganj');
  assert.equal(listings[0]?.price.formatted, 'BDT20,000');
});

test('extractMarketplaceSellerLocationText is locale-agnostic', () => {
  const location = extractMarketplaceSellerLocationText(
    ['John Smith', 'Austin, Texas, United States', 'Joined Facebook in 2019'],
    'John Smith'
  );

  assert.equal(location, 'Austin, Texas, United States');
});

test('parseMarketplaceSellerFromDom derives location outside browser scope', async () => {
  const seller = await parseMarketplaceSellerFromDom(createSandboxedPage() as never, 'seller-1');

  assert.equal(seller.seller.id, 'seller-1');
  assert.equal(seller.seller.name, 'John Smith');
  assert.equal(seller.seller.location, 'Austin, Texas, United States');
  assert.equal(seller.seller.rating, 4.8);
  assert.equal(seller.seller.reviewCount, 12);
  assert.equal(seller.listings.length, 1);
  assert.equal(seller.listings[0]?.id, '123');
});

test('normalizeMarketplaceSellerListingCards deduplicates repeated listing ids and keeps the richer card', () => {
  const listings = normalizeMarketplaceSellerListingCards(
    [
      {
        href: '/marketplace/item/555/?ref=marketplace_profile',
        text: 'BDT69,490 ZTE Nubia Z50 Ultra',
        spanTexts: ['BDT69,490', 'ZTE Nubia Z50 Ultra']
      },
      {
        href: '/marketplace/item/555/?ref=marketplace_profile',
        text: 'BDT69,490 ZTE Nubia Z50 Ultra Dhaka, Bangladesh',
        spanTexts: ['BDT69,490', 'ZTE Nubia Z50 Ultra', 'Dhaka, Bangladesh']
      }
    ],
    'seller-1',
    'Seller One'
  );

  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.id, '555');
  assert.equal(listings[0]?.location.fullLocation, 'Dhaka, Bangladesh');
});
