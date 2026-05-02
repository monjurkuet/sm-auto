-- Add provenance JSONB column to group posts and comments
-- Tracks which data source (graphql, embedded_document, dom, merged) provided each field

ALTER TABLE scraper.facebook_group_posts
  ADD COLUMN IF NOT EXISTS provenance jsonb;

ALTER TABLE scraper.facebook_group_post_comments
  ADD COLUMN IF NOT EXISTS provenance jsonb;

-- Index for querying posts by provenance source (e.g., find all posts where reactions came from DOM)
CREATE INDEX IF NOT EXISTS idx_group_posts_provenance_reactions
  ON scraper.facebook_group_posts (((provenance->>'reactions')))
  WHERE provenance IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_posts_provenance_comments
  ON scraper.facebook_group_posts (((provenance->>'comments')))
  WHERE provenance IS NOT NULL;

COMMENT ON COLUMN scraper.facebook_group_posts.provenance IS
  'Per-field data source tracking: maps field names to their origin (graphql, embedded_document, dom, merged)';

COMMENT ON COLUMN scraper.facebook_group_post_comments.provenance IS
  'Per-field data source tracking: maps field names to their origin (graphql, embedded_document, dom, merged)';
