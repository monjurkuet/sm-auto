import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { normalizePosts } from '../normalizers/post_normalizer';
import { mergePostMetricSnapshots, snapshotPostMetrics } from '../parsers/dom/post_dom_parser';
import { parseTimelineFragments } from '../parsers/graphql/timeline_parser';
import type { ExtractorResult, PagePostsResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';
import { getString } from '../parsers/graphql/shared_graphql_utils';

export async function extractPagePosts(context: ScraperContext, pageUrl: string): Promise<ExtractorResult<PagePostsResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);

      await page.goto(pageUrl, { waitUntil: 'networkidle2' });
      const metricSnapshots = await snapshotPostMetrics(page);
      for (let index = 0; index < context.maxScrolls; index += 1) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await sleep(context.scrollDelayMs);
        metricSnapshots.push(...(await snapshotPostMetrics(page)));
      }

      await routeCapture.detach(page);
      const domMetrics = mergePostMetricSnapshots(metricSnapshots);
      await capture.detach(page);

      // Extract page ID from route definitions (authoritative source)
      const routes = routeCapture.records.flatMap(record => record.routes);
      let pageId: string | null = null;
      let pageName: string | null = null;

      // Get page ID from route definitions - look for profile timeline route
      for (const route of routes) {
        if (!route.canonicalRouteName?.includes('ProfileTimeline')) {
          continue;
        }
        const raw = route.raw as Record<string, unknown>;
        const result = raw?.result as Record<string, unknown> | undefined;
        const exports = (result?.exports ?? result) as Record<string, unknown>;
        const rootView = (exports?.rootView ?? exports?.hostableView) as Record<string, unknown> | undefined;
        const props = (rootView?.props ?? rootView) as Record<string, unknown> | undefined;
        if (props?.userID) {
          pageId = getString(props.userID);
          pageName = getString(props.userVanity) ?? null;
          break;
        }
      }

      if (!pageId) {
        throw new Error(`Failed to extract page ID from route definitions for ${pageUrl}. Skipping scrape.`);
      }

      const graphqlPosts = parseTimelineFragments(capture.registry.all());
      const posts = normalizePosts(graphqlPosts, domMetrics);

      return {
        data: {
          pageId,
          url: pageUrl,
          posts,
          scrapedAt: new Date().toISOString()
        },
        artifacts: {
          graphql: capture.registry.all(),
          dom_metrics: domMetrics
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
