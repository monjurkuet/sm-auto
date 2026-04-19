import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep, waitForCondition } from '../core/sleep';
import {
  collectMarketplaceSearchFragments,
  countMarketplaceItemLinks,
  enableMarketplaceRequestFiltering,
  mergeMarketplaceLocationContext
} from './marketplace_helpers';
import {
  summarizeMarketplaceGraphqlFragments,
  summarizeEmbeddedMarketplaceSearch,
  summarizeRouteDefinitions
} from '../parsers/embedded/marketplace_artifact_summary';
import {
  createEmbeddedDocumentFragment,
  extractMarketplaceSearchContextFromHtml,
  selectRouteLocation
} from '../parsers/embedded/marketplace_embedded_parser';
import { parseMarketplaceSearchFragments } from '../parsers/graphql/marketplace_parser';
import { buildMarketplaceSearchUrl } from '../routes/marketplace_routes';
import type { ExtractorResult, MarketplaceSearchResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const INITIAL_SEARCH_SIGNAL_WAIT_MS = 15_000;
const SCROLL_PROGRESS_WAIT_MS = 1_500;
const MAX_STALLED_SCROLLS = 3;

interface MarketplaceSearchProgressSnapshot {
  fragmentCount: number;
  itemLinkCount: number;
  scrollHeight: number;
}

async function getMarketplaceSearchProgressSnapshot(
  page: Page,
  capture: GraphQLCapture
): Promise<MarketplaceSearchProgressSnapshot> {
  const [itemLinkCount, scrollHeight] = await Promise.all([
    countMarketplaceItemLinks(page).catch(() => 0),
    page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  ]);

  return {
    fragmentCount: collectMarketplaceSearchFragments(capture.registry.all()).length,
    itemLinkCount,
    scrollHeight
  };
}

async function waitForMarketplaceSearchSignals(page: Page, capture: GraphQLCapture, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, INITIAL_SEARCH_SIGNAL_WAIT_MS);

  while (Date.now() < deadline) {
    const fragmentCount = collectMarketplaceSearchFragments(capture.registry.all()).length;
    if (fragmentCount > 0) {
      return;
    }

    const itemLinkCount = await countMarketplaceItemLinks(page).catch(() => 0);
    if (itemLinkCount > 0) {
      return;
    }

    await sleep(250);
  }

  throw new Error('Timed out waiting for marketplace search results');
}

async function waitForMarketplaceSearchProgress(
  page: Page,
  previous: MarketplaceSearchProgressSnapshot,
  timeoutMs: number
): Promise<void> {
  try {
    await page.waitForFunction(
      (previousHeight: number, previousItemLinkCount: number) => {
        const currentItemLinkCount = new Set(
          Array.from(document.querySelectorAll('a'))
            .map((anchor) => anchor.getAttribute('href'))
            .map((href) => href?.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null)
            .filter((itemId): itemId is string => Boolean(itemId))
        ).size;

        return document.body.scrollHeight > previousHeight || currentItemLinkCount > previousItemLinkCount;
      },
      { timeout: timeoutMs },
      previous.scrollHeight,
      previous.itemLinkCount
    );
  } catch {
    // Pagination stalls are expected once the search feed is exhausted.
  }
}

async function scrollMarketplaceSearchResults(
  page: Page,
  capture: GraphQLCapture,
  context: ScraperContext
): Promise<void> {
  let stalledScrolls = 0;
  let previous = await getMarketplaceSearchProgressSnapshot(page, capture);

  for (let index = 0; index < context.maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 1200)));
    await waitForMarketplaceSearchProgress(page, previous, Math.max(context.scrollDelayMs, SCROLL_PROGRESS_WAIT_MS));

    const current = await getMarketplaceSearchProgressSnapshot(page, capture);
    const hasProgress =
      current.fragmentCount > previous.fragmentCount ||
      current.itemLinkCount > previous.itemLinkCount ||
      current.scrollHeight > previous.scrollHeight;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= MAX_STALLED_SCROLLS) {
        break;
      }
    } else {
      stalledScrolls = 0;
    }

    previous = current;
  }
}

export async function extractMarketplaceSearch(
  context: ScraperContext,
  query: string,
  location: string
): Promise<ExtractorResult<MarketplaceSearchResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);
  const searchUrl = buildMarketplaceSearchUrl(query, location);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);
      const disableRequestFiltering = await enableMarketplaceRequestFiltering(page);

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await waitForMarketplaceSearchSignals(page, capture, context.timeoutMs);
        await waitForCondition(() => routeCapture.records.length > 0, Math.min(context.timeoutMs, 5_000), {
          message: 'Timed out waiting for marketplace search condition'
        }).catch(() => undefined);
        await scrollMarketplaceSearchResults(page, capture, context);

        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
        await capture.detach(page);
        const relevantFragments = collectMarketplaceSearchFragments(capture.registry.all());
        const parserFragments = embeddedDocument ? [...relevantFragments, embeddedDocument] : relevantFragments;
        const listings = parseMarketplaceSearchFragments(parserFragments);
        const routes = routeCapture.records.flatMap((record) => record.routes);
        const routeLocation = mergeMarketplaceLocationContext(
          selectRouteLocation(routes, /CometMarketplaceSearchRoute/),
          selectRouteLocation(
            routes,
            /CometMarketplace(?:HomeRoute|SearchRoute|GroupsRoute|InboxRoute|NotificationsNavRoute|StatusRoute|PermalinkRoute)|MarketplaceBuyingActivityRoute|MarketplaceSellingUIMRoute/
          )
        );
        const embeddedSearchContext = extractMarketplaceSearchContextFromHtml(html);

        return {
          data: {
            query,
            location,
            searchUrl,
            searchContext: {
              buyLocation: mergeMarketplaceLocationContext(embeddedSearchContext, routeLocation)
            },
            listings,
            scrapedAt: new Date().toISOString()
          },
          artifacts: {
            graphql_summary: summarizeMarketplaceGraphqlFragments(relevantFragments),
            embedded_document_summary: embeddedDocument ? summarizeEmbeddedMarketplaceSearch([embeddedDocument]) : null,
            route_definitions_summary: summarizeRouteDefinitions(routeCapture.records),
            collection_stats: {
              parsedListingCount: listings.length,
              blockedResourceTypes: ['image', 'media', 'font'],
              capturedFragmentCount: relevantFragments.length,
              capturedRouteCount: routeCapture.records.length
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
