-- Fix v_latest_page_posts to source from facebook_post_scrapes
-- instead of facebook_page_scrapes (which does not have post_record_id).

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
