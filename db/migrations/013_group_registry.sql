-- 013_group_registry.sql
-- Group monitoring registry, vitality columns, metrics history, analytics views

BEGIN;

-- ── Group Registry ──

CREATE TABLE IF NOT EXISTS scraper.facebook_group_registry (
  group_url     TEXT PRIMARY KEY,
  group_id      TEXT UNIQUE,
  name          TEXT,
  priority      SMALLINT NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  relevance_score SMALLINT CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 100)),
  info_scrape_interval_hrs  SMALLINT NOT NULL DEFAULT 24,
  posts_scrape_interval_hrs SMALLINT NOT NULL DEFAULT 6,
  last_info_scrape_at  TIMESTAMPTZ,
  last_posts_scrape_at TIMESTAMPTZ,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_registry_group_id ON scraper.facebook_group_registry(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registry_needs_posts ON scraper.facebook_group_registry(is_active, last_posts_scrape_at) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_registry_needs_info ON scraper.facebook_group_registry(is_active, last_info_scrape_at) WHERE is_active = true;

-- ── Vitality columns on facebook_groups ──

ALTER TABLE scraper.facebook_groups
  ADD COLUMN IF NOT EXISTS posting_frequency_7d REAL,
  ADD COLUMN IF NOT EXISTS avg_reactions_per_post REAL,
  ADD COLUMN IF NOT EXISTS avg_comments_per_post REAL,
  ADD COLUMN IF NOT EXISTS engagement_rate REAL,
  ADD COLUMN IF NOT EXISTS vitality_score SMALLINT CHECK (vitality_score IS NULL OR (vitality_score >= 0 AND vitality_score <= 100));

-- ── Post Metrics History ──

CREATE TABLE IF NOT EXISTS scraper.facebook_group_post_metrics_history (
  id            BIGSERIAL PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  post_count    INT NOT NULL DEFAULT 0,
  posts_with_reactions INT NOT NULL DEFAULT 0,
  posts_with_comments  INT NOT NULL DEFAULT 0,
  avg_reactions  REAL,
  avg_comments   REAL,
  avg_shares     REAL
);

CREATE INDEX IF NOT EXISTS idx_metrics_history_group_time
  ON scraper.facebook_group_post_metrics_history(group_id, snapshot_at DESC);

-- ── Analytics Views ──

CREATE OR REPLACE VIEW scraper.v_group_vitality AS
SELECT
  g.group_id,
  g.name,
  g.privacy_type,
  g.member_count,
  r.priority,
  r.is_active,
  r.relevance_score,
  r.last_info_scrape_at,
  r.last_posts_scrape_at,
  g.posting_frequency_7d,
  g.engagement_rate,
  g.vitality_score,
  (SELECT COUNT(*) FROM scraper.facebook_group_posts p WHERE p.group_id = g.group_id) AS total_posts_known,
  (SELECT COUNT(*) FROM scraper.facebook_group_posts p
   WHERE p.group_id = g.group_id
   AND p.last_seen_at > now() - interval '7 days') AS posts_last_7d,
  (SELECT COUNT(*) FROM scraper.facebook_group_posts p
   WHERE p.group_id = g.group_id
   AND p.last_seen_at > now() - interval '24 hours') AS posts_last_24h
FROM scraper.facebook_groups g
JOIN scraper.facebook_group_registry r ON r.group_id = g.group_id
WHERE r.is_active = true
ORDER BY g.vitality_score DESC NULLS LAST, r.priority ASC;

CREATE OR REPLACE VIEW scraper.v_top_posts_7d AS
SELECT
  p.post_id,
  p.group_id,
  g.name AS group_name,
  p.author_name,
  LEFT(p.text_content, 120) AS text_preview,
  p.reaction_count,
  p.comment_count,
  p.share_count,
  (COALESCE(p.reaction_count, 0) + COALESCE(p.comment_count, 0) + COALESCE(p.share_count, 0)) AS total_engagement,
  p.created_at,
  p.last_seen_at,
  p.permalink
FROM scraper.facebook_group_posts p
JOIN scraper.facebook_groups g ON g.group_id = p.group_id
WHERE p.last_seen_at > now() - interval '7 days'
ORDER BY total_engagement DESC;

CREATE OR REPLACE VIEW scraper.v_groups_needing_posts_scrape AS
SELECT
  r.group_url,
  r.group_id,
  r.name,
  r.priority,
  r.posts_scrape_interval_hrs
FROM scraper.facebook_group_registry r
WHERE r.is_active = true
  AND (r.last_posts_scrape_at IS NULL
       OR r.last_posts_scrape_at < now() - (r.posts_scrape_interval_hrs || ' hours')::interval)
ORDER BY r.priority ASC, r.last_posts_scrape_at ASC NULLS FIRST;

CREATE OR REPLACE VIEW scraper.v_groups_needing_info_scrape AS
SELECT
  r.group_url,
  r.group_id,
  r.name,
  r.priority,
  r.info_scrape_interval_hrs
FROM scraper.facebook_group_registry r
WHERE r.is_active = true
  AND (r.last_info_scrape_at IS NULL
       OR r.last_info_scrape_at < now() - (r.info_scrape_interval_hrs || ' hours')::interval)
ORDER BY r.priority ASC, r.last_info_scrape_at ASC NULLS FIRST;

COMMIT;
