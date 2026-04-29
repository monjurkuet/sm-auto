# Running The Scraper

## Requirements

- Bun installed
- Google Chrome installed
- PostgreSQL available if you want DB persistence

## 1. Start Chrome With Remote Debugging

The scraper attaches to an already running Chrome on port `9222`.

Example:

```bash
google-chrome --user-data-dir=/root/.config/google-chrome/Profile\ 2 --remote-debugging-port=9222 --no-sandbox --remote-allow-origins=*
```

## 2. Move Into The Project

```bash
cd /root/codebase/sm-auto
```

## 3. Optional: Enable Postgres Persistence

If you want scrape results persisted to Postgres:

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Prepare the database:

```bash
bun run db:prepare
```

Marketplace persistence records scraper-observed timestamps alongside the run metadata, so search results, seller inventory rows, and listing/seller scrapes can be traced back to the scrape moment instead of only the run completion time.

If you do not want DB persistence yet, use `--persist-db=false` in the scraper commands below.

## 4. Run A Scraper

### Facebook Page Info

```bash
bun run src/cli/scrape_page_info.ts --url "https://www.facebook.com/<page>" --persist-db=false
```

### Facebook Page Posts

```bash
bun run src/cli/scrape_page_posts.ts --url "https://www.facebook.com/<page>" --persist-db=false
```

### Marketplace Search

```bash
bun run src/cli/scrape_marketplace_search.ts --query "iphone" --location "Dhaka" --persist-db=false
```

### Marketplace Listing

```bash
bun run src/cli/scrape_marketplace_listing.ts --listing-id 1244539514326495 --persist-db=false
```

### Marketplace Seller

```bash
bun run src/cli/scrape_marketplace_seller.ts --seller-id <seller-id> --persist-db=false
```

### Marketplace Bulk Listing Crawl

```bash
bun run src/cli/scrape_marketplace_listings.ts --source-query "iphone" --source-location "Dhaka" --uncrawled-only
```

### Marketplace Bulk Seller Crawl

```bash
bun run src/cli/scrape_marketplace_sellers.ts --source-query "iphone" --source-location "Dhaka" --uncrawled-only
```

### Marketplace Bulk Crawl Options

- `--uncrawled-only` crawl only uncrawled entities
- `--source-query <query>` limit to entities discovered by a specific search query
- `--source-location <location>` limit to entities discovered by a specific search location
- `--limit <n>` maximum entities to scrape in one run
- `--offset <n>` skip the first `n` matching IDs
- `--batch-size <n>` paging size for queue selection
- `--dry-run` print candidate IDs without scraping them
- `--continue-on-error` keep going if a single entity scrape fails
- `--delay-mode <fixed|humanized|off>` pacing mode for bulk crawls; default is `humanized`
- `--delay-ms <n>` base delay used by fixed mode and as the humanized baseline; default `2500`
- `--delay-jitter-ms <n>` random extra delay added in humanized mode; default `1500`
- `--pause-every-min <n>` minimum entities between longer pauses; default `4`
- `--pause-every-max <n>` maximum entities between longer pauses; default `9`
- `--pause-min-ms <n>` minimum burst pause; default `8000`
- `--pause-max-ms <n>` maximum burst pause; default `25000`
- `--error-delay-multiplier <n>` increase the next delay after a failure; default `1.75`
- `--seed <n>` optional deterministic seed for reproducible pacing
- `--require-listing-history` seller bulk only: limit to sellers that also appear in listing history

Bulk crawlers write one JSON summary file per run under `--output-dir`, using:

- `marketplace_listings_bulk.json`
- `marketplace_sellers_bulk.json`

## 5. Run The Smoke Flow

This runs page info, page posts, marketplace search, marketplace listing, and marketplace seller in sequence.

```bash
bun run src/cli/smoke.ts \
  --page-url "https://www.facebook.com/<page>" \
  --query "iphone" \
  --location "Dhaka"
```

## Shared CLI Options

These options are available across the scraper CLIs:

- `--chrome-port 9222`
- `--output-dir ./output`
- `--include-artifacts`
- `--persist-db=false`
- `--timeout-ms 90000`
- `--max-scrolls 200`
- `--scroll-delay-ms 800`

## Output

By default, output files are written under `./output` unless you override `--output-dir`.

## Marketplace Timestamp Semantics

Marketplace outputs and database tables now distinguish between:

- `scrapedAt`: when the extractor captured the Marketplace surface
- `scrape_runs.started_at` / `scrape_runs.completed_at`: orchestration timing in the database
- `marketplace_*_scrapes.scraped_at`: when the Marketplace surface payload was observed
- `marketplace_search_results.observed_at`: when a search result row was seen in the feed
- `marketplace_seller_scrape_listings.observed_at`: when a seller inventory listing was seen
- `marketplace_listings.last_scraped_at` / `marketplace_sellers.last_scraped_at`: latest known scrape timestamp for durable entities

Use `--persist-db=false` if you only want JSON output and no DB writes.
