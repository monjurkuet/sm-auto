-- ── Group entity ──
CREATE TABLE scraper.facebook_groups (
  group_id         TEXT PRIMARY KEY,
  name             TEXT,
  vanity_slug      TEXT,
  privacy_type     TEXT,
  group_type       TEXT,
  member_count     INTEGER,
  description      TEXT,
  cover_photo_url  TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at  TIMESTAMPTZ,
  latest_payload   JSONB
);

-- ── Group admins/moderators ──
CREATE TABLE scraper.facebook_group_admins (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  user_id         TEXT NOT NULL,
  user_name       TEXT,
  admin_type      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- ── Group rules ──
CREATE TABLE scraper.facebook_group_rules (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  rule_text       TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group tags/topics ──
CREATE TABLE scraper.facebook_group_tags (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  tag_text        TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group info scrape snapshots ──
CREATE TABLE scraper.facebook_group_info_scrapes (
  id              BIGSERIAL PRIMARY KEY,
  scrape_run_id   UUID NOT NULL REFERENCES scraper.scrape_runs(id),
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group posts ──
CREATE TABLE scraper.facebook_group_posts (
  post_id         TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  author_id       TEXT,
  author_name     TEXT,
  permalink       TEXT,
  created_at      TIMESTAMPTZ,
  text_content    TEXT,
  has_attachments BOOLEAN,
  attachment_type TEXT,
  is_approved     BOOLEAN,
  reaction_count  INTEGER,
  comment_count   INTEGER,
  share_count     INTEGER,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at TIMESTAMPTZ,
  latest_payload  JSONB
);

-- ── Group post media ──
CREATE TABLE scraper.facebook_group_post_media (
  id              BIGSERIAL PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES scraper.facebook_group_posts(post_id),
  media_type      TEXT NOT NULL,
  media_id        TEXT,
  media_url       TEXT,
  width           INTEGER,
  height          INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group post scrape snapshots ──
CREATE TABLE scraper.facebook_group_post_scrapes (
  id              BIGSERIAL PRIMARY KEY,
  scrape_run_id   UUID NOT NULL REFERENCES scraper.scrape_runs(id),
  post_id         TEXT NOT NULL REFERENCES scraper.facebook_group_posts(post_id),
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Comments ──
CREATE TABLE scraper.facebook_group_post_comments (
  comment_id        TEXT PRIMARY KEY,
  post_id           TEXT NOT NULL REFERENCES scraper.facebook_group_posts(post_id),
  parent_comment_id TEXT REFERENCES scraper.facebook_group_post_comments(comment_id),
  author_id         TEXT,
  author_name       TEXT,
  text_content      TEXT,
  created_at        TIMESTAMPTZ,
  reaction_count    INTEGER,
  reply_count       INTEGER,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at   TIMESTAMPTZ,
  latest_payload    JSONB
);

-- ── Comment scrape snapshots ──
CREATE TABLE scraper.facebook_group_comment_scrapes (
  id              BIGSERIAL PRIMARY KEY,
  scrape_run_id   UUID NOT NULL REFERENCES scraper.scrape_runs(id),
  comment_id      TEXT NOT NULL REFERENCES scraper.facebook_group_post_comments(comment_id),
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX idx_group_posts_group ON scraper.facebook_group_posts(group_id);
CREATE INDEX idx_group_posts_created ON scraper.facebook_group_posts(created_at DESC);
CREATE INDEX idx_group_comments_post ON scraper.facebook_group_post_comments(post_id);
CREATE INDEX idx_group_comments_parent ON scraper.facebook_group_post_comments(parent_comment_id);
CREATE INDEX idx_group_admins_group ON scraper.facebook_group_admins(group_id);
CREATE INDEX idx_group_rules_group ON scraper.facebook_group_rules(group_id);
CREATE INDEX idx_group_info_scrapes_run ON scraper.facebook_group_info_scrapes(scrape_run_id);
CREATE INDEX idx_group_post_scrapes_run ON scraper.facebook_group_post_scrapes(scrape_run_id);
CREATE INDEX idx_group_comment_scrapes_run ON scraper.facebook_group_comment_scrapes(scrape_run_id);
