import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { enableRequestFiltering } from '../browser/request_filter';
import { GraphQLCapture } from '../capture/graphql_capture';
import { summarizeGraphqlFragments } from '../capture/graphql_artifact_summary';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { normalizePosts } from '../normalizers/post_normalizer';
import { createEmbeddedDocumentFragment } from '../parsers/embedded/marketplace_embedded_parser';
import { extractFacebookPageRouteIdentity } from '../parsers/embedded/page_route_identity';
import { mergePostMetricSnapshots, snapshotPostMetrics } from '../parsers/dom/post_dom_parser';
import { collectTimelineFragments, parseTimelineFragments, parseTimelineIdentity } from '../parsers/graphql/timeline_parser';
import type { ExtractorResult, PagePostsResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const PAGE_POSTS_SIGNAL_WAIT_MS = 15_000;
const PAGE_POSTS_SCROLL_PROGRESS_WAIT_MS = 1_500;
const MAX_STALLED_PAGE_POST_SCROLLS = 3;

interface PagePostsProgressSnapshot {
  relevantFragmentCount: number;
  renderedPostCount: number;
  scrollHeight: number;
}

async function countRenderedPosts(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('div[data-ad-preview="message"]').length);
}

async function waitForPagePostsSignals(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const messageNodes = document.querySelectorAll('div[data-ad-preview="message"]').length;
      const postActions = Array.from(document.querySelectorAll('[aria-label]')).some((element) =>
        /Actions for this post|See who reacted to this|Leave a comment/i.test(
          element.getAttribute('aria-label') ?? ''
        )
      );
      const embeddedPayload = Boolean(document.querySelector('script[data-sjs]'));

      return messageNodes > 0 || postActions || embeddedPayload;
    },
    { timeout: Math.min(timeoutMs, PAGE_POSTS_SIGNAL_WAIT_MS) }
  );
}

async function getPagePostsProgressSnapshot(page: Page, capture: GraphQLCapture): Promise<PagePostsProgressSnapshot> {
  const [renderedPostCount, scrollHeight] = await Promise.all([
    countRenderedPosts(page).catch(() => 0),
    page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  ]);

  return {
    relevantFragmentCount: collectTimelineFragments(capture.registry.all()).length,
    renderedPostCount,
    scrollHeight
  };
}

async function waitForPagePostsProgress(
  page: Page,
  previous: PagePostsProgressSnapshot,
  timeoutMs: number
): Promise<void> {
  try {
    await page.waitForFunction(
      (previousHeight: number, previousPostCount: number) => {
        const currentPostCount = document.querySelectorAll('div[data-ad-preview="message"]').length;
        return document.body.scrollHeight > previousHeight || currentPostCount > previousPostCount;
      },
      { timeout: timeoutMs },
      previous.scrollHeight,
      previous.renderedPostCount
    );
  } catch {
    // Timeline feeds frequently stall after the currently loaded window is exhausted.
  }
}

async function scrollPagePosts(page: Page, capture: GraphQLCapture, context: ScraperContext): Promise<void> {
  let stalledScrolls = 0;
  let previous = await getPagePostsProgressSnapshot(page, capture);

  for (let index = 0; index < context.maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 1200)));
    await waitForPagePostsProgress(page, previous, Math.max(context.scrollDelayMs, PAGE_POSTS_SCROLL_PROGRESS_WAIT_MS));
    await sleep(250);

    const current = await getPagePostsProgressSnapshot(page, capture);
    const hasProgress =
      current.relevantFragmentCount > previous.relevantFragmentCount ||
      current.renderedPostCount > previous.renderedPostCount ||
      current.scrollHeight > previous.scrollHeight;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= MAX_STALLED_PAGE_POST_SCROLLS) {
        break;
      }
    } else {
      stalledScrolls = 0;
    }

    previous = current;
  }
}

export async function extractPagePosts(
  context: ScraperContext,
  pageUrl: string
): Promise<ExtractorResult<PagePostsResult>> {
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
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await waitForPagePostsSignals(page, context.timeoutMs);
        const metricSnapshots = await snapshotPostMetrics(page);
        await scrollPagePosts(page, capture, context);
        metricSnapshots.push(...(await snapshotPostMetrics(page)));

        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
        const relevantFragments = collectTimelineFragments(capture.registry.all());
        const parserFragments = embeddedDocument ? [...relevantFragments, embeddedDocument] : relevantFragments;
        const domMetrics = mergePostMetricSnapshots(metricSnapshots);

        const routes = routeCapture.records.flatMap((record) => record.routes);
        const routeIdentity = extractFacebookPageRouteIdentity(routes);
        const timelineIdentity = parseTimelineIdentity(parserFragments);
        const pageId = routeIdentity?.pageId ?? timelineIdentity.pageId ?? null;

        if (!pageId) {
          throw new Error(`Failed to extract page ID for ${pageUrl}. Skipping scrape.`);
        }

        const graphqlPosts = parseTimelineFragments(parserFragments);
        const posts = normalizePosts(graphqlPosts, domMetrics);

        return {
          data: {
            pageId,
            url: pageUrl,
            posts,
            scrapedAt: new Date().toISOString()
          },
          artifacts: {
            graphql_summary: summarizeGraphqlFragments(relevantFragments),
            route_capture_summary: {
              responseCount: routeCapture.records.length,
              routeCount: routes.length,
              matchedRouteName: routeIdentity?.matchedRouteName ?? null,
              matchedRouteUrl: routeIdentity?.matchedRouteUrl ?? null,
              pageId
            },
            dom_metrics_summary: {
              metricEntryCount: domMetrics.length,
              renderedPostCount: await countRenderedPosts(page).catch(() => 0),
              postCount: posts.length
            },
            embedded_document_summary: embeddedDocument
              ? {
                  fragmentCount: embeddedDocument.fragments.length
                }
              : null
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
