ALTER TABLE scraper.facebook_pages
  ADD COLUMN IF NOT EXISTS following integer,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS location_text text;

ALTER TABLE scraper.facebook_page_scrapes
  ADD COLUMN IF NOT EXISTS following integer,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS location_text text;

CREATE TABLE IF NOT EXISTS scraper.facebook_page_social_links (
  id bigserial PRIMARY KEY,
  page_id text NOT NULL REFERENCES scraper.facebook_pages(page_id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'tumblr', 'pinterest', 'youtube', 'x')),
  handle text NOT NULL,
  url text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT facebook_page_social_links_unique UNIQUE (page_id, platform, url)
);

CREATE INDEX IF NOT EXISTS facebook_page_social_links_page_id_idx
  ON scraper.facebook_page_social_links (page_id, platform);
