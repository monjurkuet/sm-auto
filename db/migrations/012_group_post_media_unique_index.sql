-- Add missing unique index for group post media ON CONFLICT support
-- The upsert in group_repository.ts uses ON CONFLICT (post_id, media_id)
-- which requires a unique index on those columns.
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_post_media_post_media
  ON scraper.facebook_group_post_media(post_id, media_id);
