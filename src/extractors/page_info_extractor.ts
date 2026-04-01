import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { enableRequestFiltering } from '../browser/request_filter';
import { RouteDefinitionCapture, type RouteDefinitionCaptureRecord } from '../capture/route_definition_capture';
import { normalizePageInfo } from '../normalizers/page_normalizer';
import {
  parseBio,
  parseCategory,
  parseContactInfoFromDom,
  parseCreationDate,
  parseFollowerCount,
  parseFollowingCount,
  parseLocation,
  parsePageName,
  snapshotPageDom,
  type PageDomSnapshot
} from '../parsers/dom/page_dom_parser';
import { captureProfileTileItems, extractLocationFromEmbeddedData } from '../parsers/dom/embedded_dom_parser';
import { extractFacebookPageRouteIdentity } from '../parsers/embedded/page_route_identity';
import { buildDirectoryBasicInfoUrl, buildDirectoryContactUrl } from '../routes/facebook_routes';
import type { ScraperContext } from '../core/scraper_context';
import type { ExtractorResult, PageContactInfo, PageInfoResult } from '../types/contracts';

const ROUTE_CAPTURE_WAIT_MS = 15_000;
const OPTIONAL_SIGNAL_WAIT_MS = 12_000;

function summarizePageDomEvidence(
  snapshot: PageDomSnapshot,
  extracted: Record<string, unknown>,
  labels: string[]
): Record<string, unknown> {
  return {
    url: snapshot.url,
    title: snapshot.title,
    headingCount: snapshot.headings.length,
    spanCount: snapshot.spans.length,
    linkCount: snapshot.links.length,
    sampleHeadings: snapshot.headings.slice(0, 5),
    matchedLabels: labels.filter(Boolean),
    extracted
  };
}

function summarizeRouteCapture(
  records: RouteDefinitionCaptureRecord[],
  identity: ReturnType<typeof extractFacebookPageRouteIdentity>
): Record<string, unknown> {
  const routes = records.flatMap((record) => record.routes);
  return {
    responseCount: records.length,
    routeCount: routes.length,
    matchedRouteName: identity?.matchedRouteName ?? null,
    matchedRouteUrl: identity?.matchedRouteUrl ?? null,
    pageId: identity?.pageId ?? null,
    vanity: identity?.vanity ?? null,
    sampleRouteNames: [...new Set(routes.map((route) => route.canonicalRouteName).filter(Boolean))].slice(0, 10)
  };
}

