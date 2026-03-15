import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { normalizePageInfo } from '../normalizers/page_normalizer';
import {
  snapshotPageDom,
  parseCategory,
  parseContactInfoFromDom,
  parseFollowerCount,
  parseLabeledValue,
  parsePageName
} from '../parsers/dom/page_dom_parser';
import { getString } from '../parsers/graphql/shared_graphql_utils';
import { buildAboutContactUrl } from '../routes/facebook_routes';
import type { ExtractorResult, PageInfoResult } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';
import { extractPageTransparency } from './page_transparency_extractor';

export async function extractPageInfo(context: ScraperContext, pageUrl: string): Promise<ExtractorResult<PageInfoResult>> {
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
      await sleep(2_000);

      const mainSnapshot = await snapshotPageDom(page);
      await page.goto(buildAboutContactUrl(pageUrl), { waitUntil: 'networkidle2' });
      await sleep(2_000);
      const aboutSnapshot = await snapshotPageDom(page);
      const transparency = await extractPageTransparency(page, pageUrl);

      await capture.detach(page);
      await routeCapture.detach(page);

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
      const mainContact = parseContactInfoFromDom(mainSnapshot);
      const aboutContact = parseContactInfoFromDom(aboutSnapshot);
      const transparencySnapshot = {
        ...mainSnapshot,
        spans: transparency.history
      };

      if (!pageId) {
        throw new Error(`Failed to extract page ID for ${pageUrl}. Skipping scrape.`);
      }

      return {
        data: normalizePageInfo({
          pageId: pageId,
          url: mainSnapshot.url,
          name: pageName ?? parsePageName(mainSnapshot),
          category: parseCategory(aboutSnapshot),
          followers: parseFollowerCount(mainSnapshot),
          contact: {
            phones: [...new Set([...mainContact.phones, ...aboutContact.phones])],
            emails: [...new Set([...mainContact.emails, ...aboutContact.emails])],
            websites: [...new Set([...mainContact.websites, ...aboutContact.websites])],
            addresses: [...new Set([...mainContact.addresses, ...aboutContact.addresses])]
          },
          creationDate: parseLabeledValue(transparencySnapshot, /^creation date$/i) ?? transparency.creationDate,
          history: transparency.history
        }),
        artifacts: {
          graphql: capture.registry.all(),
          route_definitions: routes,
          main_snapshot: mainSnapshot,
          about_snapshot: aboutSnapshot,
          transparency
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
