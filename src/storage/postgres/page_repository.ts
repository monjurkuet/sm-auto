import type { PoolClient } from 'pg';

import type { ExtractorResult, PageInfoResult, SocialMediaLink } from '../../types/contracts';
import type { ScrapeRunCompletion } from './persistence_contracts';
import { insertArtifacts, toJsonb } from './persistence_utils';

type ContactType = 'phone' | 'email' | 'website' | 'address';

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildContactRows(page: PageInfoResult): Array<{ type: ContactType; value: string }> {
  return [
    ...uniqueNonEmpty(page.contact.phones).map((value) => ({ type: 'phone' as const, value })),
    ...uniqueNonEmpty(page.contact.emails).map((value) => ({ type: 'email' as const, value })),
    ...uniqueNonEmpty(page.contact.websites).map((value) => ({ type: 'website' as const, value })),
    ...uniqueNonEmpty(page.contact.addresses).map((value) => ({ type: 'address' as const, value }))
  ];
}

function buildSocialRows(page: PageInfoResult): SocialMediaLink[] {
  const seen = new Set<string>();
  const rows: SocialMediaLink[] = [];

  for (const social of page.contact.socialMedia) {
    const key = `${social.platform}:${social.url}`;
    if (!social.url || seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(social);
  }

  return rows;
}

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
        following,
        bio,
        location_text,
        creation_date_text,
        last_seen_at,
        last_scraped_at,
        latest_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10, $11)
      ON CONFLICT (page_id)
      DO UPDATE SET
        canonical_url = COALESCE(EXCLUDED.canonical_url, scraper.facebook_pages.canonical_url),
        name = COALESCE(EXCLUDED.name, scraper.facebook_pages.name),
        category = COALESCE(EXCLUDED.category, scraper.facebook_pages.category),
        followers = COALESCE(EXCLUDED.followers, scraper.facebook_pages.followers),
        following = COALESCE(EXCLUDED.following, scraper.facebook_pages.following),
        bio = COALESCE(EXCLUDED.bio, scraper.facebook_pages.bio),
        location_text = COALESCE(EXCLUDED.location_text, scraper.facebook_pages.location_text),
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
      page.following,
      page.bio,
      page.location,
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
  const rows = buildContactRows(page);
  if (rows.length === 0) {
    await client.query('UPDATE scraper.facebook_page_contacts SET is_active = false WHERE page_id = $1 AND is_active = true', [
      pageId
    ]);
    return;
  }

  const contactTypes = rows.map((row) => row.type);
  const contactValues = rows.map((row) => row.value);

  await client.query(
    `
      UPDATE scraper.facebook_page_contacts existing
      SET is_active = false
      WHERE existing.page_id = $1
        AND existing.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM unnest($2::text[], $3::text[]) AS incoming(contact_type, contact_value)
          WHERE incoming.contact_type = existing.contact_type
            AND incoming.contact_value = existing.contact_value
        )
    `,
    [pageId, contactTypes, contactValues]
  );

  await client.query(
    `
      INSERT INTO scraper.facebook_page_contacts (
        page_id,
        contact_type,
        contact_value,
        last_seen_at,
        is_active
      )
      SELECT $1, incoming.contact_type, incoming.contact_value, now(), true
      FROM unnest($2::text[], $3::text[]) AS incoming(contact_type, contact_value)
      ON CONFLICT (page_id, contact_type, contact_value)
      DO UPDATE SET last_seen_at = now(), is_active = true
    `,
    [pageId, contactTypes, contactValues]
  );
}

export async function upsertFacebookPageSocialLinks(
  client: PoolClient,
  pageId: string,
  page: PageInfoResult
): Promise<void> {
  const rows = buildSocialRows(page);
  if (rows.length === 0) {
    await client.query(
      'UPDATE scraper.facebook_page_social_links SET is_active = false WHERE page_id = $1 AND is_active = true',
      [pageId]
    );
    return;
  }

  const platforms = rows.map((row) => row.platform);
  const handles = rows.map((row) => row.handle);
  const urls = rows.map((row) => row.url);

  await client.query(
    `
      UPDATE scraper.facebook_page_social_links existing
      SET is_active = false
      WHERE existing.page_id = $1
        AND existing.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM unnest($2::text[], $3::text[], $4::text[]) AS incoming(platform, handle, url)
          WHERE incoming.platform = existing.platform
            AND incoming.url = existing.url
        )
    `,
    [pageId, platforms, handles, urls]
  );

  await client.query(
    `
      INSERT INTO scraper.facebook_page_social_links (
        page_id,
        platform,
        handle,
        url,
        last_seen_at,
        is_active
      )
      SELECT $1, incoming.platform, incoming.handle, incoming.url, now(), true
      FROM unnest($2::text[], $3::text[], $4::text[]) AS incoming(platform, handle, url)
      ON CONFLICT (page_id, platform, url)
      DO UPDATE SET handle = EXCLUDED.handle, last_seen_at = now(), is_active = true
    `,
    [pageId, platforms, handles, urls]
  );
}

export async function persistPageInfoSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<PageInfoResult>
): Promise<ScrapeRunCompletion> {
  const pageId = await upsertFacebookPage(client, result.data);
  if (pageId) {
    await upsertFacebookPageContacts(client, pageId, result.data);
    await upsertFacebookPageSocialLinks(client, pageId, result.data);
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
        following,
        bio,
        location_text,
        creation_date_text,
        raw_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      scrapeRunId,
      pageId,
      result.data.url,
      result.data.name,
      result.data.category,
      result.data.followers,
      result.data.following,
      result.data.bio,
      result.data.location,
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
      contactCount: buildContactRows(result.data).length,
      socialLinkCount: result.data.contact.socialMedia.length
    }
  };
}
