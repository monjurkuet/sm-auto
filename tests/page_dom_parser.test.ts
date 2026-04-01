import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  extractBalancedJsonSegment,
  extractLocationFromEmbeddedData,
  extractProfileTileItems
} from '../src/parsers/dom/embedded_dom_parser';
import {
  parseBio,
  parseCategory,
  parseContactInfoFromDom,
  parseCreationDate,
  parseFollowerCount,
  parseFollowingCount,
  parseLocation,
  type PageDomSnapshot
} from '../src/parsers/dom/page_dom_parser';

function readFixture(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name), 'utf8');
}

function createSnapshot(overrides: Partial<PageDomSnapshot> = {}): PageDomSnapshot {
  return {
    title: 'Sample Page | Facebook',
    url: 'https://www.facebook.com/sample-page',
    headings: [],
    spans: [],
    links: [],
    ...overrides
  };
}

test('parseFollowerCount reads combined follower/following text', () => {
  const snapshot = createSnapshot({
    spans: ['394K followers • 115 following']
  });

  assert.equal(parseFollowerCount(snapshot), 394000);
});

test('parseFollowingCount reads standalone following text', () => {
  const snapshot = createSnapshot({
    spans: ['115 following']
  });

  assert.equal(parseFollowingCount(snapshot), 115);
});

test('parseContactInfoFromDom extracts and deduplicates phones, emails, websites, and social links', () => {
  const snapshot = createSnapshot({
    spans: ['01711-000000', 'Phone', 'Dhaka, Bangladesh', 'Address', 'support@example.com'],
    links: [
      { href: 'mailto:support@example.com', text: 'Email' },
      { href: 'tel:+8801711000000', text: 'Phone' },
      { href: 'https://example.com', text: 'Website' },
      { href: 'https://instagram.com/sample.brand', text: 'Instagram' },
      { href: 'https://x.com/samplebrand', text: 'X' }
    ]
  });

  const contact = parseContactInfoFromDom(snapshot);

  assert.deepEqual(contact.phones, ['+8801711000000', '01711-000000']);
  assert.deepEqual(contact.emails, ['support@example.com']);
  assert.deepEqual(contact.websites, ['https://example.com/']);
  assert.deepEqual(contact.addresses, ['Dhaka, Bangladesh']);
  assert.deepEqual(contact.socialMedia, [
    { platform: 'instagram', handle: 'sample.brand', url: 'https://instagram.com/sample.brand' },
    { platform: 'x', handle: 'samplebrand', url: 'https://x.com/samplebrand' }
  ]);
});

test('parseContactInfoFromDom unwraps Facebook outbound links before classifying websites and social handles', () => {
  const snapshot = createSnapshot({
    links: [
      {
        href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fryans.com%2F&h=example',
        text: 'ryans.com'
      },
      {
        href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fx.com%2FRyansComputers&h=example',
        text: 'RyansComputers'
      }
    ]
  });

  const contact = parseContactInfoFromDom(snapshot);

  assert.deepEqual(contact.websites, ['https://ryans.com/']);
  assert.deepEqual(contact.socialMedia, [
    { platform: 'x', handle: 'RyansComputers', url: 'https://x.com/RyansComputers' }
  ]);
});

test('parseContactInfoFromDom keeps multiple links from the same social platform', () => {
  const snapshot = createSnapshot({
    links: [
      {
        href: 'https://youtube.com/@primarychannel',
        text: 'Primary Channel'
      },
      {
        href: 'https://youtube.com/@secondarychannel',
        text: 'Secondary Channel'
      }
    ]
  });

  const contact = parseContactInfoFromDom(snapshot);

  assert.deepEqual(contact.websites, []);
  assert.deepEqual(contact.socialMedia, [
    { platform: 'youtube', handle: '@primarychannel', url: 'https://youtube.com/@primarychannel' },
    { platform: 'youtube', handle: '@secondarychannel', url: 'https://youtube.com/@secondarychannel' }
  ]);
});

