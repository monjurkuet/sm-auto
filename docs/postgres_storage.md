**Goal**
Persist scraper results into PostgreSQL in a way that supports:
- repeat scrapes over time
- deduped durable entities
- contextual snapshots for searches and route/query metadata
- compact artifact persistence without forcing giant raw network blobs into the database

**Environment**
Use environment variables, with localhost Postgres and no password by default:

```bash
DATABASE_URL=postgresql://agent0@127.0.0.1:5432/facebook_scraper
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=facebook_scraper
PGUSER=agent0
PGPASSWORD=
PGSSLMODE=disable
```

Example file: [/.env.example](/root/codebase/sm-auto/.env.example)

**Design**
The schema is split into three layers.

1. `scrape_runs` and `scrape_artifacts`
- audit every execution
- store input parameters, summary output, and compact artifacts
- keep failures and retries visible

2. Durable entities
- `facebook_pages`
- `facebook_posts`
- `marketplace_sellers`
- `marketplace_listings`

These hold the latest known state plus `first_seen_at`, `last_seen_at`, and `last_scraped_at`.

3. Snapshot/context tables
- `facebook_page_scrapes`
- `facebook_post_scrapes`
- `marketplace_search_scrapes`
- `marketplace_search_results`
- `marketplace_listing_scrapes`
- `marketplace_seller_scrapes`
- `marketplace_seller_scrape_listings`

These preserve what was seen in a specific scrape, including route/query context and search ranking.

**Why This Split**
A listing or seller is a durable entity.
A search result, seller profile inventory, or page-post metric observation is a time-bound snapshot.
If those are mixed into one table, either dedupe becomes wrong or history becomes lossy.

**Key Upsert Rules**
1. `facebook_pages`
- key: `page_id`
- update latest scalar fields and `latest_payload`
- contact values go into `facebook_page_contacts`

2. `facebook_posts`
- prefer `external_post_id`
- fallback to `story_id`
- fallback to `permalink`
- metrics belong in `facebook_post_scrapes`, not the entity row, because they change over time

3. `marketplace_sellers`
- key: `seller_id`
- update latest seller profile data

4. `marketplace_listings`
- key: `listing_id`
- update latest title, description, seller, price, location, and payload
- images and delivery options live in child tables

5. `marketplace_search_results`
- key: `(scrape_run_id, position)`
- this preserves ranking exactly as seen in that search

6. `marketplace_listing_scrapes` and `marketplace_seller_scrapes`
- one row per scrape run
- keep route/query metadata here because it is scrape-context, not entity identity

**What Goes Into `latest_payload` or `raw_result`**
Store the normalized JSON output that the scraper already emits.
Do not store full raw GraphQL bodies by default.
If you need raw transport retention later, prefer:
- filesystem artifact path references in `scrape_artifacts`, or
- a dedicated cold-storage table with compression and retention policy

**Recommended Ingestion Flow**
For every scraper command:

1. create `scrape_runs` row with `status = running`
2. execute scrape
3. upsert durable entities
4. insert surface-specific snapshot rows
5. insert compact artifacts into `scrape_artifacts`
6. update `scrape_runs.status = completed` and set `completed_at`

On failure:
- insert the `scrape_runs` row first
- write `error_message`
- set `status = failed`

**Current Mapping**
1. `scrape_page_info.ts`
- `scrape_runs`
- `facebook_pages`
- `facebook_page_contacts`
- `facebook_page_scrapes`
- `facebook_page_transparency_history`

2. `scrape_page_posts.ts`
- `scrape_runs`
- `facebook_posts`
- `facebook_post_scrapes`
- `facebook_post_tags`
- `facebook_post_media`

3. `scrape_marketplace_search.ts`
- `scrape_runs`
- `marketplace_sellers`
- `marketplace_listings`
- `marketplace_search_scrapes`
- `marketplace_search_results`

4. `scrape_marketplace_listing.ts`
- `scrape_runs`
- `marketplace_sellers`
- `marketplace_listings`
- `marketplace_listing_images`
- `marketplace_listing_delivery_options`
- `marketplace_listing_scrapes`

5. `scrape_marketplace_seller.ts`
- `scrape_runs`
- `marketplace_sellers`
- `marketplace_listings`
- `marketplace_seller_scrapes`
- `marketplace_seller_scrape_listings`

**Tradeoffs**
- Arrays like hashtags and media are normalized into child tables because they need querying and dedupe.
- Route/query context is stored in snapshot tables because it reflects how the page was reached, not what the entity is.
- JSONB remains in the schema, but only for normalized results and compact artifacts, not as the primary storage model.

**Next Implementation Step**
Build a `src/storage/postgres/` layer with:
- env-backed connection factory
- one repository per surface or entity group
- transaction wrapper per scrape run
- idempotent upsert helpers

**Schema File**
Initial migration: [001_initial_schema.sql](/root/codebase/sm-auto/db/migrations/001_initial_schema.sql)
