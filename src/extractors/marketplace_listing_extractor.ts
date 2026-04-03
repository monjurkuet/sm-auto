import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { enableMarketplaceRequestFiltering, mergeMarketplaceLocationContext } from './marketplace_helpers';
import { normalizeMarketplaceListing } from '../normalizers/marketplace_listing_normalizer';
import { parseMarketplaceListingFromDom } from '../parsers/dom/marketplace_dom_parser';
import {
  summarizeDomMarketplaceListing,
  summarizeEmbeddedMarketplaceListing,
  summarizeRouteDefinitions
} from '../parsers/embedded/marketplace_artifact_summary';
import {
  createEmbeddedDocumentFragment,
  extractMarketplaceQueryContextsFromHtml,
  selectRouteDefinition
} from '../parsers/embedded/marketplace_embedded_parser';
import { parseMarketplaceListingFragments } from '../parsers/graphql/marketplace_parser';
import { buildMarketplaceListingUrl } from '../routes/marketplace_routes';
import type { ExtractorResult, MarketplaceListingResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const MARKETPLACE_LISTING_SIGNAL_WAIT_MS = 15_000;

async function waitForMarketplaceListingSignals(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3')).some(
        (element) => (element.textContent ?? '').trim().length > 0
      );
      const price = Array.from(document.querySelectorAll('span')).some((element) =>
        /^(BDT\s?[\d,]+|\$\s?[\d,]+|FREE)$/i.test((element.textContent ?? '').trim())
      );
      const sellerLink = Array.from(document.querySelectorAll('a')).some((anchor) =>
        (anchor.getAttribute('href') ?? '').includes('/marketplace/profile/')
      );
      const embeddedPayload = Boolean(document.querySelector('script[data-sjs]'));
      return (headings && price) || sellerLink || embeddedPayload;
    },
    { timeout: Math.min(timeoutMs, MARKETPLACE_LISTING_SIGNAL_WAIT_MS) }
  );
}

export async function extractMarketplaceListing(
  context: ScraperContext,
  listingId: string
): Promise<ExtractorResult<MarketplaceListingResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);
  const url = buildMarketplaceListingUrl(listingId);

  try {
    return await session.withPage(async (page) => {
      const routeCapture = new RouteDefinitionCapture();
      await routeCapture.attach(page);
      const disableRequestFiltering = await enableMarketplaceRequestFiltering(page);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await waitForMarketplaceListingSignals(page, context.timeoutMs);

        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
        const structuredFragments = embeddedDocument ? [embeddedDocument] : [];
        const fromStructured = parseMarketplaceListingFragments(structuredFragments, listingId);
        const fromDom = await parseMarketplaceListingFromDom(page, listingId);
        const listing = fromStructured
          ? {
              ...fromDom,
              ...fromStructured,
              price: {
                amount: fromStructured.price.amount ?? fromDom.price.amount,
                currency: fromStructured.price.currency ?? fromDom.price.currency,
                formatted: fromStructured.price.formatted ?? fromDom.price.formatted
              },
              images: fromStructured.images.length > 0 ? fromStructured.images : fromDom.images,
              seller: {
                id: fromStructured.seller.id ?? fromDom.seller.id,
                name: fromStructured.seller.name ?? fromDom.seller.name
              },
              location: {
                city: fromStructured.location.city ?? fromDom.location.city,
                fullLocation: fromStructured.location.fullLocation ?? fromDom.location.fullLocation,
                coordinates: fromStructured.location.coordinates ?? fromDom.location.coordinates
              }
            }
          : fromDom;
        const routes = routeCapture.records.flatMap((record) => record.routes);
        const routeDefinition = selectRouteDefinition(routes, /CometMarketplace(?:Hoisted)?PermalinkRoute/);
        const browseRouteDefinition = selectRouteDefinition(
          routes,
          /CometMarketplace(?:HomeRoute|SearchRoute|InboxRoute|NotificationsNavRoute|StatusRoute)|MarketplaceBuyingActivityRoute|MarketplaceSellingUIMRoute/
        );
        const queryContexts = extractMarketplaceQueryContextsFromHtml(html);
        const listingQueries = queryContexts.filter(
          (query) => query.targetId === listingId && /MarketplacePDP|MarketplacePermalink/i.test(query.queryName)
        );
        const buyLocation = mergeMarketplaceLocationContext(
          queryContexts.find((query) => query.buyLocation && /Marketplace/i.test(query.queryName))?.buyLocation ?? null,
          browseRouteDefinition?.location ?? routeDefinition?.location ?? null
        );

        return {
          data: {
            ...normalizeMarketplaceListing(url, listing),
            context: {
              routeName: routeDefinition?.canonicalRouteName ?? null,
              routeLocation: routeDefinition?.location ?? null,
              buyLocation,
              queryNames: [...new Set(listingQueries.map((query) => query.queryName))],
              targetId: listingQueries.find((query) => query.targetId)?.targetId ?? listingId,
              provenance: {
                title: fromStructured ? 'embedded_document' : 'dom',
                price: fromStructured ? 'embedded_document' : 'dom',
                seller: fromStructured ? 'embedded_document' : 'dom',
                location: fromStructured ? 'embedded_document' : 'dom',
                images: fromStructured ? 'embedded_document' : 'dom',
                description: fromStructured ? 'embedded_document' : 'dom',
                routeContext: 'route_definition'
              }
            }
          },
          artifacts: {
            embedded_document_summary: embeddedDocument
              ? summarizeEmbeddedMarketplaceListing([embeddedDocument], listingId)
              : null,
            route_definitions_summary: summarizeRouteDefinitions(routeCapture.records),
            collection_stats: {
              usedEmbeddedDocument: Boolean(embeddedDocument),
              usedStructuredListing: Boolean(fromStructured),
              usedDomFallback: !fromStructured,
              structuredImageCount: fromStructured?.images.length ?? 0,
              domImageCount: fromDom.images.length,
              blockedResourceTypes: ['image', 'media', 'font']
            },
            dom_listing_summary: summarizeDomMarketplaceListing(fromDom)
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
