import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
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

      await page.goto(searchUrl, { waitUntil: 'networkidle2' });
      for (let index = 0; index < context.maxScrolls; index += 1) {
        await page.evaluate(() => window.scrollBy(0, 1000));
        await sleep(context.scrollDelayMs);
      }

      const html = await page.content();
      const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
      await capture.detach(page);
      await routeCapture.detach(page);
      const relevantFragments = capture.registry.byFriendlyName('CometMarketplaceSearchContentPaginationQuery');
      const parserFragments = embeddedDocument ? [...relevantFragments, embeddedDocument] : relevantFragments;
      const listings = parseMarketplaceSearchFragments(parserFragments);
      const routeLocation = selectRouteLocation(
        routeCapture.records.flatMap((record) => record.routes),
        /CometMarketplaceSearchRoute/
      );
      const embeddedSearchContext = extractMarketplaceSearchContextFromHtml(html);

      return {
        data: {
          query,
          location,
          searchUrl,
          searchContext: {
            buyLocation: {
              radius: routeLocation?.radius ?? embeddedSearchContext?.radius ?? null,
              latitude: embeddedSearchContext?.latitude ?? routeLocation?.latitude ?? null,
              longitude: embeddedSearchContext?.longitude ?? routeLocation?.longitude ?? null,
              vanityPageId:
                (routeLocation?.vanityPageId && /^\d+$/.test(routeLocation.vanityPageId)
                  ? routeLocation.vanityPageId
                  : null) ??
                embeddedSearchContext?.vanityPageId ??
                null
            }
          },
          listings,
          scrapedAt: new Date().toISOString()
        },
        artifacts: {
          graphql_summary: summarizeMarketplaceGraphqlFragments(relevantFragments),
          embedded_document_summary: embeddedDocument ? summarizeEmbeddedMarketplaceSearch([embeddedDocument]) : null,
          route_definitions_summary: summarizeRouteDefinitions(routeCapture.records)
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
