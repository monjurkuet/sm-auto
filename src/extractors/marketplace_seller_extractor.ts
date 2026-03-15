import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { normalizeMarketplaceSeller } from '../normalizers/seller_normalizer';
import { parseMarketplaceSellerFromDom } from '../parsers/dom/marketplace_dom_parser';
import {
  summarizeEmbeddedMarketplaceSeller,
  summarizeMarketplaceGraphqlFragments,
  summarizeRouteDefinitions
} from '../parsers/embedded/marketplace_artifact_summary';
import {
  createEmbeddedDocumentFragment,
  extractMarketplaceQueryContextsFromHtml,
  selectRouteDefinition
} from '../parsers/embedded/marketplace_embedded_parser';
import { parseMarketplaceSellerFragments } from '../parsers/graphql/marketplace_parser';
import { buildMarketplaceSellerUrl } from '../routes/marketplace_routes';
import type { ExtractorResult, MarketplaceRouteLocationContext, MarketplaceSellerResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

function mergeLocationContext(
  primary: MarketplaceRouteLocationContext | null,
  fallback: MarketplaceRouteLocationContext | null
): MarketplaceRouteLocationContext | null {
  if (!primary && !fallback) {
    return null;
  }

  return {
    radius: primary?.radius ?? fallback?.radius ?? null,
    latitude: primary?.latitude ?? fallback?.latitude ?? null,
    longitude: primary?.longitude ?? fallback?.longitude ?? null,
    vanityPageId:
      (primary?.vanityPageId && /^\d+$/.test(primary.vanityPageId) ? primary.vanityPageId : null) ??
      (fallback?.vanityPageId && /^\d+$/.test(fallback.vanityPageId) ? fallback.vanityPageId : null) ??
      null
  };
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
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);

      await page.goto(url, { waitUntil: 'networkidle2' });
      for (let index = 0; index < Math.max(3, context.maxScrolls / 2); index += 1) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await sleep(context.scrollDelayMs);
      }

      const html = await page.content();
      const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
      await capture.detach(page);
      await routeCapture.detach(page);
      const graphqlFragments = capture.registry.all();
      const parserFragments = embeddedDocument ? [...graphqlFragments, embeddedDocument] : graphqlFragments;
      const graphqlSeller = parseMarketplaceSellerFragments(parserFragments, sellerId);
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
      const buyLocation = mergeLocationContext(
        queryContexts.find((query) => query.buyLocation && /Marketplace/i.test(query.queryName))?.buyLocation ?? null,
        browseRouteDefinition?.location ?? null
      );
      const seller = normalizeMarketplaceSeller({
        sellerId,
        seller: {
          id: graphqlSeller.seller.id ?? domSeller.seller.id,
          name: graphqlSeller.seller.name ?? domSeller.seller.name,
          about: graphqlSeller.seller.about ?? domSeller.seller.about,
          rating: graphqlSeller.seller.rating ?? domSeller.seller.rating,
          reviewCount: graphqlSeller.seller.reviewCount ?? domSeller.seller.reviewCount,
          location: graphqlSeller.seller.location ?? domSeller.seller.location,
          memberSince: graphqlSeller.seller.memberSince ?? domSeller.seller.memberSince
        },
        context: {
          routeName: routeDefinition?.canonicalRouteName ?? null,
          routeLocation: routeDefinition?.location ?? null,
          buyLocation,
          queryNames: [...new Set(sellerQueries.map((query) => query.queryName))],
          sellerId: sellerQueries.find((query) => query.sellerId)?.sellerId ?? sellerId
        },
        listings: graphqlSeller.listings.length > 0 ? graphqlSeller.listings : domSeller.listings,
        scrapedAt: new Date().toISOString()
      });

      return {
        data: seller,
        artifacts: {
          graphql_summary: summarizeMarketplaceGraphqlFragments(graphqlFragments),
          embedded_document_summary: embeddedDocument ? summarizeEmbeddedMarketplaceSeller([embeddedDocument]) : null,
          route_definitions_summary: summarizeRouteDefinitions(routeCapture.records),
          dom_seller: domSeller
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
