import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePosts } from '../src/normalizers/post_normalizer';
import { mergePostMetricSnapshots } from '../src/parsers/dom/post_dom_parser';
import type { PagePost } from '../src/types/contracts';

const basePost: PagePost = {
  id: '1',
  postId: '1',
  permalink: 'https://example.com/post/1',
  createdAt: 1,
  text: 'Hello world from the page',
  hashtags: [],
  mentions: [],
  links: [],
  media: [],
  metrics: {
    reactions: null,
    comments: null,
    shares: null
  },
  author: {
    id: 'page',
    name: 'Page'
  }
};

test('normalizePosts maps DOM metrics by message text instead of array position', () => {
  const posts = [
    basePost,
    {
      ...basePost,
      id: '2',
      postId: '2',
      permalink: 'https://example.com/post/2',
      text: 'Another post with different text'
    }
  ];

  const result = normalizePosts(posts, [
    {
      messageText: 'Another post with different text',
      reactions: 9,
      comments: 2,
      shares: 1
    },
    {
      messageText: 'Hello world from the page',
      reactions: 4,
      comments: 0,
      shares: 0
    }
  ]);

  assert.equal(result[0]?.metrics.reactions, 4);
  assert.equal(result[1]?.metrics.reactions, 9);
});

test('mergePostMetricSnapshots deduplicates by text and keeps richer metrics', () => {
  const merged = mergePostMetricSnapshots([
    {
      messageText: 'Hello world',
      reactions: null,
      comments: null,
      shares: null
    },
    {
      messageText: '  hello   world ',
      reactions: 12,
      comments: null,
      shares: null
    },
    {
      messageText: 'Another post',
      reactions: 3,
      comments: 1,
      shares: null
    }
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((entry) => entry.messageText?.toLowerCase().includes('hello'))?.reactions, 12);
});
