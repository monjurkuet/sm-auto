-- Fix v_seller_inventory to project completed_at from the lateral subquery
-- instead of referencing sr outside its scope.

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
