CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS scraper;

CREATE TABLE scraper.scrape_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text NOT NULL CHECK (
    surface IN (
      'page_info',
      'page_posts',
      'marketplace_search',
      'marketplace_listing',
      'marketplace_seller'
    )
  ),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('running', 'completed', 'failed')),
  entity_external_id text,
  source_url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  schema_version text NOT NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scrape_runs_surface_started_at_idx ON scraper.scrape_runs (surface, started_at DESC);
CREATE INDEX scrape_runs_entity_external_id_idx ON scraper.scrape_runs (entity_external_id);

CREATE TABLE scraper.scrape_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_run_id uuid NOT NULL REFERENCES scraper.scrape_runs(id) ON DELETE CASCADE,
  artifact_name text NOT NULL,
  artifact_format text NOT NULL CHECK (artifact_format IN ('json', 'text')),
  payload jsonb,
  payload_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scrape_artifacts_payload_presence_ck CHECK (
    payload IS NOT NULL OR payload_text IS NOT NULL
  ),
  CONSTRAINT scrape_artifacts_unique_name UNIQUE (scrape_run_id, artifact_name)
);

CREATE TABLE scraper.facebook_pages (
  page_id text PRIMARY KEY,
  canonical_url text NOT NULL,
  name text,
  category text,
  followers integer,
  creation_date_text text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scraped_at timestamptz,
  latest_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE scraper.facebook_page_contacts (
  id bigserial PRIMARY KEY,
  page_id text NOT NULL REFERENCES scraper.facebook_pages(page_id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('phone', 'email', 'website', 'address')),
  contact_value text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT facebook_page_contacts_unique UNIQUE (page_id, contact_type, contact_value)
);

CREATE INDEX facebook_page_contacts_page_id_idx ON scraper.facebook_page_contacts (page_id, contact_type);

CREATE TABLE scraper.facebook_page_scrapes (
  scrape_run_id uuid PRIMARY KEY REFERENCES scraper.scrape_runs(id) ON DELETE CASCADE,
  page_id text REFERENCES scraper.facebook_pages(page_id) ON DELETE SET NULL,
  page_url text NOT NULL,
  page_name text,
  category text,
  followers integer,
  creation_date_text text,
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE scraper.facebook_page_transparency_history (
  id bigserial PRIMARY KEY,
  scrape_run_id uuid NOT NULL REFERENCES scraper.facebook_page_scrapes(scrape_run_id) ON DELETE CASCADE,
  position integer NOT NULL,
  history_text text NOT NULL,
  CONSTRAINT facebook_page_transparency_history_unique UNIQUE (scrape_run_id, position)
);

CREATE TABLE scraper.facebook_posts (
  id bigserial PRIMARY KEY,
  external_post_id text,
  story_id text,
  permalink text,
  page_id text REFERENCES scraper.facebook_pages(page_id) ON DELETE SET NULL,
  author_id text,
  author_name text,
  created_at timestamptz,
  body_text text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scraped_at timestamptz,
  latest_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT facebook_posts_external_post_id_unique UNIQUE (external_post_id),
  CONSTRAINT facebook_posts_story_id_unique UNIQUE (story_id),
  CONSTRAINT facebook_posts_permalink_unique UNIQUE (permalink)
);

CREATE INDEX facebook_posts_page_id_created_at_idx ON scraper.facebook_posts (page_id, created_at DESC);

CREATE TABLE scraper.facebook_post_scrapes (
  id bigserial PRIMARY KEY,
  scrape_run_id uuid NOT NULL REFERENCES scraper.scrape_runs(id) ON DELETE CASCADE,
  post_record_id bigint NOT NULL REFERENCES scraper.facebook_posts(id) ON DELETE CASCADE,
  position integer,
  reactions integer,
  comments integer,
  shares integer,
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facebook_post_scrapes_unique UNIQUE (scrape_run_id, post_record_id)
);

CREATE INDEX facebook_post_scrapes_post_record_id_idx ON scraper.facebook_post_scrapes (post_record_id, observed_at DESC);

CREATE TABLE scraper.facebook_post_tags (
  id bigserial PRIMARY KEY,
  post_scrape_id bigint NOT NULL REFERENCES scraper.facebook_post_scrapes(id) ON DELETE CASCADE,
  tag_type text NOT NULL CHECK (tag_type IN ('hashtag', 'mention', 'link')),
  tag_value text NOT NULL,
  position integer,
  CONSTRAINT facebook_post_tags_unique UNIQUE (post_scrape_id, tag_type, tag_value, position)
);

CREATE TABLE scraper.facebook_post_media (
  id bigserial PRIMARY KEY,
  post_scrape_id bigint NOT NULL REFERENCES scraper.facebook_post_scrapes(id) ON DELETE CASCADE,
  position integer NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('photo', 'video')),
  media_external_id text,
  url text,
  width integer,
  height integer,
  duration_sec numeric(12, 3),
  CONSTRAINT facebook_post_media_unique UNIQUE (post_scrape_id, position)
);

CREATE TABLE scraper.marketplace_sellers (
  seller_id text PRIMARY KEY,
  name text,
  about text,
  rating numeric(6, 3),
  review_count integer,
  location_text text,
  member_since_text text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scraped_at timestamptz,
  latest_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE scraper.marketplace_listings (
  listing_id text PRIMARY KEY,
  canonical_url text,
  seller_id text REFERENCES scraper.marketplace_sellers(seller_id) ON DELETE SET NULL,
  title text,
  description text,
  price_amount numeric(18, 2),
  price_currency text,
  price_formatted text,
  city text,
  full_location text,
  coordinates jsonb,
  availability text,
  category_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_scraped_at timestamptz,
  latest_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX marketplace_listings_seller_id_idx ON scraper.marketplace_listings (seller_id);
CREATE INDEX marketplace_listings_category_id_idx ON scraper.marketplace_listings (category_id);
CREATE INDEX marketplace_listings_price_idx ON scraper.marketplace_listings (price_currency, price_amount);

CREATE TABLE scraper.marketplace_listing_images (
  id bigserial PRIMARY KEY,
  listing_id text NOT NULL REFERENCES scraper.marketplace_listings(listing_id) ON DELETE CASCADE,
  position integer NOT NULL,
  url text NOT NULL,
  width integer,
  height integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT marketplace_listing_images_unique UNIQUE (listing_id, position),
  CONSTRAINT marketplace_listing_images_url_unique UNIQUE (listing_id, url)
);

CREATE TABLE scraper.marketplace_listing_delivery_options (
  listing_id text NOT NULL REFERENCES scraper.marketplace_listings(listing_id) ON DELETE CASCADE,
  delivery_option text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (listing_id, delivery_option)
);

CREATE TABLE scraper.marketplace_search_scrapes (
  scrape_run_id uuid PRIMARY KEY REFERENCES scraper.scrape_runs(id) ON DELETE CASCADE,
  query text NOT NULL,
  location_text text NOT NULL,
  search_url text NOT NULL,
  buy_radius numeric(12, 3),
  buy_latitude numeric(12, 7),
  buy_longitude numeric(12, 7),
  buy_vanity_page_id text,
  scraped_at timestamptz NOT NULL,
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE scraper.marketplace_search_results (
  id bigserial PRIMARY KEY,
  scrape_run_id uuid NOT NULL REFERENCES scraper.marketplace_search_scrapes(scrape_run_id) ON DELETE CASCADE,
  position integer NOT NULL,
  listing_id text NOT NULL REFERENCES scraper.marketplace_listings(listing_id) ON DELETE SET NULL,
  seller_id text REFERENCES scraper.marketplace_sellers(seller_id) ON DELETE SET NULL,
  snapshot_title text,
  snapshot_price_amount numeric(18, 2),
  snapshot_price_currency text,
  snapshot_price_formatted text,
  snapshot_full_location text,
  snapshot_availability text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_search_results_unique UNIQUE (listing_id)
);

CREATE INDEX marketplace_search_results_listing_id_idx ON scraper.marketplace_search_results (listing_id);

CREATE TABLE scraper.marketplace_listing_scrapes (
  scrape_run_id uuid PRIMARY KEY REFERENCES scraper.scrape_runs(id) ON DELETE CASCADE,
  listing_id text REFERENCES scraper.marketplace_listings(listing_id) ON DELETE SET NULL,
  route_name text,
  route_location jsonb,
  buy_location jsonb,
  query_names text[] NOT NULL DEFAULT '{}'::text[],
  scraped_at timestamptz NOT NULL,
  target_id text,
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE scraper.marketplace_seller_scrapes (
  scrape_run_id uuid PRIMARY KEY REFERENCES scraper.scrape_runs(id) ON DELETE CASCADE,
  seller_id text REFERENCES scraper.marketplace_sellers(seller_id) ON DELETE SET NULL,
  route_name text,
  route_location jsonb,
  buy_location jsonb,
  query_names text[] NOT NULL DEFAULT '{}'::text[],
  scraped_at timestamptz NOT NULL,
  raw_result jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE scraper.marketplace_seller_scrape_listings (
  id bigserial PRIMARY KEY,
  scrape_run_id uuid NOT NULL REFERENCES scraper.marketplace_seller_scrapes(scrape_run_id) ON DELETE CASCADE,
  position integer NOT NULL,
  listing_id text REFERENCES scraper.marketplace_listings(listing_id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_seller_scrape_listings_unique UNIQUE (scrape_run_id, position)
);

CREATE INDEX marketplace_seller_scrape_listings_listing_id_idx ON scraper.marketplace_seller_scrape_listings (listing_id);
