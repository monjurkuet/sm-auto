import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { normalizeMarketplaceListing } from '../normalizers/marketplace_listing_normalizer';
import { parseMarketplaceListingFromDom } from '../parsers/dom/marketplace_dom_parser';
import {
  summarizeEmbeddedMarketplaceListing,
  summarizeMarketplaceGraphqlFragments,
  summarizeRouteDefinitions
} from '../parsers/embedded/marketplace_artifact_summary';
import {
  createEmbeddedDocumentFragment,
  extractMarketplaceQueryContextsFromHtml,
  selectRouteDefinition
} from '../parsers/embedded/marketplace_embedded_parser';
import { parseMarketplaceListingFragments } from '../parsers/graphql/marketplace_parser';
import { buildMarketplaceListingUrl } from '../routes/marketplace_routes';
import type { ExtractorResult, MarketplaceListingResult, MarketplaceRouteLocationContext } from '../types/contracts';
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
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);

      await page.goto(url, { waitUntil: 'networkidle2' });
      await sleep(2_000);
      const html = await page.content();
      const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
      await capture.detach(page);
      await routeCapture.detach(page);

      const graphqlFragments = capture.registry.all();
      const parserFragments = embeddedDocument ? [...graphqlFragments, embeddedDocument] : graphqlFragments;
      const fromGraphql = parseMarketplaceListingFragments(parserFragments, listingId);
      const fromDom = await parseMarketplaceListingFromDom(page, listingId);
      const listing = fromGraphql
        ? {
            ...fromDom,
            ...fromGraphql,
            price: {
              amount: fromGraphql.price.amount ?? fromDom.price.amount,
              currency: fromGraphql.price.currency ?? fromDom.price.currency,
              formatted: fromGraphql.price.formatted ?? fromDom.price.formatted
            },
            images: fromGraphql.images.length > 0 ? fromGraphql.images : fromDom.images,
            seller: {
              id: fromGraphql.seller.id ?? fromDom.seller.id,
              name: fromGraphql.seller.name ?? fromDom.seller.name
            },
            location: {
              city: fromGraphql.location.city ?? fromDom.location.city,
              fullLocation: fromGraphql.location.fullLocation ?? fromDom.location.fullLocation,
              coordinates: fromGraphql.location.coordinates ?? fromDom.location.coordinates
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
      const listingQueries = queryContexts.filter((query) => query.targetId === listingId && /MarketplacePDP|MarketplacePermalink/i.test(query.queryName));
      const buyLocation = mergeLocationContext(
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
            targetId: listingQueries.find((query) => query.targetId)?.targetId ?? listingId
          }
        },
        artifacts: {
          graphql_summary: summarizeMarketplaceGraphqlFragments(graphqlFragments),
          embedded_document_summary: embeddedDocument ? summarizeEmbeddedMarketplaceListing([embeddedDocument], listingId) : null,
          route_definitions_summary: summarizeRouteDefinitions(routeCapture.records),
          used_dom_fallback: !fromGraphql,
          dom_listing: fromDom
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
