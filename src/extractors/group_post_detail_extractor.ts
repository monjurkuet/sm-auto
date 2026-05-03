import type { Page, ElementHandle } from 'puppeteer-core';

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
import { snapshotPostMetrics } from '../parsers/dom/post_dom_parser';
import { extractCommentsFromDom } from '../parsers/dom/comment_dom_parser';
import { normalizeGroupPosts } from '../normalizers/group_post_normalizer';

import type { ExtractorResult, GroupPost, GroupPostComment, GroupPostDetailResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const INITIAL_POST_SIGNAL_WAIT_MS = 15_000;
const DIALOG_SCROLL_STEP = 500;
const DIALOG_SCROLL_DELAY_MS = 800;
const REPLY_EXPANSION_ROUNDS = 3;
const MAX_REPLY_EXPANSIONS_PER_ROUND = 80;

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
      const hasDialog = document.querySelector('div[role="dialog"]') !== null;
      const hasArticles = document.querySelectorAll('div[role="article"]').length > 0;
      return hasComments || hasReactions || hasPostContent || hasDialog || hasArticles;
    });

    if (hasContent) return;
    await sleep(500);
  }

  throw new Error('Timed out waiting for group post detail signals');
}

// ── Dialog scroll container detection ──

/**
 * Find the scrollable container that holds comments.
 * 
 * Facebook renders post detail pages in two layouts:
 * 1. **Dialog mode**: post opens in a modal overlay (div[role="dialog"]) — 
 *    the scrollable comment container is a child of the dialog.
 * 2. **Full-page mode**: post loads as a standalone page — the scrollable 
 *    comment container is inside [role="main"] or the page body.
 * 
 * In both cases, scrolling the page body (window.scrollBy) does NOT load 
 * comments. We must find and scroll the specific container element.
 */
async function findDialogScrollContainer(page: Page): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle(() => {
    // Strategy 1: Look inside div[role="dialog"] first (dialog/modeal layout)
    const dialog = document.querySelector('div[role="dialog"]');
    const searchRoot = dialog ?? document.querySelector('[role="main"]') ?? document.body;

    const allDivs = Array.from(searchRoot.querySelectorAll('div')) as Element[];
    let best: Element | null = null;
    let maxArticles = 0;

    for (const div of allDivs) {
      const style = getComputedStyle(div);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        div.scrollHeight > div.clientHeight + 50 &&
        div !== document.body &&
        div !== document.documentElement
      ) {
        const articleCount = div.querySelectorAll('div[role="article"]').length;
        if (articleCount > maxArticles) {
          maxArticles = articleCount;
          best = div;
        }
      }
    }

    return best;
  });

  const element = handle.asElement();
  if (!element) return null;
  // Type assertion: evaluateHandle returns ElementHandle<Element> for DOM elements
  return element as ElementHandle<Element>;
}

// ── Comment counting ──

interface CommentCountSnapshot {
  articles: number;
  topLevelIds: number;
  totalIds: number;
}

async function countCommentsInContainer(
  container: ElementHandle<Element>
): Promise<CommentCountSnapshot> {
  return container.evaluate((el) => {
    const topLevelIds = new Set<string>();
    const allIds = new Set<string>();
    const articles = Array.from(el.querySelectorAll('div[role="article"]')) as Element[];

    for (const art of articles) {
      for (const link of Array.from(art.querySelectorAll('a[href*="comment_id"]')) as Element[]) {
        const href = link.getAttribute('href') ?? '';
        const replyMatch = href.match(/reply_comment_id=(\d+)/);
        const commentMatch = href.match(/comment_id=(\d+)/);

        if (commentMatch) {
          allIds.add(commentMatch[1]);
          if (!replyMatch) topLevelIds.add(commentMatch[1]);
        }
        if (replyMatch) {
          allIds.add(replyMatch[1]);
        }
      }
    }

    return { articles: articles.length, topLevelIds: topLevelIds.size, totalIds: allIds.size };
  });
}

// ── Stall detection ──

export function computeMaxStalledScrolls(maxScrolls: number): number {
  // For dialog-based comment scrolling, Facebook loads comments in batches
  // with large gaps between batches. Use a high stall threshold.
  if (maxScrolls >= 100) {
    return Math.min(50, Math.max(25, Math.floor(maxScrolls / 5)));
  }
  return 25;
}

// ── Dialog container scrolling ──

/**
 * Scroll within the dialog's comment container to lazy-load all comments.
 * This is the key function: Facebook loads comments incrementally as the
 * dialog's internal scrollable container is scrolled, NOT the page body.
 */
