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
import { snapshotPostMetrics, mergePostMetricSnapshots } from '../parsers/dom/post_dom_parser';

import { collectGroupFeedFragments, parseGroupFeedFragments } from '../parsers/graphql/group_feed_parser';
import { normalizeGroupPosts } from '../normalizers/group_post_normalizer';
import type { ExtractorResult, GroupPostsResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const INITIAL_FEED_SIGNAL_WAIT_MS = 15_000;
const SCROLL_PROGRESS_WAIT_MS = 1_500;
const MAX_STALLED_SCROLLS = 10;
const MAX_STALLED_SCROLLS_CAP = 25;

interface GroupPostsProgressSnapshot {
  fragmentCount: number;
  postLinkCount: number;
  scrollHeight: number;
}

async function countGroupPostLinks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pattern = /\/groups\/[^/]+\/posts\//;
    const seen = new Set<string>();
    Array.from(document.querySelectorAll('a')).forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (href && pattern.test(href)) {
        seen.add(href);
      }
    });
    return seen.size;
  });
}

async function getGroupPostsProgressSnapshot(
  page: Page,
  capture: GraphQLCapture
): Promise<GroupPostsProgressSnapshot> {
  const [postLinkCount, scrollHeight] = await Promise.all([
    countGroupPostLinks(page).catch(() => 0),
    page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  ]);

  return {
    fragmentCount: collectGroupFeedFragments(capture.registry.all()).length,
    postLinkCount,
    scrollHeight
  };
}

async function waitForGroupFeedSignals(page: Page, capture: GraphQLCapture, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, INITIAL_FEED_SIGNAL_WAIT_MS);

  while (Date.now() < deadline) {
    const fragmentCount = collectGroupFeedFragments(capture.registry.all()).length;
    if (fragmentCount > 0) {
      return;
    }

    const postLinkCount = await countGroupPostLinks(page).catch(() => 0);
    if (postLinkCount > 0) {
      return;
    }

    await sleep(250);
  }

  throw new Error('Timed out waiting for group feed signals');
}

async function waitForGroupPostsProgress(
  page: Page,
  previous: GroupPostsProgressSnapshot,
  timeoutMs: number
): Promise<void> {
  try {
    await page.waitForFunction(
      (previousHeight: number, previousPostLinkCount: number) => {
        const pattern = /\/groups\/[^/]+\/posts\//;
        const seen = new Set<string>();
        Array.from(document.querySelectorAll('a')).forEach((anchor) => {
          const href = anchor.getAttribute('href');
          if (href && pattern.test(href)) {
            seen.add(href);
          }
        });
        const currentPostLinkCount = seen.size;
        return document.body.scrollHeight > previousHeight || currentPostLinkCount > previousPostLinkCount;
      },
      { timeout: timeoutMs },
      previous.scrollHeight,
      previous.postLinkCount
    );
  } catch {
    // Pagination stalls are expected once the group feed is exhausted.
  }
}

export function computeMaxStalledScrolls(maxScrolls: number): number {
  if (maxScrolls >= 100) {
    return Math.min(MAX_STALLED_SCROLLS_CAP, Math.max(MAX_STALLED_SCROLLS, Math.floor(maxScrolls / 10)));
  }

  return MAX_STALLED_SCROLLS;
}

async function scrollGroupPosts(
  page: Page,
  capture: GraphQLCapture,
  context: ScraperContext
): Promise<void> {
  let stalledScrolls = 0;
  let previous = await getGroupPostsProgressSnapshot(page, capture);
  const maxStalledScrolls = computeMaxStalledScrolls(context.maxScrolls);

  context.logger.info('Group posts scroll configuration', {
    maxScrolls: context.maxScrolls,
    maxStalledScrolls,
    scrollDelayMs: context.scrollDelayMs
  });

  for (let index = 0; index < context.maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 1200)));
    await waitForGroupPostsProgress(page, previous, Math.max(context.scrollDelayMs, SCROLL_PROGRESS_WAIT_MS));

    const current = await getGroupPostsProgressSnapshot(page, capture);
    const hasProgress =
      current.fragmentCount > previous.fragmentCount ||
      current.postLinkCount > previous.postLinkCount ||
      current.scrollHeight > previous.scrollHeight;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= maxStalledScrolls) {
        context.logger.info('Group posts scrolling stopped after stall threshold', {
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

export async function extractGroupPosts(
  context: ScraperContext,
  groupUrl: string
): Promise<ExtractorResult<GroupPostsResult>> {
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
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
        await waitForGroupFeedSignals(page, capture, context.timeoutMs);
        const metricSnapshots = await snapshotPostMetrics(page);
        await scrollGroupPosts(page, capture, context);
        metricSnapshots.push(...(await snapshotPostMetrics(page)));

        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
        const relevantFragments = collectGroupFeedFragments(capture.registry.all());
        const parserFragments = embeddedDocument ? [...relevantFragments, embeddedDocument] : relevantFragments;
        const domMetrics = mergePostMetricSnapshots(metricSnapshots);

        const graphqlPosts = parseGroupFeedFragments(parserFragments);
        const posts = normalizeGroupPosts(graphqlPosts, domMetrics);

        const routes = routeCapture.records.flatMap((record) => record.routes);
        const routeIdentity = extractGroupRouteIdentity(routeCapture.records);
        const groupId = routeIdentity.groupId ?? null;

        return {
          data: {
            groupId,
            url: groupUrl,
            posts,
            scrapedAt: new Date().toISOString()
          },
          artifacts: {
            graphql_summary: summarizeGraphqlFragments(relevantFragments),
            route_capture_summary: {
              responseCount: routeCapture.records.length,
              routeCount: routes.length,
              groupId,
              vanitySlug: routeIdentity.vanitySlug
            },
            dom_metrics_summary: {
              metricEntryCount: domMetrics.length,
              postLinkCount: await countGroupPostLinks(page).catch(() => 0),
              postCount: posts.length
            },
            embedded_document_summary: embeddedDocument
              ? { fragmentCount: embeddedDocument.fragments.length }
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
