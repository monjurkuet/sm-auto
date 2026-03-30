import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractBalancedJsonSegment,
  extractLocationFromEmbeddedData,
  extractProfileTileItems
} from '../src/parsers/dom/embedded_dom_parser';
import {
  parseBio,
  parseContactInfoFromDom,
  parseFollowerCount,
  parseFollowingCount,
  parseLocation,
  type PageDomSnapshot
} from '../src/parsers/dom/page_dom_parser';

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
  assert.deepEqual(contact.websites, [
    'https://example.com',
    'https://instagram.com/sample.brand',
    'https://x.com/samplebrand'
  ]);
  assert.deepEqual(contact.addresses, ['Dhaka, Bangladesh']);
  assert.deepEqual(contact.socialMedia, [
    { platform: 'instagram', handle: 'sample.brand', url: 'https://instagram.com/sample.brand' },
    { platform: 'x', handle: 'samplebrand', url: 'https://x.com/samplebrand' }
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
    spans: ['Location', 'Dhaka, Bangladesh']
  });

  assert.equal(parseLocation(snapshot), 'Dhaka, Bangladesh');
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
