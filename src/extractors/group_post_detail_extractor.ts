import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { enableRequestFiltering } from '../browser/request_filter';
import { GraphQLCapture } from '../capture/graphql_capture';
import { summarizeGraphqlFragments } from '../capture/graphql_artifact_summary';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { createEmbeddedDocumentFragment } from '../parsers/embedded/marketplace_embedded_parser';
import { extractGroupRouteIdentity } from '../parsers/embedded/group_route_identity';

import { collectGroupFeedFragments, parseGroupFeedFragments } from '../parsers/graphql/group_feed_parser';
import { collectGroupCommentFragments, parseGroupCommentFragments } from '../parsers/graphql/group_comment_parser';

import type { ExtractorResult, GroupPost, GroupPostDetailResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const INITIAL_POST_SIGNAL_WAIT_MS = 15_000;
const SCROLL_PROGRESS_WAIT_MS = 1_500;
const MAX_STALLED_SCROLLS = 10;
const MAX_STALLED_SCROLLS_CAP = 25;
const MAX_REPLY_EXPANSIONS = 50;

// ── Post signal detection ──

async function waitForPostSignals(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, INITIAL_POST_SIGNAL_WAIT_MS);

  while (Date.now() < deadline) {
    const hasContent = await page.evaluate(() => {
      const hasComments =
        document.querySelectorAll('[aria-label*="Comment"], [aria-label*="comment"]').length > 0;
      const hasReactions =
        document.querySelectorAll('[aria-label*="reaction"], [aria-label*="Like"]').length > 0;
      const hasPostContent =
        document.querySelectorAll('[data-ad-preview="message"]').length > 0;
      return hasComments || hasReactions || hasPostContent;
    });

    if (hasContent) return;
    await sleep(250);
  }

  throw new Error('Timed out waiting for group post detail signals');
}

// ── Reply thread expansion ──

async function expandReplyThreads(page: Page, maxExpansions: number): Promise<number> {
  let expanded = 0;

  for (let i = 0; i < maxExpansions; i++) {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('div[role="button"], span[role="button"]')
      ).filter((el) => /replies|View more|Show more|Reply$/i.test(el.textContent?.trim() ?? ''));

      if (buttons.length === 0) return false;
      (buttons[0] as HTMLElement).click();
      return true;
    });

    if (!clicked) break;
    expanded++;
    await sleep(800); // Wait for content to load
  }

  return expanded;
}

// ── Stall detection ──

export function computeMaxStalledScrolls(maxScrolls: number): number {
  if (maxScrolls >= 100) {
    return Math.min(
      MAX_STALLED_SCROLLS_CAP,
      Math.max(MAX_STALLED_SCROLLS, Math.floor(maxScrolls / 10))
    );
  }

  return MAX_STALLED_SCROLLS;
}

// ── Comment scrolling ──

interface CommentProgressSnapshot {
  fragmentCount: number;
  commentDomCount: number;
  scrollHeight: number;
}

async function countDomComments(page: Page): Promise<number> {
  return page.evaluate(() => {
    const commentElements = document.querySelectorAll(
      '[aria-label*="Comment"], [aria-label*="comment"], [data-commentid]'
    );
    return commentElements.length;
  }).catch(() => 0);
}

async function getCommentProgressSnapshot(
  page: Page,
  capture: GraphQLCapture
): Promise<CommentProgressSnapshot> {
  const [commentDomCount, scrollHeight] = await Promise.all([
    countDomComments(page),
    page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  ]);

  return {
    fragmentCount: collectGroupCommentFragments(capture.registry.all()).length,
    commentDomCount,
    scrollHeight
  };
}

async function waitForCommentProgress(
  page: Page,
  previous: CommentProgressSnapshot,
  timeoutMs: number
): Promise<void> {
  try {
    await page.waitForFunction(
      (previousHeight: number, previousCommentCount: number) => {
        const commentElements = document.querySelectorAll(
          '[aria-label*="Comment"], [aria-label*="comment"], [data-commentid]'
        );
        const currentCommentCount = commentElements.length;
        return document.body.scrollHeight > previousHeight || currentCommentCount > previousCommentCount;
      },
      { timeout: timeoutMs },
      previous.scrollHeight,
      previous.commentDomCount
    );
  } catch {
    // Stalls are expected once all comments have loaded
  }
}

