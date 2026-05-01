import type { PoolClient } from 'pg';

import type {
  ExtractorResult,
  GroupAdmin,
  GroupInfoResult,
  GroupJoinResult,
  GroupPost,
  GroupPostComment,
  GroupPostDetailResult,
  GroupPostsResult
} from '../../types/contracts';
import type { ScrapeRunCompletion } from './persistence_contracts';
import { insertArtifacts, toIsoTimestamp, toJsonb } from './persistence_utils';

// ── Group Upsert ──

export async function upsertFacebookGroup(
  client: PoolClient,
  group: {
    groupId: string | null;
    name: string | null;
    vanitySlug: string | null;
    privacyType: string | null;
    groupType: string | null;
    memberCount: number | null;
    description: string | null;
    coverPhotoUrl: string | null;
  }
): Promise<string | null> {
  if (!group.groupId) {
    return null;
  }

  await client.query(
    `
    INSERT INTO scraper.facebook_groups (
      group_id,
      name,
      vanity_slug,
      privacy_type,
      group_type,
      member_count,
      description,
      cover_photo_url,
      last_seen_at,
      latest_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
    ON CONFLICT (group_id)
    DO UPDATE SET
      name = COALESCE(EXCLUDED.name, scraper.facebook_groups.name),
      vanity_slug = COALESCE(EXCLUDED.vanity_slug, scraper.facebook_groups.vanity_slug),
      privacy_type = COALESCE(EXCLUDED.privacy_type, scraper.facebook_groups.privacy_type),
      group_type = COALESCE(EXCLUDED.group_type, scraper.facebook_groups.group_type),
      member_count = COALESCE(EXCLUDED.member_count, scraper.facebook_groups.member_count),
      description = COALESCE(EXCLUDED.description, scraper.facebook_groups.description),
      cover_photo_url = COALESCE(EXCLUDED.cover_photo_url, scraper.facebook_groups.cover_photo_url),
      last_seen_at = now(),
      latest_payload = EXCLUDED.latest_payload
    `,
    [
      group.groupId,
      group.name,
      group.vanitySlug,
      group.privacyType,
      group.groupType,
      group.memberCount,
      group.description,
      group.coverPhotoUrl,
      toJsonb(group)
    ]
  );

  return group.groupId;
}

// ── Group Admins ──

export async function upsertGroupAdmins(
  client: PoolClient,
  groupId: string,
  admins: Array<{ id: string | null; name: string | null; adminType: string | null }>
): Promise<void> {
  const validAdmins = admins.filter((admin) => admin.id !== null) as Array<{
    id: string;
    name: string | null;
    adminType: string | null;
  }>;

  // Soft-delete admins no longer in the list
  if (validAdmins.length === 0) {
    await client.query(
      `UPDATE scraper.facebook_group_admins SET is_active = false WHERE group_id = $1 AND is_active = true`,
      [groupId]
    );
    return;
  }

  const userIds = validAdmins.map((a) => a.id);
  const userNames = validAdmins.map((a) => a.name);
  const adminTypes = validAdmins.map((a) => a.adminType);

  await client.query(
    `
    UPDATE scraper.facebook_group_admins existing
    SET is_active = false
    WHERE existing.group_id = $1
    AND existing.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM unnest($2::text[]) AS incoming(user_id)
      WHERE incoming.user_id = existing.user_id
    )
    `,
    [groupId, userIds]
  );

  await client.query(
    `
    INSERT INTO scraper.facebook_group_admins (
      group_id,
      user_id,
      user_name,
      admin_type,
      last_seen_at,
      is_active
    )
    SELECT $1, incoming.user_id, incoming.user_name, incoming.admin_type, now(), true
    FROM unnest($2::text[], $3::text[], $4::text[]) AS incoming(user_id, user_name, admin_type)
    ON CONFLICT (group_id, user_id)
    DO UPDATE SET
      user_name = COALESCE(EXCLUDED.user_name, scraper.facebook_group_admins.user_name),
      admin_type = COALESCE(EXCLUDED.admin_type, scraper.facebook_group_admins.admin_type),
      last_seen_at = now(),
      is_active = true
    `,
    [groupId, userIds, userNames, adminTypes]
  );
}

// ── Group Rules ──

