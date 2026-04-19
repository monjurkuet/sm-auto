-- Add explicit Marketplace scrape and observation timestamps.

ALTER TABLE scraper.marketplace_search_scrapes
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz;

ALTER TABLE scraper.marketplace_listing_scrapes
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz;

ALTER TABLE scraper.marketplace_seller_scrapes
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz;

ALTER TABLE scraper.marketplace_search_results
  ADD COLUMN IF NOT EXISTS observed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE scraper.marketplace_seller_scrape_listings
  ADD COLUMN IF NOT EXISTS observed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE scraper.marketplace_listing_images
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE scraper.marketplace_listing_images
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE scraper.marketplace_listing_delivery_options
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE scraper.marketplace_listing_delivery_options
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

UPDATE scraper.marketplace_search_scrapes mss
SET scraped_at = sr.completed_at
FROM scraper.scrape_runs sr
WHERE sr.id = mss.scrape_run_id
  AND mss.scraped_at IS NULL;

UPDATE scraper.marketplace_listing_scrapes mls
SET scraped_at = sr.completed_at
FROM scraper.scrape_runs sr
WHERE sr.id = mls.scrape_run_id
  AND mls.scraped_at IS NULL;

UPDATE scraper.marketplace_seller_scrapes mss
SET scraped_at = sr.completed_at
FROM scraper.scrape_runs sr
WHERE sr.id = mss.scrape_run_id
  AND mss.scraped_at IS NULL;

ALTER TABLE scraper.marketplace_search_scrapes
  ALTER COLUMN scraped_at SET NOT NULL;

ALTER TABLE scraper.marketplace_listing_scrapes
  ALTER COLUMN scraped_at SET NOT NULL;

ALTER TABLE scraper.marketplace_seller_scrapes
  ALTER COLUMN scraped_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_search_results_observed_at_idx
  ON scraper.marketplace_search_results (observed_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_seller_scrape_listings_observed_at_idx
  ON scraper.marketplace_seller_scrape_listings (observed_at DESC);
