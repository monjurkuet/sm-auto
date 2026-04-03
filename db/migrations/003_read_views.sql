-- Read-oriented SQL views for common query patterns
-- Migration: 003_read_views

-- Latest page info per Facebook page (most recent completed scrape)
CREATE OR REPLACE VIEW scraper.v_latest_page_info AS
SELECT
  fp.page_id,
  fp.canonical_url,
  fp.name,
  fp.category,
  fp.followers,
  fp.following,
  fp.bio,
  fp.location_text,
  fp.creation_date_text,
  fps.page_name,
  fps.followers AS scraped_followers,
  fps.bio AS scraped_bio,
  fps.location_text AS scraped_location,
  fps.raw_result,
  sr.completed_at AS last_scraped_at
FROM scraper.facebook_pages fp
LEFT JOIN LATERAL (
  SELECT *
  FROM scraper.facebook_page_scrapes fps
  WHERE fps.page_id = fp.page_id
  ORDER BY fps.scrape_run_id DESC
  LIMIT 1
) fps ON true
LEFT JOIN scraper.scrape_runs sr ON fps.scrape_run_id = sr.id AND sr.status = 'completed';

-- Latest posts per page (most recent completed scrape, ordered by position)
CREATE OR REPLACE VIEW scraper.v_latest_page_posts AS
WITH latest_page_post_runs AS (
  SELECT DISTINCT ON (sr.entity_external_id)
    sr.entity_external_id AS page_id,
    sr.id AS scrape_run_id,
    sr.completed_at
  FROM scraper.scrape_runs sr
  WHERE sr.surface = 'page_posts'
    AND sr.status = 'completed'
    AND sr.entity_external_id IS NOT NULL
  ORDER BY sr.entity_external_id, sr.completed_at DESC
)
SELECT
  lpr.page_id,
  fp.canonical_url,
  fp.name AS page_name,
  fps.post_record_id,
  fps.position,
  fps.reactions,
  fps.comments,
  fps.shares,
  fps.observed_at,
  fpr.external_post_id,
  fpr.story_id,
  fpr.permalink,
  fpr.author_id,
  fpr.author_name,
  fpr.created_at AS post_created_at,
  fpr.body_text,
  fps.raw_result,
  lpr.completed_at AS last_scraped_at
FROM latest_page_post_runs lpr
JOIN scraper.facebook_pages fp ON fp.page_id = lpr.page_id
JOIN scraper.facebook_post_scrapes fps ON fps.scrape_run_id = lpr.scrape_run_id
LEFT JOIN scraper.facebook_posts fpr ON fpr.id = fps.post_record_id;

-- Latest marketplace listing data per listing
CREATE OR REPLACE VIEW scraper.v_latest_listings AS
SELECT
  ml.listing_id,
  ml.canonical_url,
  ml.seller_id,
  ms.name AS seller_name,
  ms.rating AS seller_rating,
  ms.review_count AS seller_review_count,
  ml.title,
  ml.description,
  ml.price_amount,
  ml.price_currency,
  ml.price_formatted,
  ml.city,
  ml.full_location,
  ml.availability,
  ml.category_id,
  ml.last_scraped_at,
  ml.latest_payload,
  mls.raw_result AS scrape_raw_result,
  sr.completed_at AS last_scraped_completed_at
FROM scraper.marketplace_listings ml
LEFT JOIN scraper.marketplace_sellers ms ON ms.seller_id = ml.seller_id
LEFT JOIN LATERAL (
  SELECT *
  FROM scraper.marketplace_listing_scrapes mls
  WHERE mls.listing_id = ml.listing_id
  ORDER BY mls.scrape_run_id DESC
  LIMIT 1
) mls ON true
LEFT JOIN scraper.scrape_runs sr ON mls.scrape_run_id = sr.id AND sr.status = 'completed';

-- Seller inventory: current listings per seller from most recent scrape
CREATE OR REPLACE VIEW scraper.v_seller_inventory AS
SELECT
  ms.seller_id,
  ms.name AS seller_name,
  ms.rating,
  ms.review_count,
  ms.location_text AS seller_location,
  ms.member_since_text,
  mssl.listing_id,
  mssl.position AS listing_position,
  ml.title AS listing_title,
  ml.price_amount,
  ml.price_currency,
  ml.price_formatted,
  ml.city AS listing_city,
  ml.full_location AS listing_location,
  ml.availability AS listing_availability,
  mssl.completed_at AS last_scraped_at
FROM scraper.marketplace_sellers ms
LEFT JOIN LATERAL (
  SELECT mssl.*, sr.completed_at
  FROM scraper.marketplace_seller_scrape_listings mssl
  JOIN scraper.marketplace_seller_scrapes mss ON mss.scrape_run_id = mssl.scrape_run_id
  JOIN scraper.scrape_runs sr ON sr.id = mss.scrape_run_id
  WHERE mss.seller_id = ms.seller_id
    AND sr.status = 'completed'
  ORDER BY sr.completed_at DESC
  LIMIT 1
) mssl ON true
LEFT JOIN scraper.marketplace_listings ml ON ml.listing_id = mssl.listing_id;

-- Search result summaries: latest search runs with listing counts
CREATE OR REPLACE VIEW scraper.v_latest_searches AS
SELECT
  sr.id AS scrape_run_id,
  sr.completed_at,
  mss.query,
  mss.location_text,
  mss.search_url,
  mss.buy_radius,
  mss.buy_latitude,
  mss.buy_longitude,
  mss.buy_vanity_page_id,
  COUNT(msr.listing_id) AS listing_count,
  mss.raw_result
FROM scraper.scrape_runs sr
JOIN scraper.marketplace_search_scrapes mss ON mss.scrape_run_id = sr.id
LEFT JOIN scraper.marketplace_search_results msr ON msr.scrape_run_id = sr.id
WHERE sr.surface = 'marketplace_search'
  AND sr.status = 'completed'
GROUP BY sr.id, sr.completed_at, mss.query, mss.location_text, mss.search_url,
         mss.buy_radius, mss.buy_latitude, mss.buy_longitude, mss.buy_vanity_page_id, mss.raw_result;
