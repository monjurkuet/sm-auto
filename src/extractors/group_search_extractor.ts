import type { Page } from 'puppeteer-core';

import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { enableRequestFiltering } from '../browser/request_filter';
import { GraphQLCapture } from '../capture/graphql_capture';
import { summarizeGraphqlFragments } from '../capture/graphql_artifact_summary';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { sleep } from '../core/sleep';
import { createEmbeddedDocumentFragment } from '../parsers/embedded/marketplace_embedded_parser';

import type { ExtractorResult, GroupSearchResult, GroupSearchResults } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';

const INITIAL_SEARCH_SIGNAL_WAIT_MS = 15_000;
const SCROLL_PROGRESS_WAIT_MS = 1_500;
const MAX_STALLED_SCROLLS = 10;
const MAX_STALLED_SCROLLS_CAP = 25;
const SNAPSHOT_INTERVAL = 5;

// ── URL construction ──

export function buildGroupSearchUrl(query: string): string {
  return `https://www.facebook.com/search/groups/?q=${encodeURIComponent(query)}`;
}

// ── Progress tracking ──

interface GroupSearchProgressSnapshot {
  groupLinkCount: number;
  scrollHeight: number;
}

async function countGroupLinks(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pattern = /\/groups\/\d+/;
    const seen = new Set<string>();
    Array.from(document.querySelectorAll('a')).forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (href && pattern.test(href)) {
        seen.add(href);
      }
    });
    return seen.size;
  });
}

async function getGroupSearchProgressSnapshot(
  page: Page
): Promise<GroupSearchProgressSnapshot> {
  const [groupLinkCount, scrollHeight] = await Promise.all([
    countGroupLinks(page).catch(() => 0),
    page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  ]);

  return { groupLinkCount, scrollHeight };
}

// ── Wait for initial search results ──

async function waitForGroupSearchSignals(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, INITIAL_SEARCH_SIGNAL_WAIT_MS);

  while (Date.now() < deadline) {
    const groupLinkCount = await countGroupLinks(page).catch(() => 0);
    if (groupLinkCount > 0) {
      return;
    }

    // Also check for group result cards in embedded data
    try {
      const hasGroupResults = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/json"][data-sjs]'));
        for (const script of scripts) {
          const text = script.textContent ?? '';
          if (text.includes('Group') && text.includes('members')) {
            return true;
          }
        }
        return false;
      });
      if (hasGroupResults) {
        return;
      }
    } catch {
      // DOM check failure shouldn't block
    }

    await sleep(250);
  }

  throw new Error('Timed out waiting for group search results');
}

// ── Wait for scroll progress ──

async function waitForGroupSearchProgress(
  page: Page,
  previous: GroupSearchProgressSnapshot,
  timeoutMs: number
): Promise<void> {
  try {
    await page.waitForFunction(
      (previousHeight: number, previousGroupLinkCount: number) => {
        const pattern = /\/groups\/\d+/;
        const seen = new Set<string>();
        Array.from(document.querySelectorAll('a')).forEach((anchor) => {
          const href = anchor.getAttribute('href');
          if (href && pattern.test(href)) {
            seen.add(href);
          }
        });
        const currentGroupLinkCount = seen.size;
        return document.body.scrollHeight > previousHeight || currentGroupLinkCount > previousGroupLinkCount;
      },
      { timeout: timeoutMs },
      previous.scrollHeight,
      previous.groupLinkCount
    );
  } catch {
    // Pagination stalls are expected once the search results are exhausted.
  }
}

// ── Stall detection ──

export function computeMaxStalledScrolls(maxScrolls: number): number {
  if (maxScrolls >= 100) {
    return Math.min(MAX_STALLED_SCROLLS_CAP, Math.max(MAX_STALLED_SCROLLS, Math.floor(maxScrolls / 10)));
  }

  return MAX_STALLED_SCROLLS;
}

// ── Scrolling ──

async function scrollGroupSearchResults(
  page: Page,
  capture: GraphQLCapture,
  context: ScraperContext
): Promise<void> {
  let stalledScrolls = 0;
  let previous = await getGroupSearchProgressSnapshot(page);
  const maxStalledScrolls = computeMaxStalledScrolls(context.maxScrolls);

  context.logger.info('Group search scroll configuration', {
    maxScrolls: context.maxScrolls,
    maxStalledScrolls,
    scrollDelayMs: context.scrollDelayMs
  });

  for (let index = 0; index < context.maxScrolls; index += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 1200)));
    await waitForGroupSearchProgress(page, previous, Math.max(context.scrollDelayMs, SCROLL_PROGRESS_WAIT_MS));

    // Periodically capture embedded document fragments so groups that leave the DOM aren't lost
    if ((index + 1) % SNAPSHOT_INTERVAL === 0) {
      try {
        const html = await page.content();
        const fragment = createEmbeddedDocumentFragment(page.url(), html);
        if (fragment) {
          capture.registry.add(fragment);
        }
      } catch {
        // DOM snapshot failure shouldn't break scrolling
      }
    }

    const current = await getGroupSearchProgressSnapshot(page);
    const hasProgress =
      current.groupLinkCount > previous.groupLinkCount ||
      current.scrollHeight > previous.scrollHeight;

    if (!hasProgress) {
      stalledScrolls += 1;
      if (stalledScrolls >= maxStalledScrolls) {
        context.logger.info('Group search scrolling stopped after stall threshold', {
          attemptedScrolls: index + 1,
          maxScrolls: context.maxScrolls,
          stalledScrolls,
          maxStalledScrolls
        });
        break;
      }
    } else {
      stalledScrolls = 0;
    }

    previous = current;
  }
}

