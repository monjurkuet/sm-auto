ALTER TABLE scraper.marketplace_listing_images
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE scraper.marketplace_listing_delivery_options
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE scraper.marketplace_listing_images SET is_active = true WHERE is_active IS NOT true;
UPDATE scraper.marketplace_listing_delivery_options SET is_active = true WHERE is_active IS NOT true;

CREATE INDEX IF NOT EXISTS marketplace_listing_images_active_idx
  ON scraper.marketplace_listing_images (listing_id, is_active);

CREATE INDEX IF NOT EXISTS marketplace_listing_delivery_options_active_idx
  ON scraper.marketplace_listing_delivery_options (listing_id, is_active);
