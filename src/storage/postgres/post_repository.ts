import type { PoolClient } from 'pg';

import type { ExtractorResult, PagePost, PagePostsResult } from '../../types/contracts';
import type { ScrapeRunCompletion } from './persistence_contracts';
import { upsertFacebookPageStub } from './page_repository';
import { insertArtifacts, toIsoTimestamp, toJsonb } from './persistence_utils';

async function batchFindExistingPosts(client: PoolClient, posts: PagePost[]): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  if (posts.length === 0) {
    return results;
  }

  const externalPostIds = posts.map((p) => p.postId).filter((id): id is string => id !== null);
  const storyIds = posts.map((p) => p.id).filter((id): id is string => id !== null);
  const permalinks = posts.map((p) => p.permalink).filter((url): url is string => url !== null);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (externalPostIds.length > 0) {
    conditions.push(`external_post_id = ANY($${paramIndex}::text[])`);
    params.push(externalPostIds);
    paramIndex++;
  }
  if (storyIds.length > 0) {
    conditions.push(`story_id = ANY($${paramIndex}::text[])`);
    params.push(storyIds);
    paramIndex++;
  }
  if (permalinks.length > 0) {
    conditions.push(`permalink = ANY($${paramIndex}::text[])`);
    params.push(permalinks);
  }

  if (conditions.length === 0) {
    return results;
  }

  const query = `
    SELECT id, external_post_id, story_id, permalink
    FROM scraper.facebook_posts
    WHERE ${conditions.join(' OR ')}
  `;

  const existing = await client.query<{
    id: number;
    external_post_id: string | null;
    story_id: string | null;
    permalink: string | null;
  }>(query, params);

  for (const row of existing.rows) {
    if (row.external_post_id) results.set(row.external_post_id, row.id);
    if (row.story_id) results.set(row.story_id, row.id);
    if (row.permalink) results.set(row.permalink, row.id);
  }

  return results;
}

async function batchInsertPostScrapes(
  client: PoolClient,
  scrapeRunId: string,
  recordIds: number[],
  posts: PagePost[]
): Promise<number[]> {
  if (recordIds.length === 0) {
    return [];
  }

  const positions = recordIds.map((_, i) => i);
  const reactions = posts.map((p) => p.metrics.reactions);
  const comments = posts.map((p) => p.metrics.comments);
  const shares = posts.map((p) => p.metrics.shares);
  const rawResults = posts.map((p) => toJsonb(p));

  const inserted = await client.query<{ id: number }>(
    `
      INSERT INTO scraper.facebook_post_scrapes (
        scrape_run_id,
        post_record_id,
        position,
        reactions,
        comments,
        shares,
        raw_result
      )
      SELECT
        $1,
        input.post_record_id,
        input.position,
        input.reactions,
        input.comments,
        input.shares,
        input.raw_result
      FROM unnest(
        $2::int[],
        $3::int[],
        $4::int[],
        $5::int[],
        $6::int[],
        $7::jsonb[]
      ) AS input(
        post_record_id,
        position,
        reactions,
        comments,
        shares,
        raw_result
      )
      ON CONFLICT (scrape_run_id, post_record_id)
      DO UPDATE SET
        position = EXCLUDED.position,
        reactions = EXCLUDED.reactions,
        comments = EXCLUDED.comments,
        shares = EXCLUDED.shares,
        raw_result = EXCLUDED.raw_result,
        observed_at = now()
      RETURNING id
    `,
    [scrapeRunId, recordIds, positions, reactions, comments, shares, rawResults]
  );

  return inserted.rows.map((row) => row.id);
}

