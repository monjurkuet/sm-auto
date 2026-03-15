import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { sleep } from '../core/sleep';
import { normalizePosts } from '../normalizers/post_normalizer';
import { mergePostMetricSnapshots, snapshotPostMetrics } from '../parsers/dom/post_dom_parser';
import { parseTimelineFragments } from '../parsers/graphql/timeline_parser';
import type { ExtractorResult, PagePostsResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

export async function extractPagePosts(context: ScraperContext, pageUrl: string): Promise<ExtractorResult<PagePostsResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      await capture.attach(page);

      await page.goto(pageUrl, { waitUntil: 'networkidle2' });
      const metricSnapshots = await snapshotPostMetrics(page);
      for (let index = 0; index < context.maxScrolls; index += 1) {
        await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
        await sleep(context.scrollDelayMs);
        metricSnapshots.push(...(await snapshotPostMetrics(page)));
      }

      const domMetrics = mergePostMetricSnapshots(metricSnapshots);
      await capture.detach(page);

      const timelineFragments = capture.registry.byFriendlyName('ProfileCometTimelineFeedRefetchQuery');
      const graphqlPosts = parseTimelineFragments(timelineFragments.length > 0 ? timelineFragments : capture.registry.all());
      const posts = normalizePosts(graphqlPosts, domMetrics);

      return {
        data: {
          pageId: posts[0]?.author.id ?? null,
          url: pageUrl,
          posts,
          scrapedAt: new Date().toISOString()
        },
        artifacts: {
          graphql: timelineFragments,
          dom_metrics: domMetrics
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
