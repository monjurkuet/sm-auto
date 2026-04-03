# Crawl Pages Script

**File:** `scripts/crawl_pages.sh`

Automated crawler for Facebook page info and posts from tracked pages in the database.

## Overview

This script crawls Facebook pages that are already tracked in the PostgreSQL database. It can scrape:
- **Page Info** - Name, category, followers, bio, location, contact details, social media links
- **Page Posts** - Posts with reactions, comments, shares, media, hashtags, mentions

## Prerequisites

1. **PostgreSQL running** with the scraper database prepared:
   ```bash
   npm run db:prepare
   ```

2. **Chrome running** with remote debugging:
   ```bash
   google-chrome --user-data-dir=/root/.config/google-chrome/Profile\ 2 \
     --remote-debugging-port=9222 \
     --no-sandbox \
     --remote-allow-origins=*
   ```

3. **Logged into Facebook** in the Chrome instance (for authenticated content)

4. **Pages already tracked** - At least one page must exist in `scraper.facebook_pages` table

## Quick Start

```bash
# Crawl all tracked pages with defaults
./scripts/crawl_pages.sh

# Crawl first 5 pages only
./scripts/crawl_pages.sh --limit 5

# Crawl specific page by ID
./scripts/crawl_pages.sh --page-id 123456789

# Preview without scraping
./scripts/crawl_pages.sh --dry-run
```

## Usage

```bash
./scripts/crawl_pages.sh [OPTIONS]
```

## Options

### Target Selection

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--limit <n>` | number | 0 (all) | Limit to first N pages (0 = no limit) |
| `--page-id <id>` | string | - | Crawl specific page by database ID |
| `--url <url>` | string | - | Crawl specific page by URL or vanity |

### Scraper Controls

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--max-scrolls <n>` | number | 8 | Maximum scrolls per page scrape |
| `--scroll-delay-ms <ms>` | number | 2000 | Delay between scrolls in milliseconds |
| `--timeout-ms <ms>` | number | 90000 | Timeout per scrape operation in milliseconds |
| `--chrome-port <port>` | number | 9222 | Chrome DevTools debugging port |
| `--output-dir <dir>` | string | ./output/crawl | Directory for JSON output files |
| `--persist-db <bool>` | boolean | true | Persist results to PostgreSQL |
| `--include-artifacts` | flag | false | Include debug artifacts in output |

### Crawl Mode

| Option | Description |
|--------|-------------|
| `--page-info-only` | Crawl page info only (skip posts) |
| `--page-posts-only` | Crawl page posts only (skip info) |

### Utility

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be crawled without executing |
| `--verbose` | Enable debug logging |
| `--help, -h` | Show help message |

## Examples

### Basic Usage

```bash
# Crawl all tracked pages
./scripts/crawl_pages.sh

# Crawl with more thorough scrolling
./scripts/crawl_pages.sh --max-scrolls 15 --scroll-delay-ms 3000

# Crawl with longer timeout for slow pages
./scripts/crawl_pages.sh --timeout-ms 120000
```

### Targeted Crawling

```bash
# Crawl specific page by database ID
./scripts/crawl_pages.sh --page-id 100064688828733

# Crawl specific page by URL
./scripts/crawl_pages.sh --url "https://www.facebook.com/ryanscomputers"

# Crawl first 10 pages only
./scripts/crawl_pages.sh --limit 10

# Crawl pages not recently scraped (default behavior)
./scripts/crawl_pages.sh --limit 5
```

### Selective Scraping

```bash
# Page info only (faster, no post scraping)
./scripts/crawl_pages.sh --page-info-only

# Page posts only (skip page info)
./scripts/crawl_pages.sh --page-posts-only

# Both info and posts (default)
./scripts/crawl_pages.sh
```

### Debug and Testing

```bash
# Preview what would be crawled
./scripts/crawl_pages.sh --dry-run

# Preview with verbose output
./scripts/crawl_pages.sh --dry-run --verbose

# Crawl without database persistence
./scripts/crawl_pages.sh --persist-db=false

# Include debug artifacts
./scripts/crawl_pages.sh --include-artifacts
```

### Custom Configuration

```bash
# Custom Chrome port and output directory
./scripts/crawl_pages.sh --chrome-port 9223 --output-dir ./output/my-crawl

# Full custom configuration
./scripts/crawl_pages.sh \
  --limit 3 \
  --max-scrolls 12 \
  --scroll-delay-ms 2500 \
  --timeout-ms 100000 \
  --output-dir ./output/custom \
  --include-artifacts \
  --verbose
```

