import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import {
  countMarketplaceItemLinks,
  enableMarketplaceRequestFiltering,
  mergeMarketplaceLocationContext
} from './marketplace_helpers';
import { normalizeMarketplaceSeller } from '../normalizers/seller_normalizer';
import { parseMarketplaceSellerFromDom } from '../parsers/dom/marketplace_dom_parser';
import {
  summarizeDomMarketplaceSeller,
  summarizeEmbeddedMarketplaceSeller,
  summarizeRouteDefinitions
} from '../parsers/embedded/marketplace_artifact_summary';
import {
  createEmbeddedDocumentFragment,
  extractMarketplaceQueryContextsFromHtml,
  selectRouteDefinition
} from '../parsers/embedded/marketplace_embedded_parser';
import { parseMarketplaceSellerFragments } from '../parsers/graphql/marketplace_parser';
import { buildMarketplaceSellerUrl } from '../routes/marketplace_routes';
import type { ExtractorResult, MarketplaceSellerResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const MARKETPLACE_SELLER_SIGNAL_WAIT_MS = 15_000;
const SELLER_SCROLL_PROGRESS_WAIT_MS = 2_000;
const MAX_STALLED_SELLER_SCROLLS = 2;

interface MarketplaceSellerProgressSnapshot {
  itemLinkCount: number;
  scrollHeight: number;
}

async function waitForMarketplaceSellerSignals(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const memberSince = Array.from(document.querySelectorAll('span')).some((element) =>
        /^Joined Facebook in /i.test((element.textContent ?? '').trim())
      );
      const inventoryLink = Array.from(document.querySelectorAll('a')).some((anchor) =>
        (anchor.getAttribute('href') ?? '').includes('/marketplace/item/')
      );
      const embeddedPayload = Boolean(document.querySelector('script[data-sjs]'));
      return memberSince || inventoryLink || embeddedPayload;
    },
    { timeout: Math.min(timeoutMs, MARKETPLACE_SELLER_SIGNAL_WAIT_MS) }
  );
}

async function getMarketplaceSellerProgressSnapshot(page: Page): Promise<MarketplaceSellerProgressSnapshot> {
  const [itemLinkCount, scrollHeight] = await Promise.all([
    countMarketplaceItemLinks(page).catch(() => 0),
    page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  ]);

  return {
    itemLinkCount,
    scrollHeight
  };
}

async function waitForMarketplaceSellerProgress(
  page: Page,
  previous: MarketplaceSellerProgressSnapshot,
  timeoutMs: number
): Promise<void> {
  try {
    await page.waitForFunction(
      (previousHeight: number, previousItemLinkCount: number) => {
        const currentItemLinkCount = new Set(
          Array.from(document.querySelectorAll('a'))
            .map((anchor) => anchor.getAttribute('href'))
            .filter((href) => typeof href === 'string' && href.includes('/marketplace/item/'))
        ).size;

        return document.body.scrollHeight > previousHeight || currentItemLinkCount > previousItemLinkCount;
      },
      { timeout: timeoutMs },
      previous.scrollHeight,
      previous.itemLinkCount
    );
  } catch {
    // Seller inventory pages often stop loading without an explicit terminal marker.
  }
}

async function scrollMarketplaceSellerInventory(page: Page, context: ScraperContext): Promise<void> {
  let stalledScrolls = 0;
  let previous = await getMarketplaceSellerProgressSnapshot(page);
  const maxScrollAttempts = Math.max(3, Math.ceil(context.maxScrolls / 2));

  for (let index = 0; index < maxScrollAttempts; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 1200)));
    await waitForMarketplaceSellerProgress(
      page,
      previous,
      Math.max(context.scrollDelayMs, SELLER_SCROLL_PROGRESS_WAIT_MS)
    );

    const current = await getMarketplaceSellerProgressSnapshot(page);
    const hasProgress = current.itemLinkCount > previous.itemLinkCount || current.scrollHeight > previous.scrollHeight;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= MAX_STALLED_SELLER_SCROLLS) {
        break;
      }
    } else {
      stalledScrolls = 0;
    }

    previous = current;
  }
}

