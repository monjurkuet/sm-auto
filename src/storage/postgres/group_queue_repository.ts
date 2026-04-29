import type { PoolClient } from 'pg';

export interface GroupPostDetailCrawlOptions {
  groupId?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export async function selectGroupPostsForDetailCrawl(
  client: PoolClient,
  options: GroupPostDetailCrawlOptions = {}
): Promise<Array<{ postId: string; groupId: string; permalink: string | null }>> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  const params: unknown[] = [limit, offset];
  let paramIndex = 3;

  let groupFilter = '';
  if (options.groupId) {
    groupFilter = `AND p.group_id = $${paramIndex}`;
    params.push(options.groupId);
    paramIndex++;
  }

  const result = await client.query<{
    post_id: string;
    group_id: string;
    permalink: string | null;
  }>(
    `
    SELECT p.post_id, p.group_id, p.permalink
    FROM scraper.facebook_group_posts p
    WHERE p.post_id NOT IN (
      SELECT DISTINCT cs.post_id
      FROM scraper.facebook_group_comment_scrapes cs
    )
    AND p.is_active IS NOT false
    ${groupFilter}
    ORDER BY p.last_seen_at DESC
    LIMIT $1 OFFSET $2
    `,
    params
  );

  return result.rows.map((row) => ({
    postId: row.post_id,
    groupId: row.group_id,
    permalink: row.permalink
  }));
}

export async function countGroupPostsForDetailCrawl(
  client: PoolClient,
  options: GroupPostDetailCrawlOptions = {}
): Promise<number> {
  const params: unknown[] = [];
  let paramIndex = 1;

  let groupFilter = '';
  if (options.groupId) {
    groupFilter = `AND p.group_id = $${paramIndex}`;
    params.push(options.groupId);
    paramIndex++;
  }

  const result = await client.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM scraper.facebook_group_posts p
    WHERE p.post_id NOT IN (
      SELECT DISTINCT cs.post_id
      FROM scraper.facebook_group_comment_scrapes cs
    )
    AND p.is_active IS NOT false
    ${groupFilter}
    `,
    params
  );

  return parseInt(result.rows[0].count, 10);
}