// ── DOM parsing ──

function extractGroupIdFromUrl(url: string): string | null {
  const match = url.match(/\/groups\/(\d+)/);
  return match ? match[1] : null;
}

async function parseGroupCardsFromDOM(page: Page): Promise<GroupSearchResult[]> {
  return page.evaluate(() => {
    const results: Array<{
      name: string;
      url: string;
      groupId: string | null;
      memberCount: number | null;
      privacyType: string | null;
      description: string | null;
    }> = [];

    const groupLinkPattern = /\/groups\/(\d+)/;
    const anchors = Array.from(document.querySelectorAll('a'));

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href');
      if (!href) continue;

      const match = href.match(groupLinkPattern);
      if (!match) continue;

      const groupId = match[1];
      const url = new URL(href, 'https://www.facebook.com').pathname;

      // Deduplicate by group URL
      if (results.some((r) => r.url === url)) continue;

      // Name is the link text
      const name = (anchor.textContent ?? '').trim();
      if (!name) continue;

      // Walk up to find the closest group card container
      const card = anchor.closest('[data-virt]') ?? anchor.closest('[role="article"]') ?? anchor.parentElement?.parentElement?.parentElement;
      if (!card) continue;

      const cardText = card.textContent ?? '';

      // Extract member count from text like "1.2K members" or "12,345 members"
      let memberCount: number | null = null;
      const memberMatch = cardText.match(/([\d,.]+[KkMm]?)\s+members?/i);
      if (memberMatch) {
        const raw = memberMatch[1].replace(/,/g, '');
        if (/^[0-9]+$/.test(raw)) {
          memberCount = parseInt(raw, 10);
        } else if (/^\d+(\.\d+)?[Kk]$/.test(raw)) {
          memberCount = Math.round(parseFloat(raw) * 1_000);
        } else if (/^\d+(\.\d+)?[Mm]$/.test(raw)) {
          memberCount = Math.round(parseFloat(raw) * 1_000_000);
        }
      }

      // Extract privacy type
      let privacyType: string | null = null;
      if (/\bPublic\b/.test(cardText)) {
        privacyType = 'Public';
      } else if (/\bPrivate\b/.test(cardText)) {
        privacyType = 'Private';
      }

      // Description: look for longer text spans within the card, excluding the name
      let description: string | null = null;
      const spans = Array.from(card.querySelectorAll('span'));
      for (const span of spans) {
        const text = (span.textContent ?? '').trim();
        if (text.length > name.length + 10 && !text.includes('members')) {
          description = text;
          break;
        }
      }

      results.push({
        name,
        url,
        groupId,
        memberCount,
        privacyType,
        description
      });
    }

    return results;
  });
}

// ── Main extractor ──

export async function extractGroupSearch(
  context: ScraperContext,
  query: string
): Promise<ExtractorResult<GroupSearchResults>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);
  const searchUrl = buildGroupSearchUrl(query);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);
      const disableRequestFiltering = await enableRequestFiltering(page, ['image', 'media', 'font']);

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await waitForGroupSearchSignals(page, context.timeoutMs);
        await scrollGroupSearchResults(page, capture, context);

        // Parse group cards from DOM
        const domResults = await parseGroupCardsFromDOM(page);

        // Also parse from embedded document fragments captured during scrolling
        const capturedFragments = capture.registry.all();
        let embeddedResults: GroupSearchResult[] = [];
        if (capturedFragments.length > 0) {
          try {
            const html = await page.content();
            const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);
            if (embeddedDocument) {
              const embeddedHtml = String(embeddedDocument.fragments[0] ?? '');
              // Parse group links from the raw embedded HTML
              const groupLinkPattern = /\/groups\/(\d+)/g;
              const seenUrls = new Set<string>();
              let linkMatch: RegExpExecArray | null;
              while ((linkMatch = groupLinkPattern.exec(embeddedHtml)) !== null) {
                const groupPath = `/groups/${linkMatch[1]}`;
                if (!seenUrls.has(groupPath)) {
                  seenUrls.add(groupPath);
                  embeddedResults.push({
                    name: '',  // Name not easily extractable from raw HTML fragments
                    url: groupPath,
                    groupId: linkMatch[1],
                    memberCount: null,
                    privacyType: null,
                    description: null
                  });
                }
              }
            }
          } catch {
            // Embedded document parsing failure shouldn't break extraction
          }
        }

        // Merge: DOM results take priority, then fill in from embedded results
        const seenGroupUrls = new Set(domResults.map((r) => r.url));
        for (const er of embeddedResults) {
          if (!seenGroupUrls.has(er.url)) {
            seenGroupUrls.add(er.url);
            domResults.push(er);
          }
        }

        const routes = routeCapture.records.flatMap((record) => record.routes);
        const relevantFragments = capturedFragments;

        return {
          data: {
            query,
            results: domResults,
            scrapedAt: new Date().toISOString()
          },
          artifacts: {
            graphql_summary: summarizeGraphqlFragments(relevantFragments),
            route_capture_summary: {
              responseCount: routeCapture.records.length,
              routeCount: routes.length
            },
            collection_stats: {
              resultCount: domResults.length,
              blockedResourceTypes: ['image', 'media', 'font'],
              capturedFragmentCount: relevantFragments.length,
              capturedRouteCount: routeCapture.records.length
            }
          }
        };
      } finally {
        await capture.detach(page).catch(() => undefined);
        await routeCapture.detach(page).catch(() => undefined);
        await disableRequestFiltering().catch(() => undefined);
      }
    });
  } finally {
    await chrome.disconnect();
  }
}
