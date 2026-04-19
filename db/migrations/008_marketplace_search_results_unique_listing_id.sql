-- Repair and enforce unique marketplace search results by listing_id.

DELETE FROM scraper.marketplace_search_results
WHERE listing_id IS NULL;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY listing_id
      ORDER BY observed_at DESC, id DESC
    ) AS rn
  FROM scraper.marketplace_search_results
)
DELETE FROM scraper.marketplace_search_results msr
USING ranked r
WHERE msr.id = r.id
  AND r.rn > 1;

ALTER TABLE scraper.marketplace_search_results
  DROP CONSTRAINT IF EXISTS marketplace_search_results_unique;

ALTER TABLE scraper.marketplace_search_results
  ALTER COLUMN listing_id SET NOT NULL;

ALTER TABLE scraper.marketplace_search_results
  ADD CONSTRAINT marketplace_search_results_listing_id_unique UNIQUE (listing_id);
