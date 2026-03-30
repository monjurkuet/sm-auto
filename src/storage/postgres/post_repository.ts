import type { PoolClient } from 'pg';

import type { ExtractorResult, PagePost, PagePostsResult } from '../../types/contracts';
import type { ScrapeRunCompletion } from './persistence_contracts';
import { upsertFacebookPageStub } from './page_repository';
import { insertArtifacts, toIsoTimestamp, toJsonb } from './persistence_utils';

export async function findFacebookPostRecordId(client: PoolClient, post: PagePost): Promise<number | null> {
    const lookups: Array<[string, string | null]> = [
        ['external_post_id', post.postId],
        ['story_id', post.id],
        ['permalink', post.permalink]
    ];

    for (const [column, value] of lookups) {
        if (!value) {
            continue;
        }

        const existing = await client.query<{ id: number }>(`SELECT id FROM scraper.facebook_posts WHERE ${column} = $1 LIMIT 1`, [value]);
        if (existing.rows[0]?.id) {
            return existing.rows[0].id;
        }
    }

    return null;
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
            [post.postId, post.id, post.permalink, pageId, post.author.id, post.author.name, createdAt, post.text, toJsonb(post)]
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
        [existingId, post.postId, post.id, post.permalink, pageId, post.author.id, post.author.name, createdAt, post.text, toJsonb(post)]
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

    for (const [index, post] of result.data.posts.entries()) {
        const recordId = await upsertFacebookPost(client, result.data.pageId, post);
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
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
            [scrapeRunId, recordId, index, post.metrics.reactions, post.metrics.comments, post.metrics.shares, toJsonb(post)]
        );

        const postScrapeId = inserted.rows[0].id;
        const tags = [
            ...post.hashtags.map((value, position) => ({ type: 'hashtag' as const, value, position })),
            ...post.mentions.map((value, position) => ({ type: 'mention' as const, value, position })),
            ...post.links.map((value, position) => ({ type: 'link' as const, value, position }))
        ];

        for (const tag of tags) {
            await client.query(
                `
          INSERT INTO scraper.facebook_post_tags (
            post_scrape_id,
            tag_type,
            tag_value,
            position
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (post_scrape_id, tag_type, tag_value, position)
          DO NOTHING
        `,
                [postScrapeId, tag.type, tag.value, tag.position]
            );
        }

        for (const [mediaIndex, media] of post.media.entries()) {
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (post_scrape_id, position)
          DO UPDATE SET
            media_type = EXCLUDED.media_type,
            media_external_id = EXCLUDED.media_external_id,
            url = EXCLUDED.url,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            duration_sec = EXCLUDED.duration_sec
        `,
                [postScrapeId, mediaIndex, media.type, media.id, media.url, media.width ?? null, media.height ?? null, media.durationSec ?? null]
            );
        }
    }

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