async function scrollDialogComments(
  page: Page,
  container: ElementHandle<Element>,
  context: ScraperContext
): Promise<CommentCountSnapshot> {
  const maxStalledScrolls = computeMaxStalledScrolls(context.maxScrolls);
  let stalledScrolls = 0;
  let previous = await countCommentsInContainer(container);

  context.logger.info('Dialog scroll configuration', {
    maxScrolls: context.maxScrolls,
    maxStalledScrolls,
    initialComments: previous.totalIds,
  });

  for (let index = 0; index < context.maxScrolls; index += 1) {
    await container.evaluate((el) => {
      el.scrollTop += 500;
    });
    await sleep(DIALOG_SCROLL_DELAY_MS);

    const current = await countCommentsInContainer(container);
    const hasProgress = current.totalIds > previous.totalIds;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= maxStalledScrolls) {
        context.logger.info('Dialog scrolling stalled', {
          attemptedScrolls: index + 1,
          totalIds: current.totalIds,
          stalledScrolls,
        });
        break;
      }
    } else {
      stalledScrolls = 0;
    }

    previous = current;
  }

  return previous;
}

// ── Reply thread expansion ──

/**
 * Click "View all X replies" / "X replies" buttons inside the container.
 * Returns total number of expansions across all rounds.
 */
