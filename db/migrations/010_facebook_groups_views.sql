-- Latest group info view
CREATE OR REPLACE VIEW scraper.v_latest_group_info AS
SELECT DISTINCT ON (g.group_id)
  g.group_id,
  g.name,
  g.vanity_slug,
  g.privacy_type,
  g.group_type,
  g.member_count,
  g.description,
  g.cover_photo_url,
  g.last_scraped_at
FROM scraper.facebook_groups g
WHERE g.is_active = true
ORDER BY g.group_id, g.last_seen_at DESC;

-- Latest group posts view
CREATE OR REPLACE VIEW scraper.v_latest_group_posts AS
SELECT DISTINCT ON (gp.post_id)
  gp.post_id,
  gp.group_id,
  gp.author_name,
  gp.permalink,
  gp.created_at,
  gp.text_content,
  gp.reaction_count,
  gp.comment_count,
  gp.share_count,
  gp.last_scraped_at,
  g.name as group_name
FROM scraper.facebook_group_posts gp
JOIN scraper.facebook_groups g ON g.group_id = gp.group_id
ORDER BY gp.post_id, gp.last_seen_at DESC;

-- Post comment summary view
CREATE OR REPLACE VIEW scraper.v_post_comment_summary AS
SELECT
  c.post_id,
  COUNT(*) FILTER (WHERE c.parent_comment_id IS NULL) as top_level_comments,
  COUNT(*) FILTER (WHERE c.parent_comment_id IS NOT NULL) as replies,
  COUNT(DISTINCT c.author_id) as unique_authors
FROM scraper.facebook_group_post_comments c
WHERE c.is_active = true
GROUP BY c.post_id;
