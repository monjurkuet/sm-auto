import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistPageInfoSurface,
  upsertFacebookPageContacts,
  upsertFacebookPageSocialLinks
} from '../src/storage/postgres/page_repository';
import type { PageInfoResult } from '../src/types/contracts';

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

function createPageInfoResult(): PageInfoResult {
  return {
    pageId: '100064688828733',
    url: 'https://www.facebook.com/ryanscomputers',
    name: 'Ryans Computers Ltd.',
    category: 'Computer Store',
    followers: 394000,
    following: 115,
    bio: "Bangladesh's leading nationwide computer retail chain.",
    location: 'Dhaka, Bangladesh',
    contact: {
      phones: ['+8801711000000', '+8801711000000'],
      emails: ['support@example.com'],
      websites: ['https://example.com'],
      addresses: ['Dhaka, Bangladesh'],
      socialMedia: [
        { platform: 'instagram', handle: 'sample.brand', url: 'https://instagram.com/sample.brand' },
        { platform: 'x', handle: 'samplebrand', url: 'https://x.com/samplebrand' }
      ]
    },
    transparency: {
      creationDate: 'March 12, 2015',
      history: []
    },
    scrapedAt: '2026-03-30T00:00:00.000Z'
  };
}

test('upsertFacebookPageContacts syncs contact rows in bulk', async () => {
  const client = new FakeClient();
  await upsertFacebookPageContacts(client as never, '100064688828733', createPageInfoResult());

  assert.equal(client.queries.length, 2);
  assert.match(client.queries[0].text, /UPDATE scraper\.facebook_page_contacts existing/);
  assert.match(client.queries[1].text, /INSERT INTO scraper\.facebook_page_contacts/);
  assert.deepEqual(client.queries[1].values[1], ['phone', 'email', 'website', 'address']);
  assert.deepEqual(client.queries[1].values[2], [
    '+8801711000000',
    'support@example.com',
    'https://example.com',
    'Dhaka, Bangladesh'
  ]);
});

test('upsertFacebookPageSocialLinks syncs social rows in bulk', async () => {
  const client = new FakeClient();
  await upsertFacebookPageSocialLinks(client as never, '100064688828733', createPageInfoResult());

  assert.equal(client.queries.length, 2);
  assert.match(client.queries[0].text, /UPDATE scraper\.facebook_page_social_links existing/);
  assert.match(client.queries[1].text, /INSERT INTO scraper\.facebook_page_social_links/);
  assert.deepEqual(client.queries[1].values[1], ['instagram', 'x']);
  assert.deepEqual(client.queries[1].values[2], ['sample.brand', 'samplebrand']);
  assert.deepEqual(client.queries[1].values[3], [
    'https://instagram.com/sample.brand',
    'https://x.com/samplebrand'
  ]);
});

test('upsertFacebookPageSocialLinks keeps multiple urls for the same platform', async () => {
  const client = new FakeClient();
  const pageInfo = createPageInfoResult();
  pageInfo.contact.socialMedia = [
    { platform: 'youtube', handle: '@primarychannel', url: 'https://youtube.com/@primarychannel' },
    { platform: 'youtube', handle: '@secondarychannel', url: 'https://youtube.com/@secondarychannel' }
  ];

  await upsertFacebookPageSocialLinks(client as never, '100064688828733', pageInfo);

  assert.deepEqual(client.queries[1].values[1], ['youtube', 'youtube']);
  assert.deepEqual(client.queries[1].values[2], ['@primarychannel', '@secondarychannel']);
  assert.deepEqual(client.queries[1].values[3], [
    'https://youtube.com/@primarychannel',
    'https://youtube.com/@secondarychannel'
  ]);
});

test('persistPageInfoSurface writes enriched page columns and compact artifacts', async () => {
  const client = new FakeClient();
  const pageInfo = createPageInfoResult();

  const completion = await persistPageInfoSurface(client as never, 'run-1', {
    data: pageInfo,
    artifacts: {
      route_capture_summary: { pageId: pageInfo.pageId, matchedRouteName: 'ProfileTimelineRoute' },
      collection_stats: { navigationCount: 3 }
    }
  });

  const pageUpsertQuery = client.queries.find((query) => /INSERT INTO scraper\.facebook_pages/.test(query.text));
  const pageScrapeQuery = client.queries.find((query) => /INSERT INTO scraper\.facebook_page_scrapes/.test(query.text));
  const socialInsertQuery = client.queries.find((query) => /INSERT INTO scraper\.facebook_page_social_links/.test(query.text));
  const artifactQueries = client.queries.filter((query) => /INSERT INTO scraper\.scrape_artifacts/.test(query.text));

  assert.ok(pageUpsertQuery);
  assert.match(pageUpsertQuery!.text, /following,/);
  assert.match(pageUpsertQuery!.text, /bio,/);
  assert.match(pageUpsertQuery!.text, /location_text,/);

  assert.ok(pageScrapeQuery);
  assert.match(pageScrapeQuery!.text, /following,/);
  assert.match(pageScrapeQuery!.text, /bio,/);
  assert.match(pageScrapeQuery!.text, /location_text,/);

  assert.ok(socialInsertQuery);
  assert.equal(artifactQueries.length, 2);
  assert.deepEqual(completion.outputSummary, {
    pageId: '100064688828733',
    name: 'Ryans Computers Ltd.',
    followers: 394000,
    contactCount: 4,
    socialLinkCount: 2
  });
});
