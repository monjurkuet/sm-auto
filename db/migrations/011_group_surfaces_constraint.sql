-- Add group surfaces to the scrape_runs check constraint
ALTER TABLE scraper.scrape_runs
  DROP CONSTRAINT scrape_runs_surface_check;

ALTER TABLE scraper.scrape_runs
  ADD CONSTRAINT scrape_runs_surface_check
  CHECK (surface IN (
    'page_info',
    'page_posts',
    'marketplace_search',
    'marketplace_listing',
    'marketplace_seller',
    'group_info',
    'group_posts',
    'group_post_detail'
  ));
