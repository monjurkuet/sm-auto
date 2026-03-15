import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
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
import { parseTimelineIdentity } from '../parsers/graphql/timeline_parser';
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
      await capture.attach(page);

      await page.goto(pageUrl, { waitUntil: 'networkidle2' });
      await sleep(2_000);

      const mainSnapshot = await snapshotPageDom(page);
      await page.goto(buildAboutContactUrl(pageUrl), { waitUntil: 'networkidle2' });
      await sleep(2_000);
      const aboutSnapshot = await snapshotPageDom(page);
      const transparency = await extractPageTransparency(page, pageUrl);

      await capture.detach(page);
      const identity = parseTimelineIdentity(capture.registry.byFriendlyName('ProfileCometTimelineFeedRefetchQuery'));
      const mainContact = parseContactInfoFromDom(mainSnapshot);
      const aboutContact = parseContactInfoFromDom(aboutSnapshot);
      const transparencySnapshot = {
        ...mainSnapshot,
        spans: transparency.history
      };

      return {
        data: normalizePageInfo({
          pageId: identity.pageId ?? parseLabeledValue(transparencySnapshot, /^page id$/i),
          url: mainSnapshot.url,
          name: identity.pageName ?? parsePageName(mainSnapshot),
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