async function batchInsertPostTags(client: PoolClient, postScrapeIds: number[], posts: PagePost[]): Promise<void> {
  const allTags: Array<{ postScrapeId: number; type: string; value: string; position: number }> = [];

  for (let postIndex = 0; postIndex < posts.length; postIndex++) {
    const postScrapeId = postScrapeIds[postIndex];
    const post = posts[postIndex];

    for (const value of post.hashtags) {
      allTags.push({ postScrapeId, type: 'hashtag', value, position: 0 });
    }
    for (const value of post.mentions) {
      allTags.push({ postScrapeId, type: 'mention', value, position: 0 });
    }
    for (const value of post.links) {
      allTags.push({ postScrapeId, type: 'link', value, position: 0 });
    }
  }

  if (allTags.length === 0) {
    return;
  }

  const scrapeIds = allTags.map((t) => t.postScrapeId);
  const types = allTags.map((t) => t.type);
  const values = allTags.map((t) => t.value);
  const positions = allTags.map((t) => t.position);

  await client.query(
    `
      INSERT INTO scraper.facebook_post_tags (post_scrape_id, tag_type, tag_value, position)
      SELECT
        input.post_scrape_id,
        input.tag_type,
        input.tag_value,
        input.position
      FROM unnest(
        $1::int[],
        $2::text[],
        $3::text[],
        $4::integer[]
      ) AS input(post_scrape_id, tag_type, tag_value, position)
      ON CONFLICT (post_scrape_id, tag_type, tag_value, position)
      DO NOTHING
    `,
    [scrapeIds, types, values, positions]
  );
}

