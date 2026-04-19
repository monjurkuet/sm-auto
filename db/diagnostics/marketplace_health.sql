-- Diagnostic SQL snippets for Marketplace scrape health and data quality

-- Latest run per surface with timing details
SELECT
  surface,
  id AS scrape_run_id,
  started_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - started_at))::numeric(10, 2) AS duration_sec
FROM scraper.scrape_runs
WHERE status = 'completed'
ORDER BY started_at DESC
LIMIT 20;

-- Stale Marketplace listings (not scraped in N days)
SELECT
  listing_id,
  title,
  last_scraped_at,
  NOW() - last_scraped_at AS stale_for
FROM scraper.marketplace_listings
WHERE last_scraped_at < NOW() - INTERVAL '7 days'
ORDER BY last_scraped_at ASC
LIMIT 50;

-- Search result freshness per query+location
SELECT
  mss.query,
  mss.location_text,
  mss.scraped_at,
  COUNT(msr.id) AS result_count,
  MAX(msr.observed_at) AS latest_observation
FROM scraper.marketplace_search_scrapes mss
JOIN scraper.marketplace_search_results msr ON msr.scrape_run_id = mss.scrape_run_id
GROUP BY mss.query, mss.location_text, mss.scraped_at
ORDER BY mss.scraped_at DESC
LIMIT 20;

-- Seller inventory churn (listings added/removed between consecutive scrapes)
WITH consecutive_scrapes AS (
  SELECT
    mss.seller_id,
    mss.scrape_run_id,
    mss.scraped_at,
    LAG(mss.scrape_run_id) OVER (PARTITION BY mss.seller_id ORDER BY mss.scraped_at) AS prev_run_id
  FROM scraper.marketplace_seller_scrapes mss
  JOIN scraper.scrape_runs sr ON sr.id = mss.scrape_run_id AND sr.status = 'completed'
),
current_listings AS (
  SELECT scrape_run_id, listing_id FROM scraper.marketplace_seller_scrape_listings
),
churn AS (
  SELECT
    cs.seller_id,
    cs.scraped_at,
    COUNT(DISTINCT cur.listing_id) FILTER (WHERE prev.listing_id IS NULL) AS added,
    COUNT(DISTINCT prev.listing_id) FILTER (WHERE cur.listing_id IS NULL) AS removed
  FROM consecutive_scrapes cs
  LEFT JOIN current_listings cur ON cur.scrape_run_id = cs.scrape_run_id
  LEFT JOIN current_listings prev ON prev.scrape_run_id = cs.prev_run_id
    AND prev.listing_id = cur.listing_id
  GROUP BY cs.seller_id, cs.scraped_at
)
SELECT * FROM churn WHERE added > 0 OR removed > 0
ORDER BY cs_scraped_at DESC
LIMIT 50;

-- Inactive image/delivery option audit
SELECT
  'images' AS child_type,
  COUNT(*) FILTER (WHERE is_active) AS active,
  COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
  MIN(first_seen_at) AS earliest_seen,
  MAX(last_seen_at) AS latest_seen
FROM scraper.marketplace_listing_images

UNION ALL

SELECT
  'delivery_options' AS child_type,
  COUNT(*) FILTER (WHERE is_active) AS active,
  COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
  MIN(first_seen_at) AS earliest_seen,
  MAX(last_seen_at) AS latest_seen
FROM scraper.marketplace_listing_delivery_options;

-- Listings with deactivated images (potential delisted or changed items)
SELECT
  mli.listing_id,
  mli.title,
  COUNT(*) FILTER (WHERE mli_img.is_active) AS active_images,
  COUNT(*) FILTER (WHERE NOT mli_img.is_active) AS inactive_images,
  MAX(mli_img.last_seen_at) AS last_image_seen
FROM scraper.marketplace_listings mli
JOIN scraper.marketplace_listing_images mli_img ON mli_img.listing_id = mli.listing_id
WHERE NOT mli_img.is_active
GROUP BY mli.listing_id, mli.title
ORDER BY inactive_images DESC
LIMIT 50;

-- Scrape timestamp anomaly check (scraped_at far from completed_at)
SELECT
  sr.id AS scrape_run_id,
  sr.surface,
  sr.started_at,
  sr.completed_at,
  mss.scraped_at,
  EXTRACT(EPOCH FROM (mss.scraped_at - sr.started_at))::numeric(10, 2) AS scrape_lag_sec
FROM scraper.scrape_runs sr
JOIN scraper.marketplace_search_scrapes mss ON mss.scrape_run_id = sr.id
WHERE ABS(EXTRACT(EPOCH FROM (mss.scraped_at - sr.started_at))) > 300
ORDER BY sr.completed_at DESC
LIMIT 20;
