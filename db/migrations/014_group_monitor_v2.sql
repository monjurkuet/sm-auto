-- 014_group_monitor_v2.sql
-- Membership tracking, group_search/group_join surfaces, joinable view

BEGIN;

-- Membership status on registry
ALTER TABLE scraper.facebook_group_registry
  ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (membership_status IN ('unknown', 'not_joined', 'pending', 'joined', 'declined', 'left'));

ALTER TABLE scraper.facebook_group_registry
  ADD COLUMN IF NOT EXISTS join_requested_at TIMESTAMPTZ;

ALTER TABLE scraper.facebook_group_registry
  ADD COLUMN IF NOT EXISTS join_status_checked_at TIMESTAMPTZ;

-- Index for finding joinable groups
CREATE INDEX IF NOT EXISTS idx_registry_joinable
  ON scraper.facebook_group_registry(membership_status, is_active)
  WHERE is_active = true AND membership_status IN ('unknown', 'not_joined');

-- Index for stale membership checks
CREATE INDEX IF NOT EXISTS idx_registry_membership_stale
  ON scraper.facebook_group_registry(join_status_checked_at)
  WHERE is_active = true AND membership_status NOT IN ('joined', 'declined');

-- Add group_search and group_join surfaces to scrape_runs CHECK constraint
ALTER TABLE scraper.scrape_runs DROP CONSTRAINT scrape_runs_surface_check;
ALTER TABLE scraper.scrape_runs ADD CONSTRAINT scrape_runs_surface_check
  CHECK (surface IN (
    'marketplace_search', 'marketplace_listing', 'marketplace_seller',
    'page_info', 'page_posts',
    'group_info', 'group_posts', 'group_post_detail',
    'group_join', 'group_search'
  ));

-- View: joinable groups
CREATE OR REPLACE VIEW scraper.v_groups_joinable AS
SELECT group_url, group_id, name, priority, membership_status
FROM scraper.facebook_group_registry
WHERE is_active = true
  AND membership_status IN ('unknown', 'not_joined')
ORDER BY priority ASC, group_id;

-- View: groups needing membership check (stale or unknown)
CREATE OR REPLACE VIEW scraper.v_groups_needing_membership_check AS
SELECT
  group_url,
  group_id,
  name,
  priority,
  membership_status
FROM scraper.facebook_group_registry
WHERE is_active = true
  AND (join_status_checked_at IS NULL
       OR join_status_checked_at < now() - interval '24 hours')
  AND membership_status NOT IN ('joined', 'declined')
ORDER BY priority ASC, join_status_checked_at ASC NULLS FIRST;

COMMIT;