export async function upsertGroupRules(
  client: PoolClient,
  groupId: string,
  rules: string[]
): Promise<void> {
  // Soft-delete all existing rules for this group
  await client.query(
    `UPDATE scraper.facebook_group_rules SET is_active = false WHERE group_id = $1 AND is_active = true`,
    [groupId]
  );

  if (rules.length === 0) {
    return;
  }

  const positions = rules.map((_, i) => i);
  const ruleTexts = rules;

  await client.query(
    `
    INSERT INTO scraper.facebook_group_rules (
      group_id,
      rule_text,
      position,
      first_seen_at,
      last_seen_at,
      is_active
    )
    SELECT $1, incoming.rule_text, incoming.position, now(), now(), true
    FROM unnest($2::text[], $3::int[]) AS incoming(rule_text, position)
    ON CONFLICT (group_id, rule_text, position)
    DO UPDATE SET last_seen_at = now(), is_active = true
    `,
    [groupId, ruleTexts, positions]
  );
}

// ── Group Tags ──

export async function upsertGroupTags(
  client: PoolClient,
  groupId: string,
  tags: string[]
): Promise<void> {
  // Soft-delete all existing tags for this group
  await client.query(
    `UPDATE scraper.facebook_group_tags SET is_active = false WHERE group_id = $1 AND is_active = true`,
    [groupId]
  );

  if (tags.length === 0) {
    return;
  }

  await client.query(
    `
    INSERT INTO scraper.facebook_group_tags (
      group_id,
      tag_text,
      first_seen_at,
      last_seen_at,
      is_active
    )
    SELECT $1, incoming.tag_text, now(), now(), true
    FROM unnest($2::text[]) AS incoming(tag_text)
    ON CONFLICT (group_id, tag_text)
    DO UPDATE SET last_seen_at = now(), is_active = true
    `,
    [groupId, tags]
  );
}

// ── Group Info Surface ──

export async function persistGroupInfoSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<GroupInfoResult>
): Promise<ScrapeRunCompletion> {
  const groupId = await upsertFacebookGroup(client, result.data);

  if (groupId) {
    await upsertGroupAdmins(client, groupId, result.data.admins);
    await upsertGroupRules(client, groupId, result.data.rules);
    await upsertGroupTags(client, groupId, result.data.tags);
  }

  await client.query(
    `
    INSERT INTO scraper.facebook_group_info_scrapes (
      scrape_run_id,
      group_id,
      scraped_at
    ) VALUES ($1, $2, $3)
    `,
    [scrapeRunId, groupId, result.data.scrapedAt]
  );

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: groupId,
    sourceUrl: result.data.url,
    outputSummary: {
      groupId,
      name: result.data.name,
      memberCount: result.data.memberCount,
      adminCount: result.data.admins.length,
      ruleCount: result.data.rules.length,
      tagCount: result.data.tags.length
    }
  };
}

// ── Group Posts ──

