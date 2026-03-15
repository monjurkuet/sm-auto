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
npm run db:prepare
```

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
- `--max-scrolls 8`
- `--scroll-delay-ms 2000`

## Output

By default, output files are written under `./output` unless you override `--output-dir`.
