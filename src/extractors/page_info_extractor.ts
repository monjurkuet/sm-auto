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
  parseFollowingCount,
  parseBio,
  parseLocation,
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

      // Navigate to directory_contact_info for additional contact info (phone, email, social)
      const contactUrl = `${pageUrl.replace(/\/$/, '')}/directory_contact_info`;
      await page.goto(contactUrl, { waitUntil: 'networkidle2' });
      await sleep(2_000);
      const contactSnapshot = await snapshotPageDom(page);

      // Navigate to directory_basic_info for page details (including creation date)
      const basicInfoUrl = `${pageUrl.replace(/\/$/, '')}/directory_basic_info`;
      await page.goto(basicInfoUrl, { waitUntil: 'networkidle2' });
      await sleep(2_000);
      
      // Try to click on "Privacy and legal info" to expand it
      try {
        const privacyLink = await page.$('a[href*="privacy"]');
        if (privacyLink) {
          await privacyLink.click();
          await sleep(1_000);
        }
      } catch {
        // Ignore click errors
      }
      
      const basicInfoSnapshot = await snapshotPageDom(page);

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
      const contactPageContact = parseContactInfoFromDom(contactSnapshot);
      const basicInfoContact = parseContactInfoFromDom(basicInfoSnapshot);

      // Merge contact info from all pages
      const mergedContact = {
        phones: [...new Set([...mainContact.phones, ...aboutContact.phones, ...contactPageContact.phones, ...basicInfoContact.phones])],
        emails: [...new Set([...mainContact.emails, ...aboutContact.emails, ...contactPageContact.emails, ...basicInfoContact.emails])],
        websites: [...new Set([...mainContact.websites, ...aboutContact.websites, ...contactPageContact.websites, ...basicInfoContact.websites])],
        addresses: [...new Set([...mainContact.addresses, ...aboutContact.addresses, ...contactPageContact.addresses, ...basicInfoContact.addresses])],
        socialMedia: [...contactPageContact.socialMedia] // Contact page has the most social media info
      };

      // Try to get creation date from basic info page
      let creationDate = parseLabeledValue(basicInfoSnapshot, /^page created$/i) 
        ?? parseLabeledValue(basicInfoSnapshot, /^created$/i)
        ?? parseLabeledValue(basicInfoSnapshot, /^creation date$/i)
        ?? transparency.creationDate;

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
          following: parseFollowingCount(mainSnapshot),
          bio: parseBio(aboutSnapshot),
          location: parseLocation(aboutSnapshot),
          contact: mergedContact,
          creationDate: creationDate,
          history: transparency.history
        }),
        artifacts: {
          graphql: capture.registry.all(),
          route_definitions: routes,
          main_snapshot: mainSnapshot,
          about_snapshot: aboutSnapshot,
          contact_snapshot: contactSnapshot,
          basic_info_snapshot: basicInfoSnapshot,
          transparency
        }
      };
    });
  } finally {
    await chrome.disconnect();
  }
}
