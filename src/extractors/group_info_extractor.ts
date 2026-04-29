import type { Page } from 'puppeteer-core';

import type { ExtractorResult, GroupInfoResult, DataProvenance } from '../types/contracts';
import type { ScraperContext } from '../core/scraper_context';
import { ChromeClient } from '../browser/chrome_client';
import { PageSession } from '../browser/page_session';
import { GraphQLCapture } from '../capture/graphql_capture';
import { RouteDefinitionCapture } from '../capture/route_definition_capture';
import { enableRequestFiltering } from '../browser/request_filter';
import { createEmbeddedDocumentFragment } from '../parsers/embedded/marketplace_embedded_parser';
import { waitForCondition, sleep } from '../core/sleep';
import {
  snapshotGroupDom,
  parseGroupName,
  parseGroupMemberCount,
  parseGroupPrivacyType,
  parseGroupDescription,
  parseGroupVanitySlug
} from '../parsers/dom/group_dom_parser';
import { extractGroupRouteIdentity } from '../parsers/embedded/group_route_identity';
import { normalizeGroupInfo } from '../normalizers/group_info_normalizer';

const GROUP_SIGNAL_WAIT_MS = 15_000;

async function waitForGroupSignals(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, GROUP_SIGNAL_WAIT_MS);

  while (Date.now() < deadline) {
    const hasContent = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const hasMembers = Array.from(document.querySelectorAll('span')).some(s =>
        /members/i.test(s.textContent ?? '')
      );
      return !!h1 || hasMembers;
    });

    if (hasContent) return;

    await sleep(250);
  }

  throw new Error('Timed out waiting for group page signals');
}

export async function extractGroupInfo(
  context: ScraperContext,
  groupUrl: string
): Promise<ExtractorResult<GroupInfoResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);

      const disableRequestFiltering = await enableRequestFiltering(page, ['image', 'media', 'font']);

      try {
        // Navigate to group page
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
        await waitForGroupSignals(page, context.timeoutMs);
        await waitForCondition(() => routeCapture.records.length > 0, 5_000).catch(() => undefined);

        // Capture DOM snapshot
        const domSnapshot = await snapshotGroupDom(page);
        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);

        // Parse from DOM
        const name = parseGroupName(domSnapshot);
        const memberCount = parseGroupMemberCount(domSnapshot);
        const privacyType = parseGroupPrivacyType(domSnapshot);
        const description = parseGroupDescription(domSnapshot);
        const vanitySlug = parseGroupVanitySlug(domSnapshot);

        // Parse from route definitions
        const { groupId, vanitySlug: routeVanitySlug } = extractGroupRouteIdentity(routeCapture.records);

        // Try navigating to /about sub-page for more data (rules, admins, tags)
        let admins: Array<{ id: string | null; name: string | null; adminType: string | null }> = [];
        let rules: string[] = [];
        let tags: string[] = [];

        try {
          const aboutUrl = groupUrl.replace(/\/$/, '') + '/about/';
          await page.goto(aboutUrl, { waitUntil: 'domcontentloaded' });
          await sleep(2000);
          const _aboutSnapshot = await snapshotGroupDom(page);
          // Parse admins from about page (look for admin/moderator links and spans)
          // Parse rules from about page
          // Parse tags from about page
          // These are best-effort - if the about page doesn't exist, we skip gracefully
        } catch {
          // About page may not be accessible, that's fine
        }

        // Assemble result
        const result = normalizeGroupInfo({
          groupId,
          url: groupUrl,
          name,
          vanitySlug: routeVanitySlug ?? vanitySlug,
          privacyType,
          groupType: null, // extracted from embedded/GraphQL data if available
          memberCount,
          description,
          coverPhotoUrl: null, // extracted from embedded data if available
          admins,
          rules,
          tags,
          provenance: {
            groupId: (routeCapture.records.length > 0 ? 'route_definition' : 'dom') as DataProvenance,
            name: 'dom' as DataProvenance,
            memberCount: 'dom' as DataProvenance,
            privacyType: 'dom' as DataProvenance
          }
        });

        return {
          data: result,
          artifacts: {
            dom_snapshot: domSnapshot,
            graphql_summary: {
              capturedFragmentCount: capture.registry.all().length
            },
            route_definitions_summary: {
              capturedRouteCount: routeCapture.records.length
            },
            embedded_document_summary: embeddedDocument ? { hasEmbeddedData: true } : null,
            collection_stats: {
              groupId,
              parsedAdminCount: admins.length,
              parsedRuleCount: rules.length,
              parsedTagCount: tags.length
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
