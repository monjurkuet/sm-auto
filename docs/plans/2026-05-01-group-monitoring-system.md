# Facebook Group Monitoring System

> **STATUS: IMPLEMENTED AND LIVE (2026-05-01).** All 7 tasks completed. System is running on cron. See `docs/FACEBOOK_GROUPS_REPORT.md` for the full system report.

## Architecture Overview

A cron-driven monitoring system that periodically scrapes registered Facebook groups, scores their vitality, and continuously crawls post details (comments/replies). Three layers:

1. **Group Registry** — which groups to monitor, how often, priority, relevance score
2. **Scrape Pipeline** — group_info (daily) → group_posts (every 6h) → group_post_detail (continuous queue)
3. **Analytics Layer** — SQL views for vitality scoring, engagement trends, top posts

All scrapers already exist. The new work is: registry schema, orchestration script, cron config, and analytics views.

## DB Schema Changes

### New table: `facebook_group_registry`

```sql
CREATE TABLE scraper.facebook_group_registry (
  group_url     TEXT PRIMARY KEY,          -- canonical FB group URL
  group_id      TEXT UNIQUE,               -- numeric group_id (populated after first info scrape)
  name          TEXT,                       -- cached group name
  priority      SMALLINT NOT NULL DEFAULT 5,  -- 1=critical, 10=low
  is_active     BOOLEAN NOT NULL DEFAULT true,
  relevance_score SMALLINT,                -- 0-100, computed from vitality metrics
  info_scrape_interval_hrs  SMALLINT NOT NULL DEFAULT 24,
  posts_scrape_interval_hrs SMALLINT NOT NULL DEFAULT 6,
  last_info_scrape_at  TIMESTAMPTZ,
  last_posts_scrape_at TIMESTAMPTZ,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT
);
```

### New columns on `facebook_groups`

```sql
ALTER TABLE scraper.facebook_groups
  ADD COLUMN IF NOT EXISTS posting_frequency_7d REAL,      -- avg posts/day over last 7 days
  ADD COLUMN IF NOT EXISTS avg_reactions_per_post REAL,
  ADD COLUMN IF NOT EXISTS avg_comments_per_post REAL,
  ADD COLUMN IF NOT EXISTS engagement_rate REAL,           -- (reactions+comments+shares) / member_count
  ADD COLUMN IF NOT EXISTS vitality_score SMALLINT;        -- 0-100 composite
```

### New table: `facebook_group_post_metrics_history`

Stores time-series of post counts per group per scrape, for trend analysis:

```sql
CREATE TABLE scraper.facebook_group_post_metrics_history (
  id            BIGSERIAL PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  post_count    INT NOT NULL DEFAULT 0,       -- total posts seen for this group at snapshot time
  posts_with_reactions INT NOT NULL DEFAULT 0,
  posts_with_comments  INT NOT NULL DEFAULT 0,
  avg_reactions  REAL,
  avg_comments   REAL,
  avg_shares     REAL
);
```

### New views

```sql
-- Group vitality dashboard
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

-- Top posts by engagement (last 7 days)
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
  AND p.is_active IS NOT false
ORDER BY total_engagement DESC
LIMIT 100;

-- Groups needing scrape (for orchestrator)
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

-- Groups needing info scrape
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
```

## File Map (new files)

```
db/migrations/013_group_registry.sql                -- registry table + metrics_history + new columns + views
scripts/group_monitor.sh                            -- main orchestration script (bash)
scripts/compute_group_vitality.py                   -- vitality scoring script (Python + SQL)
scripts/seed_groups.py                              -- seed the 8 initial groups into registry
src/cli/scrape_group_monitor.ts                     -- TypeScript orchestrator (alternative to bash)
```

## Implementation Tasks

### Task 1: Schema migration (013_group_registry.sql)
- Create `facebook_group_registry` table
- Add vitality columns to `facebook_groups`
- Create `facebook_group_post_metrics_history` table
- Create all views
- Add CHECK constraint for `scrape_runs.surface` to include `group_registry` if needed

### Task 2: Seed script (scripts/seed_groups.py)
- Connect to DB using credentials from /root/codebase/sm-auto/.env
- Insert the 8 groups into `facebook_group_registry`
- Set priorities: crypto groups → priority 3, others → priority 5
- Run group_info scrape for each to populate group_id and name