export async function extractMarketplaceSeller(
  context: ScraperContext,
  sellerId: string
): Promise<ExtractorResult<MarketplaceSellerResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);
  const url = buildMarketplaceSellerUrl(sellerId);

  try {
    return await session.withPage(async (page) => {
      const routeCapture = new RouteDefinitionCapture();
      await routeCapture.attach(page);
      const disableRequestFiltering = await enableMarketplaceRequestFiltering(page);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await waitForMarketplaceSellerSignals(page, context.timeoutMs);

        let html = await page.content();
        let embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
        let structuredFragments = embeddedDocument ? [embeddedDocument] : [];
        let structuredSeller = parseMarketplaceSellerFragments(structuredFragments, sellerId);
        let scrolledInventory = false;

        if (structuredSeller.listings.length === 0) {
          await scrollMarketplaceSellerInventory(page, context);
          scrolledInventory = true;
          html = await page.content();
          embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
          structuredFragments = embeddedDocument ? [embeddedDocument] : [];
          structuredSeller = parseMarketplaceSellerFragments(structuredFragments, sellerId);
        }

        const domSeller = await parseMarketplaceSellerFromDom(page, sellerId);
        const routes = routeCapture.records.flatMap((record) => record.routes);
        const routeDefinition = selectRouteDefinition(routes, /CometMarketplaceSellerProfileDialogRoute/);
        const browseRouteDefinition = selectRouteDefinition(
          routes,
          /CometMarketplace(?:HomeRoute|SearchRoute|InboxRoute|NotificationsNavRoute|StatusRoute)|MarketplaceBuyingActivityRoute|MarketplaceSellingUIMRoute/
        );
        const queryContexts = extractMarketplaceQueryContextsFromHtml(html);
        const sellerQueries = queryContexts.filter(
          (query) => query.sellerId === sellerId && /MarketplaceSellerProfile/i.test(query.queryName)
        );
        const buyLocation = mergeMarketplaceLocationContext(
          queryContexts.find((query) => query.buyLocation && /Marketplace/i.test(query.queryName))?.buyLocation ?? null,
          browseRouteDefinition?.location ?? null
        );
        const seller = normalizeMarketplaceSeller({
          sellerId,
          seller: {
            id: structuredSeller.seller.id ?? domSeller.seller.id,
            name: structuredSeller.seller.name ?? domSeller.seller.name,
            about: structuredSeller.seller.about ?? domSeller.seller.about,
            rating: structuredSeller.seller.rating ?? domSeller.seller.rating,
            reviewCount: structuredSeller.seller.reviewCount ?? domSeller.seller.reviewCount,
            location: structuredSeller.seller.location ?? domSeller.seller.location,
            memberSince: structuredSeller.seller.memberSince ?? domSeller.seller.memberSince
          },
          context: {
            routeName: routeDefinition?.canonicalRouteName ?? null,
            routeLocation: routeDefinition?.location ?? null,
            buyLocation,
            queryNames: [...new Set(sellerQueries.map((query) => query.queryName))],
            sellerId: sellerQueries.find((query) => query.sellerId)?.sellerId ?? sellerId,
            provenance: {
              profile: structuredSeller.seller.id ? 'embedded_document' : 'dom',
              inventory: structuredSeller.listings.length > 0 ? 'embedded_document' : 'dom',
              routeContext: 'route_definition'
            }
          },
          listings: structuredSeller.listings.length > 0 ? structuredSeller.listings : domSeller.listings,
          scrapedAt: new Date().toISOString()
        });

        return {
          data: seller,
          artifacts: {
            embedded_document_summary: embeddedDocument ? summarizeEmbeddedMarketplaceSeller([embeddedDocument]) : null,
            route_definitions_summary: summarizeRouteDefinitions(routeCapture.records),
            collection_stats: {
              scrolledInventory,
              usedEmbeddedDocument: Boolean(embeddedDocument),
              usedStructuredInventory: structuredSeller.listings.length > 0,
              usedDomInventoryFallback: structuredSeller.listings.length === 0,
              structuredInventoryCount: structuredSeller.listings.length,
              domInventoryCount: domSeller.listings.length,
              blockedResourceTypes: ['image', 'media', 'font']
            },
            dom_seller_summary: summarizeDomMarketplaceSeller(domSeller)
          }
        };
      } finally {
        await routeCapture.detach(page).catch(() => undefined);
        await disableRequestFiltering().catch(() => undefined);
      }
    });
  } finally {
    await chrome.disconnect();
  }
}
