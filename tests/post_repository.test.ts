import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findFacebookPostRecordId,
  persistPagePostsSurface
} from '../src/storage/postgres/post_repository';
import type { PagePostsResult } from '../src/types/contracts';

interface RecordedQuery {
  text: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];

  async query(text: string, values: unknown[] = []): Promise<{ rows: Array<{ id: number }> }> {
    this.queries.push({ text, values });

    if (/SELECT id\s+FROM scraper\.facebook_posts/i.test(text)) {
      return { rows: [{ id: 42 }] };
    }

    if (/INSERT INTO scraper\.facebook_post_scrapes/i.test(text)) {
      return { rows: [{ id: 7 }] };
    }

    return { rows: [] };
  }
}

function createPagePostsResult(): PagePostsResult {
  return {
    pageId: '100064688828733',
    url: 'https://www.facebook.com/ryanscomputers',
    posts: [
      {
        id: 'story-1',
        postId: 'post-1',
        permalink: 'https://www.facebook.com/ryanscomputers/posts/post-1',
        createdAt: 1774872389,
        text: 'Post body',
        hashtags: ['Ryans'],
        mentions: ['Dhaka'],
        links: ['https://ryans.com/'],
        media: [
          {
            type: 'photo',
            id: 'media-1',
            url: 'https://example.com/photo.jpg',
            width: 1080,
            height: 1080
          },
          {
            type: 'video',
            id: 'media-2',
            url: 'https://example.com/video.mp4',
            durationSec: 12.5
          }
        ],
        metrics: {
          reactions: 12,
          comments: 3,
          shares: 1
        },
        author: {
          id: '100064688828733',
          name: 'Ryans Computers Ltd.'
        }
      }
    ],
    scrapedAt: '2026-03-31T00:00:00.000Z'
  };
}

test('findFacebookPostRecordId resolves preferred identifiers in one query', async () => {
  const client = new FakeClient();
  const result = createPagePostsResult();

  const recordId = await findFacebookPostRecordId(client as never, result.posts[0]!);

  assert.equal(recordId, 42);
  assert.equal(client.queries.length, 1);
  assert.match(client.queries[0]!.text, /ORDER BY/);
  assert.deepEqual(client.queries[0]!.values, [
    'post-1',
    'story-1',
    'https://www.facebook.com/ryanscomputers/posts/post-1'
  ]);
});

test('persistPagePostsSurface bulk inserts tags and media per post scrape', async () => {
  const client = new FakeClient();
  const result = createPagePostsResult();

  const completion = await persistPagePostsSurface(client as never, 'run-1', {
    data: result,
    artifacts: {
      graphql_summary: { responseCount: 1 }
    }
  });

  const scrapeInsert = client.queries.find((query) => /INSERT INTO scraper\.facebook_post_scrapes/i.test(query.text));
  const tagInsert = client.queries.find((query) => /INSERT INTO scraper\.facebook_post_tags/i.test(query.text));
  const mediaInsert = client.queries.find((query) => /INSERT INTO scraper\.facebook_post_media/i.test(query.text));

  assert.ok(scrapeInsert);
  assert.ok(tagInsert);
  assert.ok(mediaInsert);
  assert.match(scrapeInsert!.text, /ON CONFLICT \(scrape_run_id, post_record_id\)/i);
  assert.match(tagInsert!.text, /FROM unnest/);
  assert.match(mediaInsert!.text, /FROM unnest/);
  assert.deepEqual(completion.outputSummary, {
    pageId: '100064688828733',
    postCount: 1
  });
});

test('persistPagePostsSurface upserts duplicate logical posts in the same run', async () => {
  const client = new FakeClient();
  const result = createPagePostsResult();
  result.posts.push({
    ...result.posts[0]!,
    id: 'story-2'
  });

  await persistPagePostsSurface(client as never, 'run-1', {
    data: result,
    artifacts: {
      graphql_summary: { responseCount: 1 }
    }
  });

  const scrapeInserts = client.queries.filter((query) => /INSERT INTO scraper\.facebook_post_scrapes/i.test(query.text));
  assert.equal(scrapeInserts.length, 2);
  assert.ok(scrapeInserts.every((query) => /ON CONFLICT \(scrape_run_id, post_record_id\)/i.test(query.text)));
  assert.deepEqual(
    scrapeInserts.map((query) => query.values.slice(0, 2)),
    [
      ['run-1', 42],
      ['run-1', 42]
    ]
  );
});