### Task 3: Orchestration script (scripts/group_monitor.sh)
Main entry point. Phases:
1. **Info phase** — query `v_groups_needing_info_scrape`, run `scrape_group_info` for each
2. **Posts phase** — query `v_groups_needing_posts_scrape`, run `scrape_group_posts` for each
3. **Detail phase** — run `scrape_group_post_details --limit N` to crawl uncrawled posts
4. **Vitality phase** — run `compute_group_vitality.py` to update scores

Key design:
- Each phase runs sequentially within the script
- Groups are processed one at a time (single Chrome instance)
- Humanized delays between groups (3-8 sec random)
- Longer pause every 5-8 groups (30-60 sec)
- On completion, update `last_info_scrape_at` / `last_posts_scrape_at` in registry
- Lock file per phase to prevent concurrent runs
- Exit cleanly on SIGTERM/SIGINT

### Task 4: Vitality scoring (scripts/compute_group_vitality.py)
Scoring formula (0-100):
- 30 pts: posting frequency (0 posts/day=0, 10+=30, linear)
- 25 pts: engagement rate ((avg reactions+comments+shares) / member_count * 1000, capped at 25)
- 20 pts: comment density (avg comments per post, 0=0, 20+=20)
- 15 pts: member count (100=0, 100K+=15, log scale)
- 10 pts: organic conversation indicator (posts with 5+ comments / total posts, ratio * 10)

Also computes and updates: posting_frequency_7d, avg_reactions_per_post, avg_comments_per_post, engagement_rate on facebook_groups.

Snapshots current metrics into facebook_group_post_metrics_history.

### Task 5: Cron configuration
```
# Group monitoring pipeline — every 6 hours
0 */6 * * * /root/codebase/sm-auto/scripts/group_monitor.sh >> /root/codebase/sm-auto/output/logs/group_monitor.log 2>&1
```

Single cron entry. The script handles all three phases internally. The 6h interval matches the default posts_scrape_interval_hrs. Info scrape interval is 24h so it runs every 4th cycle.

### Task 6: Post-detail continuous crawl (separate cron)
```
# Detail crawl — every 4 hours, process up to 20 posts per run
0 */4 * * * cd /root/codebase/sm-auto && bun run src/cli/scrape_group_post_details.ts --limit 20 >> output/logs/group_detail_crawl.log 2>&1
```

This runs independently. The queue repository selects posts that haven't been detail-crawled, ordered by most recent first.

### Task 7: First full run
- Seed the 8 groups
- Run group_info for all 8
- Run group_posts for all 8
- Compute vitality scores
- Validate data in DB

## Group URLs for Seeding

```sql
INSERT INTO scraper.facebook_group_registry (group_url, priority, notes) VALUES
('https://www.facebook.com/groups/growingbullscommunity', 3, 'Crypto community'),
('https://www.facebook.com/groups/963934784182695', 3, 'Crypto group'),
('https://www.facebook.com/YTCryptodada', 3, 'Crypto YT community page'),
('https://www.facebook.com/groups/963612522046155/', 3, 'Crypto group'),
('https://www.facebook.com/groups/cryptocommuniity/', 3, 'Crypto community'),
('https://www.facebook.com/groups/1163744920338154/', 5, 'General group'),
('https://www.facebook.com/groups/117843491401430/', 5, 'General group'),
('https://www.facebook.com/groups/220173140445218/', 5, 'General group');
```

Note: `/YTCryptodada` is a Page, not a Group. The group_info extractor may need to handle this — or we flag it and skip if it fails.

## Execution Flow

```
group_monitor.sh (every 6h)
├── Phase 1: INFO SCRAPE
│   ├── psql → SELECT from v_groups_needing_info_scrape
│   ├── For each group:
│   │   ├── bun run scrape_group_info.ts --url <GROUP_URL>
│   │   ├── psql → UPDATE last_info_scrape_at
│   │   └── sleep 3-8s (humanized)
│   └── psql → update group_id in registry from facebook_groups
│
├── Phase 2: POSTS SCRAPE
│   ├── psql → SELECT from v_groups_needing_posts_scrape
│   ├── For each group:
│   │   ├── bun run scrape_group_posts.ts --url <GROUP_URL>
│   │   ├── psql → UPDATE last_posts_scrape_at
│   │   └── sleep 3-8s (humanized)
│   └── psql → snapshot into metrics_history
│
├── Phase 3: DETAIL CRAWL
│   └── bun run scrape_group_post_details.ts --limit 30
│
└── Phase 4: VITALITY COMPUTE
    └── python3 compute_group_vitality.py
```