export function mergeContactInfo(parts: PageContactInfo[]): PageContactInfo {
  const socialByKey = new Map<string, PageContactInfo['socialMedia'][number]>();

  for (const part of parts) {
    for (const social of part.socialMedia) {
      const key = `${social.platform}:${social.url}`;
      if (!socialByKey.has(key)) {
        socialByKey.set(key, social);
      }
    }
  }

  return {
    phones: [...new Set(parts.flatMap((part) => part.phones).filter(Boolean))],
    emails: [...new Set(parts.flatMap((part) => part.emails).filter(Boolean))],
    websites: [...new Set(parts.flatMap((part) => part.websites).filter(Boolean))],
    addresses: [...new Set(parts.flatMap((part) => part.addresses).filter(Boolean))],
    socialMedia: [...socialByKey.values()]
  };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for route capture`);
}

async function waitForOptionalSignal(
  page: Page,
  predicate: () => boolean,
  timeoutMs = OPTIONAL_SIGNAL_WAIT_MS
): Promise<void> {
  try {
    await page.waitForFunction(predicate, { timeout: timeoutMs });
  } catch {
    // Sparse or slow pages are allowed to continue; snapshot parsing still has fallbacks.
  }
}

async function waitForMainPageSignals(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const hasHeading = Array.from(document.querySelectorAll('h1, h2')).some(
        (element) => (element.textContent ?? '').trim().length > 0
      );
      const hasStats = Array.from(document.querySelectorAll('span')).some((element) =>
        /followers?|following/i.test((element.textContent ?? '').trim())
      );
      return hasHeading || hasStats;
    },
    { timeout: timeoutMs }
  );
}

async function enablePageInfoRequestFiltering(page: Page): Promise<() => Promise<void>> {
  return enableRequestFiltering(page, ['image', 'media', 'font']);
}

export async function extractPageInfo(
  context: ScraperContext,
  pageUrl: string
): Promise<ExtractorResult<PageInfoResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const disableRequestFiltering = await enablePageInfoRequestFiltering(page);

      try {
        const routeCapture = new RouteDefinitionCapture();
        await routeCapture.attach(page);

        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await waitForMainPageSignals(page, context.timeoutMs);
        await waitForCondition(
          () => routeCapture.records.length > 0,
          Math.min(context.timeoutMs, ROUTE_CAPTURE_WAIT_MS)
        ).catch(() => undefined);

        const mainSnapshot = await snapshotPageDom(page);
        const profileTileItems = await captureProfileTileItems(page);
        const embeddedLocation = extractLocationFromEmbeddedData(profileTileItems);

        await routeCapture.detach(page);

        const routes = routeCapture.records.flatMap((record) => record.routes);
        const routeIdentity = extractFacebookPageRouteIdentity(routes);

        if (!routeIdentity?.pageId) {
          throw new Error(`Failed to extract page ID for ${pageUrl}. Skipping scrape.`);
        }

        const contactUrl = buildDirectoryContactUrl(pageUrl);
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded' });
        await waitForOptionalSignal(page, () => {
          const anchors = Array.from(document.querySelectorAll('a'));
          const spans = Array.from(document.querySelectorAll('span'));
          return (
            anchors.some((anchor) => /^(mailto:|tel:|https?:\/\/)/i.test(anchor.getAttribute('href') ?? '')) ||
            spans.some((span) => /^(phone|email|website|address|contact info)$/i.test((span.textContent ?? '').trim()))
          );
        });
        const contactSnapshot = await snapshotPageDom(page);

        const basicInfoUrl = buildDirectoryBasicInfoUrl(pageUrl);
        await page.goto(basicInfoUrl, { waitUntil: 'domcontentloaded' });
        await waitForOptionalSignal(page, () =>
          Array.from(document.querySelectorAll('span')).some((span) =>
            /^(page created|created|creation date|categories|location|basic info)$/i.test(
              (span.textContent ?? '').trim()
            )
          )
        );
        const basicInfoSnapshot = await snapshotPageDom(page);

        const mainContact = parseContactInfoFromDom(mainSnapshot);
        const contactPageContact = parseContactInfoFromDom(contactSnapshot);
        const basicInfoContact = parseContactInfoFromDom(basicInfoSnapshot);
        const mergedContact = mergeContactInfo([mainContact, contactPageContact, basicInfoContact]);
        const pageName = parsePageName(mainSnapshot) ?? routeIdentity.vanity;
        const category = parseCategory(mainSnapshot);
        const followers = parseFollowerCount(mainSnapshot);
        const following = parseFollowingCount(mainSnapshot);
        const bio = parseBio(mainSnapshot);
        const mainLocation = parseLocation(mainSnapshot);
        const basicInfoLocation = parseLocation(basicInfoSnapshot);
        const location = embeddedLocation ?? basicInfoLocation ?? mainLocation;

        const transparency = {
          creationDate: null,
          history: [] as string[]
        };
        const creationDate = parseCreationDate(basicInfoSnapshot) ?? transparency.creationDate;

        return {
          data: normalizePageInfo({
            pageId: routeIdentity.pageId,
            url: mainSnapshot.url,
            name: pageName,
            category,
            followers,
            following,
            bio,
            location,
            contact: mergedContact,
            creationDate,
            history: transparency.history
          }),
          artifacts: {
            route_capture_summary: summarizeRouteCapture(routeCapture.records, routeIdentity),
            dom_evidence: {
              main: summarizePageDomEvidence(
                mainSnapshot,
                {
                  pageName,
                  category,
                  followers,
                  following,
                  bio,
                  location: mainLocation,
                  embeddedLocation
                },
                mainSnapshot.headings.slice(0, 5)
              ),
              contact: summarizePageDomEvidence(
                contactSnapshot,
                {
                  phones: contactPageContact.phones,
                  emails: contactPageContact.emails,
                  websites: contactPageContact.websites,
                  socialMedia: contactPageContact.socialMedia
                },
                ['phone', 'email', 'website', 'address']
              ),
              basic_info: summarizePageDomEvidence(
                basicInfoSnapshot,
                {
                  location: basicInfoLocation,
                  creationDate,
                  addresses: basicInfoContact.addresses
                },
                ['location', 'page created', 'categories']
              )
            },
            collection_stats: {
              navigationCount: 3,
              visitedUrls: [pageUrl, contactUrl, basicInfoUrl],
              blockedResourceTypes: ['image', 'media', 'font'],
              profileTileItemCount: profileTileItems.length
            }
          }
        };
      } finally {
        await disableRequestFiltering();
      }
    });
  } finally {
    await chrome.disconnect();
  }
}