async function expandReplyThreads(
  page: Page,
  container: ElementHandle<Element>,
  maxRounds: number,
  maxPerRound: number
): Promise<number> {
  let totalExpanded = 0;

  for (let round = 0; round < maxRounds; round++) {
    let roundExpanded = 0;

    for (let i = 0; i < maxPerRound; i++) {
      const clicked = await container.evaluate((el) => {
        const buttons = Array.from(
          el.querySelectorAll('div[role="button"], span[role="button"]')
        );
        const replyBtn = buttons.find((btn) => {
          const text = btn.textContent?.trim() ?? '';
          return /repl/i.test(text) && /\d+/.test(text) && !/^Reply$/i.test(text);
        });
        if (replyBtn) {
          (replyBtn as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (!clicked) break;
      roundExpanded++;
      await sleep(600);
    }

    totalExpanded += roundExpanded;

    if (roundExpanded === 0) break;

    // After expanding replies, scroll down to reveal more buttons
    for (let i = 0; i < 10; i++) {
      await container.evaluate((el) => {
        el.scrollTop += 500;
      });
      await sleep(500);
    }
  }

  return totalExpanded;
}

// ── Full comment loading pipeline ──

/**
 * Complete pipeline for loading all comments in a dialog-based post detail page:
 * 1. Scroll down to load all top-level comments
 * 2. Expand reply threads iteratively
 * 3. Re-scroll after expansion to reveal newly loaded content
 * 4. Repeat until stable
 */
async function loadAllComments(
  page: Page,
  container: ElementHandle<Element>,
  context: ScraperContext
): Promise<{ scrollCount: number; replyExpansions: number; finalCount: CommentCountSnapshot }> {
  // Phase 1: Scroll to load all top-level comments
  const afterScroll = await scrollDialogComments(page, container, context);
  const scrollCount = afterScroll.totalIds;

  // Phase 2: Expand reply threads with re-scroll between rounds
  const replyExpansions = await expandReplyThreads(
    page,
    container,
    REPLY_EXPANSION_ROUNDS,
    MAX_REPLY_EXPANSIONS_PER_ROUND
  );

  // Phase 3: Re-scroll after reply expansion to load more
  let stalled = 0;
  let prev = await countCommentsInContainer(container);
  let reScrollCount = 0;
  for (let i = 0; i < 50; i++) {
    await container.evaluate((el) => { el.scrollTop += 500; });
    await sleep(DIALOG_SCROLL_DELAY_MS);
    reScrollCount++;
    const current = await countCommentsInContainer(container);
    if (current.totalIds === prev.totalIds) {
      stalled++;
    } else {
      stalled = 0;
    }
    prev = current;
    if (stalled >= 15) break;
  }

  // Phase 4: One more reply expansion pass after re-scroll
  const finalExpansions = await expandReplyThreads(page, container, 2, 50);

  const finalCount = await countCommentsInContainer(container);

  context.logger.info('Comment loading pipeline complete', {
    afterInitialScroll: scrollCount,
    replyExpansions: replyExpansions + finalExpansions,
    reScrollCount,
    finalTopLevel: finalCount.topLevelIds,
    finalTotal: finalCount.totalIds,
  });

  return { scrollCount, replyExpansions: replyExpansions + finalExpansions, finalCount };
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

        // Wait a moment for the dialog/container to fully render.
        // Facebook renders the page shell first, then the dialog overlay.
        await sleep(2000);

        // Find the comment scroll container (the key discovery)
        // Retry: the dialog/container may take a moment to render after page signals
        let container: ElementHandle<Element> | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          container = await findDialogScrollContainer(page);
          if (container) break;
          context.logger.info('Comment scroll container not found, waiting and retrying', { attempt: attempt + 1 });
          await sleep(3000);
        }

        let commentLoadResult = {
          scrollCount: 0,
          replyExpansions: 0,
          finalCount: { articles: 0, topLevelIds: 0, totalIds: 0 } as CommentCountSnapshot,
        };

        if (container) {
          context.logger.info('Found comment scroll container, using container-based scrolling');
          commentLoadResult = await loadAllComments(page, container, context);
        } else {
          context.logger.warn('No dialog scroll container found, falling back to body scroll');
          // Fallback: scroll the page body (legacy behavior)
          for (let i = 0; i < context.maxScrolls; i++) {
            await page.evaluate(() => window.scrollBy(0, 1200));
            await sleep(context.scrollDelayMs);
          }
          // Legacy reply expansion
          for (let i = 0; i < 50; i++) {
            const clicked = await page.evaluate(() => {
              const buttons = Array.from(
                document.querySelectorAll('div[role="button"], span[role="button"]')
              ).filter((el) => /replies|View more|Show more/i.test(el.textContent?.trim() ?? ''));
              if (buttons.length === 0) return false;
              (buttons[0] as HTMLElement).click();
              return true;
            });
            if (!clicked) break;
            await sleep(800);
          }
        }

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
          post = graphqlPosts[0];
        }
        if (!post) {
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

        // Parse comments + replies from GraphQL/embedded
        const parserCommentFragments = embeddedDocument
          ? [...commentFragments, embeddedDocument]
          : commentFragments;
        const gqlComments = parseGroupCommentFragments(parserCommentFragments);

        // Extract comments from the DOM (now includes all loaded comments after scrolling)
        let domComments: GroupPostComment[] = [];
        try {
          const domResult = await extractCommentsFromDom(page);
          domComments = domResult.comments;
          context.logger.info('DOM comment extraction result', {
            domCommentCount: domComments.length,
            domTotalVisible: domResult.totalVisible,
          });
        } catch (e) {
          context.logger.warn('DOM comment extraction failed, using GraphQL/embedded only', {
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // Merge: prefer GraphQL/embedded comments (richer data), fill gaps with DOM comments
        const effectivePostId = post.postId ?? postIdFromUrl;
        const filteredGqlComments = effectivePostId
          ? gqlComments.filter((c) => c.id != null && c.id.startsWith(effectivePostId + '_'))
          : gqlComments;
        const filteredDomComments = effectivePostId
          ? domComments.filter((c) => c.id != null && c.id.startsWith(effectivePostId + '_'))
          : domComments;

        // Build merged comment map — GraphQL first (richer), then DOM for missing IDs
        const commentMap = new Map<string, GroupPostComment>();
        for (const c of filteredGqlComments) {
          if (c.id) commentMap.set(c.id, c);
        }
        for (const c of filteredDomComments) {
          if (!c.id) continue;
          const existing = commentMap.get(c.id);
          if (!existing) {
            commentMap.set(c.id, c);
          } else {
            // Merge: fill in null fields from DOM
            if (existing.text === null && c.text !== null) existing.text = c.text;
            if (existing.author.name === null && c.author.name !== null) existing.author.name = c.author.name;
            if (existing.author.id === null && c.author.id !== null) existing.author.id = c.author.id;
            if (existing.metrics.reactions === null && c.metrics.reactions !== null) existing.metrics.reactions = c.metrics.reactions;
            if (existing.metrics.replies === null && c.metrics.replies !== null) existing.metrics.replies = c.metrics.replies;
            if (existing.parentId === null && c.parentId !== null) existing.parentId = c.parentId;
            if (existing.createdAt === null && c.createdAt !== null) existing.createdAt = c.createdAt;
          }
        }
        const comments = Array.from(commentMap.values());

        context.logger.info('Comment merge result', {
          effectivePostId,
          gqlCommentCount: filteredGqlComments.length,
          domCommentCount: filteredDomComments.length,
          mergedCommentCount: comments.length,
          dialogLoadedTotal: commentLoadResult.finalCount.totalIds,
        });

        // Derive groupId
        const urlGroupId = postUrl.match(/\/groups\/([^/]+)\//)?.[1] ?? null;
        const routeIdentity = extractGroupRouteIdentity(routeCapture.records);
        const groupId = urlGroupId ?? routeIdentity.groupId ?? null;

        // Total comment count
        const totalCommentCount = post.metrics.comments ?? comments.length ?? null;

        // DOM metrics fallback
        try {
          const domMetrics = await snapshotPostMetrics(page);
          if (domMetrics.length > 0) {
            const merged = normalizeGroupPosts([post], domMetrics);
            if (merged.length > 0) {
              post = merged[0];
            }
          }
        } catch (e) {
          context.logger.warn('DOM metrics snapshot failed for post detail', {
            error: e instanceof Error ? e.message : String(e)
          });
        }

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
            reply_expansion_count: commentLoadResult.replyExpansions,
            embedded_document_summary: embeddedDocument
              ? { fragmentCount: embeddedDocument.fragments.length }
              : null,
            dialog_comment_loading: {
              foundDialogContainer: container !== null,
              scrollCount: commentLoadResult.scrollCount,
              replyExpansions: commentLoadResult.replyExpansions,
              finalTopLevel: commentLoadResult.finalCount.topLevelIds,
              finalTotalIds: commentLoadResult.finalCount.totalIds,
              finalArticles: commentLoadResult.finalCount.articles,
            },
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