export async function upsertGroupPosts(
  client: PoolClient,
  groupId: string,
  posts: GroupPost[]
): Promise<void> {
  if (posts.length === 0) {
    return;
  }

  const postIds = posts.map((p) => p.postId);
  const permalinks = posts.map((p) => p.permalink);
  const authorIds = posts.map((p) => p.author?.id ?? null);
  const authorNames = posts.map((p) => p.author?.name ?? null);
  const createdAts = posts.map((p) => toIsoTimestamp(p.createdAt));
  const textContents = posts.map((p) => p.text);
  const hasAttachments = posts.map((p) => (p.media && p.media.length > 0) || null);
  const attachmentTypes = posts.map((p) =>
    p.media && p.media.length > 0 ? p.media[0].type ?? null : null
  );
  const isApproved = posts.map((p) => p.isApproved);
  const reactionCounts = posts.map((p) => p.metrics?.reactions ?? null);
  const commentCounts = posts.map((p) => p.metrics?.comments ?? null);
  const shareCounts = posts.map((p) => p.metrics?.shares ?? null);
  const latestPayloads = posts.map((p) => toJsonb(p));

  await client.query(
    `
    INSERT INTO scraper.facebook_group_posts (
      post_id,
      group_id,
      author_id,
      author_name,
      permalink,
      created_at,
      text_content,
      has_attachments,
      attachment_type,
      is_approved,
      reaction_count,
      comment_count,
      share_count,
      last_seen_at,
      latest_payload
    )
    SELECT
      input.post_id,
      $1,
      input.author_id,
      input.author_name,
      input.permalink,
      input.created_at,
      input.text_content,
      input.has_attachments,
      input.attachment_type,
      input.is_approved,
      input.reaction_count,
      input.comment_count,
      input.share_count,
      now(),
      input.latest_payload
    FROM unnest(
      $2::text[],
      $3::text[],
      $4::text[],
      $5::text[],
      $6::timestamptz[],
      $7::text[],
      $8::boolean[],
      $9::text[],
      $10::boolean[],
      $11::int[],
      $12::int[],
      $13::int[],
      $14::jsonb[]
    ) AS input(
      post_id,
      permalink,
      author_id,
      author_name,
      created_at,
      text_content,
      has_attachments,
      attachment_type,
      is_approved,
      reaction_count,
      comment_count,
      share_count,
      latest_payload
    )
    ON CONFLICT (post_id)
    DO UPDATE SET
      author_id = COALESCE(EXCLUDED.author_id, scraper.facebook_group_posts.author_id),
      author_name = COALESCE(EXCLUDED.author_name, scraper.facebook_group_posts.author_name),
      permalink = COALESCE(EXCLUDED.permalink, scraper.facebook_group_posts.permalink),
      created_at = COALESCE(EXCLUDED.created_at, scraper.facebook_group_posts.created_at),
      text_content = COALESCE(EXCLUDED.text_content, scraper.facebook_group_posts.text_content),
      has_attachments = COALESCE(EXCLUDED.has_attachments, scraper.facebook_group_posts.has_attachments),
      attachment_type = COALESCE(EXCLUDED.attachment_type, scraper.facebook_group_posts.attachment_type),
      is_approved = COALESCE(EXCLUDED.is_approved, scraper.facebook_group_posts.is_approved),
      reaction_count = COALESCE(EXCLUDED.reaction_count, scraper.facebook_group_posts.reaction_count),
      comment_count = COALESCE(EXCLUDED.comment_count, scraper.facebook_group_posts.comment_count),
      share_count = COALESCE(EXCLUDED.share_count, scraper.facebook_group_posts.share_count),
      last_seen_at = now(),
      latest_payload = EXCLUDED.latest_payload
    `,
    [
      groupId,
      postIds,
      permalinks,
      authorIds,
      authorNames,
      createdAts,
      textContents,
      hasAttachments,
      attachmentTypes,
      isApproved,
      reactionCounts,
      commentCounts,
      shareCounts,
      latestPayloads
    ]
  );

  // Insert post_media for each post's media array
  for (const post of posts) {
    if (!post.postId || !post.media || post.media.length === 0) {
      continue;
    }

    const mediaTypes = post.media.map((m) => m.type);
    const mediaIds = post.media.map((m) => m.id);
    const mediaUrls = post.media.map((m) => m.url);
    const mediaWidths = post.media.map((m) => m.width ?? null);
    const mediaHeights = post.media.map((m) => m.height ?? null);

    await client.query(
      `
      INSERT INTO scraper.facebook_group_post_media (
        post_id,
        media_type,
        media_id,
        media_url,
        width,
        height,
        first_seen_at,
        last_seen_at,
        is_active
      )
      SELECT
        $1,
        input.media_type,
        input.media_id,
        input.media_url,
        input.width,
        input.height,
        now(),
        now(),
        true
      FROM unnest(
        $2::text[],
        $3::text[],
        $4::text[],
        $5::int[],
        $6::int[]
      ) AS input(
        media_type,
        media_id,
        media_url,
        width,
        height
      )
      ON CONFLICT (post_id, media_id)
      DO UPDATE SET
        media_type = COALESCE(EXCLUDED.media_type, scraper.facebook_group_post_media.media_type),
        media_url = COALESCE(EXCLUDED.media_url, scraper.facebook_group_post_media.media_url),
        width = COALESCE(EXCLUDED.width, scraper.facebook_group_post_media.width),
        height = COALESCE(EXCLUDED.height, scraper.facebook_group_post_media.height),
        last_seen_at = now(),
        is_active = true
      `,
      [post.postId, mediaTypes, mediaIds, mediaUrls, mediaWidths, mediaHeights]
    );
  }
}

// ── Group Posts Surface ──

export async function persistGroupPostsSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<GroupPostsResult>
): Promise<ScrapeRunCompletion> {
  const groupId = result.data.groupId;

  if (groupId) {
    await upsertGroupPosts(client, groupId, result.data.posts);
  }

  // Insert group_post_scrapes for each post
  for (const post of result.data.posts) {
    if (!post.postId) {
      continue;
    }

    await client.query(
      `
      INSERT INTO scraper.facebook_group_post_scrapes (
        scrape_run_id,
        post_id,
        scraped_at
      ) VALUES ($1, $2, $3)
      `,
      [scrapeRunId, post.postId, result.data.scrapedAt]
    );
  }

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: groupId,
    sourceUrl: result.data.url,
    outputSummary: {
      groupId,
      postCount: result.data.posts.length
    }
  };
}

// ── Group Post Comments ──