async function scrollPostComments(
  page: Page,
  capture: GraphQLCapture,
  context: ScraperContext
): Promise<void> {
  let stalledScrolls = 0;
  let previous = await getCommentProgressSnapshot(page, capture);
  const maxStalledScrolls = computeMaxStalledScrolls(context.maxScrolls);

  context.logger.info('Group post detail scroll configuration', {
    maxScrolls: context.maxScrolls,
    maxStalledScrolls,
    scrollDelayMs: context.scrollDelayMs
  });

  for (let index = 0; index < context.maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 1200)));
    await waitForCommentProgress(page, previous, Math.max(context.scrollDelayMs, SCROLL_PROGRESS_WAIT_MS));

    const current = await getCommentProgressSnapshot(page, capture);
    const hasProgress =
      current.fragmentCount > previous.fragmentCount ||
      current.commentDomCount > previous.commentDomCount ||
      current.scrollHeight > previous.scrollHeight;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= maxStalledScrolls) {
        context.logger.info('Group post detail scrolling stopped after stall threshold', {
          attemptedScrolls: index + 1,
          maxScrolls: context.maxScrolls,
          stalledScrolls,
          maxStalledScrolls
        });
        break;
      }
    } else {
      stalledScrolls = 0;
    }

    previous = current;
  }
}

// ── Post ID extraction from URL ──

function extractPostIdFromUrl(url: string): string | null {
 const match = url.match(/\/groups\/[^/]+\/(?:posts|permalink)\/(\d+)/);
 return match?.[1] ?? null;
}

// ── Main extractor ──

export async function extractGroupPostDetail(
  context: ScraperContext,
  postUrl: string
): Promise<ExtractorResult<GroupPostDetailResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);
      const disableRequestFiltering = await enableRequestFiltering(page, ['image', 'media', 'font']);

      try {
        await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
        await waitForPostSignals(page, context.timeoutMs);
        await scrollPostComments(page, capture, context);
        const replyExpansions = await expandReplyThreads(page, MAX_REPLY_EXPANSIONS);

        context.logger.info('Group post detail reply expansion complete', {
          replyExpansions
        });

        // Collect feed fragments for post content
        const feedFragments = collectGroupFeedFragments(capture.registry.all());

        // Collect comment fragments
        const commentFragments = collectGroupCommentFragments(capture.registry.all());

        // Parse embedded document for additional data
        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);

        // Parse post content from feed fragments (+ embedded)
        const parserFeedFragments = embeddedDocument
          ? [...feedFragments, embeddedDocument]
          : feedFragments;
        const graphqlPosts = parseGroupFeedFragments(parserFeedFragments);

        // Select the post matching this URL's postId
        const postIdFromUrl = extractPostIdFromUrl(postUrl);
        let post: GroupPost | null = null;

        if (postIdFromUrl) {
          post = graphqlPosts.find((p) => p.postId === postIdFromUrl) ?? null;
        }
        if (!post && graphqlPosts.length > 0) {
          // Fallback: use the first post (permalink pages typically have one)
          post = graphqlPosts[0];
        }
        if (!post) {
          // Minimal placeholder so downstream consumers always get a well-typed object
          post = {
            id: postIdFromUrl,
            postId: postIdFromUrl,
            permalink: postUrl,
            createdAt: null,
            text: null,
            author: { id: null, name: null },
            media: [],
            metrics: { reactions: null, comments: null, shares: null },
            isApproved: null
          };
        }

        // Parse comments + replies
        const parserCommentFragments = embeddedDocument
          ? [...commentFragments, embeddedDocument]
          : commentFragments;
        const comments = parseGroupCommentFragments(parserCommentFragments);

 // Derive groupId: prefer the URL (canonical), fall back to route definitions
 const urlGroupId = postUrl.match(/\/groups\/([^/]+)\//)?.[1] ?? null;
 const routeIdentity = extractGroupRouteIdentity(routeCapture.records);
 const groupId = urlGroupId ?? routeIdentity.groupId ?? null;

        // Total comment count: from the post metrics if available, else from parsed comments
        const totalCommentCount = post.metrics.comments ?? comments.length ?? null;

        return {
          data: {
            postId: post.postId ?? postIdFromUrl,
            url: postUrl,
            groupId,
            post,
            comments,
            totalCommentCount,
            scrapedAt: new Date().toISOString()
          },
          artifacts: {
            graphql_feed_summary: summarizeGraphqlFragments(feedFragments),
            graphql_comment_summary: summarizeGraphqlFragments(commentFragments),
            route_capture_summary: {
              responseCount: routeCapture.records.length,
              routeCount: routeCapture.records.flatMap((record) => record.routes).length,
              groupId,
              vanitySlug: routeIdentity.vanitySlug
            },
            reply_expansion_count: replyExpansions,
            embedded_document_summary: embeddedDocument
              ? { fragmentCount: embeddedDocument.fragments.length }
              : null,
            collection_stats: {
              parsedPostCount: graphqlPosts.length,
              parsedCommentCount: comments.length,
              capturedFeedFragmentCount: feedFragments.length,
              capturedCommentFragmentCount: commentFragments.length,
              blockedResourceTypes: ['image', 'media', 'font']
            }
          }
        };
      } finally {
        await capture.detach(page).catch(() => undefined);
        await routeCapture.detach(page).catch(() => undefined);
        await disableRequestFiltering().catch(() => undefined);
      }
    });
  } finally {
    await chrome.disconnect();
  }
}