test('parseBio returns descriptive business text and skips follower metadata', () => {
  const snapshot = createSnapshot({
    spans: [
      '394K followers',
      "Bangladesh's leading computers chain with nationwide service and a strong reputation for authentic products."
    ]
  });

  assert.equal(
    parseBio(snapshot),
    "Bangladesh's leading computers chain with nationwide service and a strong reputation for authentic products."
  );
});

test('parseLocation prefers labeled location values from the DOM', () => {
  const snapshot = createSnapshot({
    spans: ['Location', 'Austin, Texas, United States · Dallas, Texas, United States']
  });

  assert.equal(parseLocation(snapshot), 'Austin, Texas, United States');
});

test('parseLocation prefers location-like spans over narrative bio text in fallback mode', () => {
  const snapshot = createSnapshot({
    spans: [
      "Ryans Computers, Bangladesh's leading nationwide computer retail chain, offers expert tech advice to help you find your ideal computer and IT solution.",
      'Rangpur, Rangpur Division, Bangladesh · Khulna, Khulna Division, Bangladesh'
    ]
  });

  assert.equal(parseLocation(snapshot), 'Rangpur, Rangpur Division, Bangladesh');
});

test('parseCategory reads the short Page bullet label instead of falling back to the page title', () => {
  const snapshot = createSnapshot({
    headings: ['Ryans Computers Ltd.', 'Intro'],
    spans: ['Page · Computer shop']
  });

  assert.equal(parseCategory(snapshot), 'Computer shop');
});

test('parseCreationDate reads labeled and inline creation date values', () => {
  const labeledSnapshot = createSnapshot({
    spans: ['March 12, 2015', 'Page created']
  });
  const inlineSnapshot = createSnapshot({
    spans: ['Created: April 2, 2019']
  });

  assert.equal(parseCreationDate(labeledSnapshot), 'March 12, 2015');
  assert.equal(parseCreationDate(inlineSnapshot), 'April 2, 2019');
});

test('extractBalancedJsonSegment isolates a marked embedded JSON object', () => {
  const html =
    '<html><body>prefix ' +
    '"profile_tile_sections":{"items":[{"item_subtitle":{"text":{"text":"Dhaka, Bangladesh"}}}],"meta":{"note":"brace } inside string"}}' +
    ' suffix</body></html>';

  const segment = extractBalancedJsonSegment(html, '"profile_tile_sections":');

  assert.equal(segment?.startsWith('"profile_tile_sections":{'), true);
  assert.equal(segment?.includes('Dhaka, Bangladesh'), true);
  assert.equal(segment?.endsWith('}'), true);
});

test('extractProfileTileItems parses embedded profile subtitles', () => {
  const html =
    '<html><body>' +
    '"profile_tile_sections":{"items":[{"item_subtitle":{"text":{"text":"95% recommend (223 Reviews)"}}},{"item_subtitle":{"text":{"text":"Dhaka, Bangladesh + 2"}}}]}' +
    '</body></html>';

  assert.deepEqual(extractProfileTileItems(html), ['95% recommend (223 Reviews)', 'Dhaka, Bangladesh + 2']);
});

test('extractLocationFromEmbeddedData skips non-location values and cleans location suffixes', () => {
  const location = extractLocationFromEmbeddedData([
    '95% recommend (223 Reviews)',
    'Closed now',
    '120 people checked in here',
    'Dhaka, Bangladesh + 2'
  ]);

  assert.equal(location, 'Dhaka, Bangladesh');
});

test('fixture-driven profile tile extraction works on stored page-info fixtures', () => {
  const ryansItems = extractProfileTileItems(readFixture('ryanscomputers_fullpage.html'));
  const ihubItems = extractProfileTileItems(readFixture('ihubmobiles_fullpage.html'));

  assert.ok(ryansItems.length > 0);
  assert.ok(ihubItems.length > 0);
  assert.equal(extractLocationFromEmbeddedData(ryansItems), 'Rangpur, Rangpur Division, Bangladesh');
  assert.ok(extractLocationFromEmbeddedData(ihubItems));
});