export async function upsertGroupPostComments(
  client: PoolClient,
  postId: string,
  comments: GroupPostComment[]
): Promise<void> {
  if (comments.length === 0) {
    return;
  }

  const commentIds = comments.map((c) => c.id);
  const parentCommentIds = comments.map((c) => c.parentId ?? null);
  const authorIds = comments.map((c) => c.author?.id ?? null);
  const authorNames = comments.map((c) => c.author?.name ?? null);
  const textContents = comments.map((c) => c.text);
  const createdAts = comments.map((c) => toIsoTimestamp(c.createdAt));
  const reactionCounts = comments.map((c) => c.metrics?.reactions ?? null);
  const replyCounts = comments.map((c) => c.metrics?.replies ?? null);
  const latestPayloads = comments.map((c) => toJsonb(c));

  await client.query(
    `
    INSERT INTO scraper.facebook_group_post_comments (
      comment_id,
      post_id,
      parent_comment_id,
      author_id,
      author_name,
      text_content,
      created_at,
      reaction_count,
      reply_count,
      last_seen_at,
      latest_payload
    )
    SELECT
      input.comment_id,
      $1,
      input.parent_comment_id,
      input.author_id,
      input.author_name,
      input.text_content,
      input.created_at,
      input.reaction_count,
      input.reply_count,
      now(),
      input.latest_payload
    FROM unnest(
      $2::text[],
      $3::text[],
      $4::text[],
      $5::text[],
      $6::text[],
      $7::timestamptz[],
      $8::int[],
      $9::int[],
      $10::jsonb[]
    ) AS input(
      comment_id,
      parent_comment_id,
      author_id,
      author_name,
      text_content,
      created_at,
      reaction_count,
      reply_count,
      latest_payload
    )
    ON CONFLICT (comment_id)
    DO UPDATE SET
      parent_comment_id = COALESCE(EXCLUDED.parent_comment_id, scraper.facebook_group_post_comments.parent_comment_id),
      author_id = COALESCE(EXCLUDED.author_id, scraper.facebook_group_post_comments.author_id),
      author_name = COALESCE(EXCLUDED.author_name, scraper.facebook_group_post_comments.author_name),
      text_content = COALESCE(EXCLUDED.text_content, scraper.facebook_group_post_comments.text_content),
      created_at = COALESCE(EXCLUDED.created_at, scraper.facebook_group_post_comments.created_at),
      reaction_count = COALESCE(EXCLUDED.reaction_count, scraper.facebook_group_post_comments.reaction_count),
      reply_count = COALESCE(EXCLUDED.reply_count, scraper.facebook_group_post_comments.reply_count),
      last_seen_at = now(),
      latest_payload = EXCLUDED.latest_payload
    `,
    [
      postId,
      commentIds,
      parentCommentIds,
      authorIds,
      authorNames,
      textContents,
      createdAts,
      reactionCounts,
      replyCounts,
      latestPayloads
    ]
  );
}

// ── Group Post Detail Surface ──

export async function persistGroupPostDetailSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<GroupPostDetailResult>
): Promise<ScrapeRunCompletion> {
  const postId = result.data.postId;
  const groupId = result.data.groupId;

  // Upsert the post itself
  if (postId && groupId) {
    await upsertGroupPosts(client, groupId, [result.data.post]);
  }

  // Upsert comments
  if (postId) {
    await upsertGroupPostComments(client, postId, result.data.comments);
  }

  // Insert comment_scrapes for each comment
  for (const comment of result.data.comments) {
    if (!comment.id) {
      continue;
    }

    await client.query(
      `
      INSERT INTO scraper.facebook_group_comment_scrapes (
        scrape_run_id,
        comment_id,
        scraped_at
      ) VALUES ($1, $2, $3)
      `,
      [scrapeRunId, comment.id, result.data.scrapedAt]
    );
  }

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    entityExternalId: postId,
    sourceUrl: result.data.url,
    outputSummary: {
      postId,
      groupId,
      commentCount: result.data.comments.length,
      totalCommentCount: result.data.totalCommentCount
    }
  };
}

// ── Group Join Surface ──

export async function persistGroupJoinSurface(
  client: PoolClient,
  scrapeRunId: string,
  result: ExtractorResult<GroupJoinResult>
): Promise<ScrapeRunCompletion> {
  await client.query(
    `
    INSERT INTO scraper.facebook_group_join_scrapes (
      scrape_run_id,
      group_url,
      membership_status,
      previous_status,
      action_taken,
      scraped_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      scrapeRunId,
      result.data.url,
      result.data.membershipStatus,
      result.data.previousStatus,
      result.data.actionTaken,
      result.data.scrapedAt
    ]
  );

  await insertArtifacts(client, scrapeRunId, result.artifacts);

  return {
    sourceUrl: result.data.url,
    outputSummary: {
      membershipStatus: result.data.membershipStatus,
      previousStatus: result.data.previousStatus,
      actionTaken: result.data.actionTaken
    }
  };
}