## Output Structure

### Default Output Layout

```
./output/crawl/
├── page_info/
│   ├── {page_id_1}/
│   │   └── page_info.json
│   └── {page_id_2}/
│       └── page_info.json
└── page_posts/
    ├── {page_id_1}/
    │   └── page_posts.json
    └── {page_id_2}/
        └── page_posts.json
```

### Output File Contents

**page_info.json** contains:
- `pageId` - Facebook page ID
- `name` - Page name
- `category` - Page category
- `followers` - Follower count
- `following` - Following count
- `bio` - Page bio/description
- `location` - Page location
- `contact` - Phone, email, website, address, social media links
- `transparency` - Creation date, history
- `scrapedAt` - Timestamp

**page_posts.json** contains:
- `pageId` - Facebook page ID
- `url` - Page URL
- `posts[]` - Array of posts with:
  - `id`, `postId`, `permalink`
  - `text`, `hashtags`, `mentions`, `links`
  - `media[]` - Photos and videos
  - `metrics` - Reactions, comments, shares
  - `author` - Post author info
- `scrapedAt` - Timestamp

## Page Selection Logic

### Default Behavior (No Filters)

Pages are ordered by `last_scraped_at ASC NULLS FIRST`:
1. Pages never scraped come first
2. Pages scraped longest ago come next
3. Recently scraped pages come last

### With `--limit`

Limits the number of pages processed, respecting the ordering above.

### With `--page-id`

Only the specified page is crawled (must exist in database).

### With `--url`

Matches pages where `canonical_url` equals or contains the provided URL/vanity.

## Database Updates

When `--persist-db=true` (default), the script updates:

| Table | Action |
|-------|--------|
| `scraper.scrape_runs` | New run record per scrape |
| `scraper.facebook_pages` | Upsert page data |
| `scraper.facebook_page_contacts` | Upsert contact info |
| `scraper.facebook_page_social_links` | Upsert social links |
| `scraper.facebook_page_scrapes` | Insert scrape snapshot |
| `scraper.facebook_page_transparency_history` | Insert history |
| `scraper.facebook_posts` | Upsert post records |
| `scraper.facebook_post_scrapes` | Insert post metrics |
| `scraper.facebook_post_tags` | Insert hashtags/mentions |
| `scraper.facebook_post_media` | Insert media attachments |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (missing psql, DB connection failed, no pages found, unknown option) |

## Troubleshooting

### "psql is not installed"

Install PostgreSQL client:
```bash
# Debian/Ubuntu
apt-get install postgresql-client

# RHEL/CentOS
yum install postgresql
```

### "Cannot connect to PostgreSQL"

1. Check PostgreSQL is running:
   ```bash
   pg_isready -h 127.0.0.1 -p 5432
   ```

2. Verify environment variables in `.env`:
   ```bash
   cat .env
   ```

3. Test connection manually:
   ```bash
   psql -h 127.0.0.1 -U agent0 -d facebook_scraper -c "SELECT 1"
   ```

### "No tracked pages found"

Run a page scraper first to populate the database:
```bash
bun run src/cli/scrape_page_info.ts --url "https://www.facebook.com/<page>"
```

### "Chrome not reachable"

1. Start Chrome with remote debugging:
   ```bash
   google-chrome --user-data-dir=/root/.config/google-chrome/Profile\ 2 \
     --remote-debugging-port=9222 \
     --no-sandbox \
     --remote-allow-origins=*
   ```

2. Verify Chrome is listening:
   ```bash
   curl http://localhost:9222/json/version
   ```

### Scrape timeouts

Increase timeout and scroll parameters:
```bash
./scripts/crawl_pages.sh --timeout-ms 120000 --max-scrolls 15
```

## Related Scripts

| Script | Description |
|--------|-------------|
| `scripts/list_pages.sh` | List all tracked pages in database |
| `scripts/crawl_pages.sh` | Crawl page info and posts (this script) |

## Related Documentation

| Document | Description |
|----------|-------------|
| `docs/run_scraper.md` | Individual scraper CLI documentation |
| `docs/postgres_storage.md` | Database schema and persistence |
| `docs/output_schemas.md` | Output file formats |