async function batchInsertPostMedia(client: PoolClient, postScrapeIds: number[], posts: PagePost[]): Promise<void> {
  type MediaRow = {
    postScrapeId: number;
    position: number;
    mediaType: string;
    mediaExternalId: string | null;
    url: string | null;
    width: number | null;
    height: number | null;
    durationSec: number | null;
  };

  const allMedia: MediaRow[] = [];

  for (let postIndex = 0; postIndex < posts.length; postIndex++) {
    const postScrapeId = postScrapeIds[postIndex];
    const post = posts[postIndex];

    for (let mediaIndex = 0; mediaIndex < post.media.length; mediaIndex++) {
      const media = post.media[mediaIndex];
      allMedia.push({
        postScrapeId,
        position: mediaIndex,
        mediaType: media.type,
        mediaExternalId: media.id,
        url: media.url,
        width: media.width ?? null,
        height: media.height ?? null,
        durationSec: media.durationSec ?? null
      });
    }
  }

  if (allMedia.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO scraper.facebook_post_media (
        post_scrape_id,
        position,
        media_type,
        media_external_id,
        url,
        width,
        height,
        duration_sec
      )
      SELECT
        input.post_scrape_id,
        input.position,
        input.media_type,
        input.media_external_id,
        input.url,
        input.width,
        input.height,
        input.duration_sec
      FROM unnest(
        $1::int[],
        $2::integer[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::integer[],
        $7::integer[],
        $8::numeric[]
      ) AS input(
        post_scrape_id,
        position,
        media_type,
        media_external_id,
        url,
        width,
        height,
        duration_sec
      )
      ON CONFLICT (post_scrape_id, position)
      DO UPDATE SET
        media_type = EXCLUDED.media_type,
        media_external_id = EXCLUDED.media_external_id,
        url = EXCLUDED.url,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        duration_sec = EXCLUDED.duration_sec
    `,
    [
      allMedia.map((m) => m.postScrapeId),
      allMedia.map((m) => m.position),
      allMedia.map((m) => m.mediaType),
      allMedia.map((m) => m.mediaExternalId),
      allMedia.map((m) => m.url),
      allMedia.map((m) => m.width),
      allMedia.map((m) => m.height),
      allMedia.map((m) => m.durationSec)
    ]
  );
}

export async function findFacebookPostRecordId(client: PoolClient, post: PagePost): Promise<number | null> {
  const existing = await client.query<{ id: number }>(
    `
      SELECT id
      FROM scraper.facebook_posts
      WHERE ($1::text IS NOT NULL AND external_post_id = $1)
         OR ($2::text IS NOT NULL AND story_id = $2)
         OR ($3::text IS NOT NULL AND permalink = $3)
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND external_post_id = $1 THEN 1
          WHEN $2::text IS NOT NULL AND story_id = $2 THEN 2
          WHEN $3::text IS NOT NULL AND permalink = $3 THEN 3
          ELSE 4
        END
      LIMIT 1
    `,
    [post.postId, post.id, post.permalink]
  );

  return existing.rows[0]?.id ?? null;
}

export async function upsertFacebookPost(client: PoolClient, pageId: string | null, post: PagePost): Promise<number> {
  const existingId = await findFacebookPostRecordId(client, post);
  const createdAt = toIsoTimestamp(post.createdAt);

  if (!existingId) {
    const inserted = await client.query<{ id: number }>(
      `
        INSERT INTO scraper.facebook_posts (
          external_post_id,
          story_id,
          permalink,
          page_id,
          author_id,
          author_name,
          created_at,
          body_text,
          last_seen_at,
          last_scraped_at,
          latest_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), $9)
        RETURNING id
      `,
      [
        post.postId,
        post.id,
        post.permalink,
        pageId,
        post.author.id,
        post.author.name,
        createdAt,
        post.text,
        toJsonb(post)
      ]
    );
    return inserted.rows[0].id;
  }

  await client.query(
    `
      UPDATE scraper.facebook_posts
      SET
        external_post_id = COALESCE($2, external_post_id),
        story_id = COALESCE($3, story_id),
        permalink = COALESCE($4, permalink),
        page_id = COALESCE($5, page_id),
        author_id = COALESCE($6, author_id),
        author_name = COALESCE($7, author_name),
        created_at = COALESCE($8, created_at),
        body_text = COALESCE($9, body_text),
        last_seen_at = now(),
        last_scraped_at = now(),
        latest_payload = $10
      WHERE id = $1
    `,
    [
      existingId,
      post.postId,
      post.id,
      post.permalink,
      pageId,
      post.author.id,
      post.author.name,
      createdAt,
      post.text,
      toJsonb(post)
    ]
  );

  return existingId;
}

export async function persistPagePostsSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<PagePostsResult>
): Promise<ScrapeRunCompletion> {
  if (result.data.pageId) {
    await upsertFacebookPageStub(client, result.data.pageId, result.data.url);
  }

  const posts = result.data.posts;
  const pageId = result.data.pageId;

  const existingMap = await batchFindExistingPosts(client, posts);

  const recordIds: number[] = [];

  for (const post of posts) {
    const existingId =
      existingMap.get(post.postId ?? '') ?? existingMap.get(post.id ?? '') ?? existingMap.get(post.permalink ?? '');

    if (existingId) {
      recordIds.push(existingId);
    } else {
      const createdAt = toIsoTimestamp(post.createdAt);
      const inserted = await client.query<{ id: number }>(
        `
          INSERT INTO scraper.facebook_posts (
            external_post_id,
            story_id,
            permalink,
            page_id,
            author_id,
            author_name,
            created_at,
            body_text,
            last_seen_at,
            last_scraped_at,
            latest_payload
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), $9)
          RETURNING id
        `,
        [
          post.postId,
          post.id,
          post.permalink,
          pageId,
          post.author.id,
          post.author.name,
          createdAt,
          post.text,
          toJsonb(post)
        ]
      );
      recordIds.push(inserted.rows[0].id);
    }
  }

  if (recordIds.length > 0) {
    await client.query(
      `
        UPDATE scraper.facebook_posts
        SET
          last_seen_at = now(),
          last_scraped_at = now()
        WHERE id = ANY($1::int[])
      `,
      [recordIds]
    );
  }

  const postScrapeIds = await batchInsertPostScrapes(client, scrapeRunId, recordIds, posts);

  await batchInsertPostTags(client, postScrapeIds, posts);
  await batchInsertPostMedia(client, postScrapeIds, posts);

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: result.data.pageId,
    sourceUrl: result.data.url,
    outputSummary: {
      pageId: result.data.pageId,
      postCount: result.data.posts.length
    }
  };
}
