import type { PoolClient } from 'pg';

import type { ExtractorResult, PageInfoResult } from '../../types/contracts';
import type { ScrapeRunCompletion } from './persistence_contracts';
import { insertArtifacts, toJsonb } from './persistence_utils';

export async function upsertFacebookPage(client: PoolClient, page: PageInfoResult): Promise<string | null> {
  if (!page.pageId) {
    return null;
  }

  await client.query(
    `
      INSERT INTO scraper.facebook_pages (
        page_id,
        canonical_url,
        name,
        category,
        followers,
        creation_date_text,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
      ON CONFLICT (page_id)
      DO UPDATE SET
        canonical_url = COALESCE(EXCLUDED.canonical_url, scraper.facebook_pages.canonical_url),
        name = COALESCE(EXCLUDED.name, scraper.facebook_pages.name),
        category = COALESCE(EXCLUDED.category, scraper.facebook_pages.category),
        followers = COALESCE(EXCLUDED.followers, scraper.facebook_pages.followers),
        creation_date_text = COALESCE(EXCLUDED.creation_date_text, scraper.facebook_pages.creation_date_text),
        last_seen_at = now(),
        last_scraped_at = EXCLUDED.last_scraped_at,
        latest_payload = EXCLUDED.latest_payload
    `,
    [
      page.pageId,
      page.url,
      page.name,
      page.category,
      page.followers,
      page.transparency.creationDate,
      page.scrapedAt,
      toJsonb(page)
    ]
  );

  return page.pageId;
}

export async function upsertFacebookPageStub(client: PoolClient, pageId: string, pageUrl: string): Promise<void> {
  await client.query(
    `
      INSERT INTO scraper.facebook_pages (
        page_id,
        canonical_url,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, now(), now(), $3)
      ON CONFLICT (page_id)
      DO UPDATE SET
        canonical_url = COALESCE(EXCLUDED.canonical_url, scraper.facebook_pages.canonical_url),
        last_seen_at = now(),
        last_scraped_at = now()
    `,
    [pageId, pageUrl, toJsonb({ pageId, url: pageUrl })]
  );
}

export async function upsertFacebookPageContacts(
  client: PoolClient,
  pageId: string,
  page: PageInfoResult
): Promise<void> {
  await client.query('UPDATE scraper.facebook_page_contacts SET is_active = false WHERE page_id = $1', [pageId]);

  const contactGroups: Array<{ type: 'phone' | 'email' | 'website' | 'address'; values: string[] }> = [
    { type: 'phone', values: page.contact.phones },
    { type: 'email', values: page.contact.emails },
    { type: 'website', values: page.contact.websites },
    { type: 'address', values: page.contact.addresses }
  ];

  for (const group of contactGroups) {
    for (const value of group.values.filter(Boolean)) {
      await client.query(
        `
          INSERT INTO scraper.facebook_page_contacts (
            page_id,
            contact_type,
            contact_value,
            last_seen_at,
            is_active
          ) VALUES ($1, $2, $3, now(), true)
          ON CONFLICT (page_id, contact_type, contact_value)
          DO UPDATE SET last_seen_at = now(), is_active = true
        `,
        [pageId, group.type, value]
      );
    }
  }
}

export async function persistPageInfoSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<PageInfoResult>
): Promise<ScrapeRunCompletion> {
  const pageId = await upsertFacebookPage(client, result.data);
  if (pageId) {
    await upsertFacebookPageContacts(client, pageId, result.data);
  }

  await client.query(
    `
      INSERT INTO scraper.facebook_page_scrapes (
        scrape_run_id,
        page_id,
        page_url,
        page_name,
        category,
        followers,
        creation_date_text,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      scrapeRunId,
      pageId,
      result.data.url,
      result.data.name,
      result.data.category,
      result.data.followers,
      result.data.transparency.creationDate,
      toJsonb(result.data)
    ]
  );

  for (const [index, historyText] of result.data.transparency.history.entries()) {
    await client.query(
      `
        INSERT INTO scraper.facebook_page_transparency_history (
          scrape_run_id,
          position,
          history_text
        ) VALUES ($1, $2, $3)
      `,
      [scrapeRunId, index, historyText]
    );
  }

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: pageId,
    sourceUrl: result.data.url,
    outputSummary: {
      pageId,
      name: result.data.name,
      followers: result.data.followers,
      contactCount:
        result.data.contact.phones.length +
        result.data.contact.emails.length +
        result.data.contact.websites.length +
        result.data.contact.addresses.length
    }
  };
}
