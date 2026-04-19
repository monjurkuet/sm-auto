# Facebook Scraper Platform - Project Context

## Project Overview

This is a **modular Facebook scraper platform** built with TypeScript and Bun. It attaches to an already-running Chrome instance (via remote debugging on port 9222) to scrape data from Facebook surfaces without managing Chrome directly.

### Purpose
- Scrape Facebook page information and posts
- Scrape Facebook Marketplace listings, search results, and seller data
- Persist scraped data to PostgreSQL or export as JSON files

### Tech Stack
- **Runtime**: Bun
- **Language**: TypeScript (ES2020, CommonJS)
- **Browser Automation**: Puppeteer-core (Chrome DevTools attachment)
- **Database**: PostgreSQL with `pg` driver
- **CLI**: yargs
- **Linting**: ESLint + Prettier

## Architecture

The codebase follows a layered architecture:

```
src/
├── browser/          # Chrome DevTools attachment, tab/page lifecycle
├── capture/          # GraphQL response capture and request metadata parsing
│   └── route_definition_capture.ts  # Captures /ajax/bulk-route-definitions/
├── extractors/       # Surface-specific scraping flows (navigation + collection)
├── parsers/          # Pure DOM, GraphQL, and embedded parsing functions
│   ├── dom/          # DOM-based extraction (page, post, marketplace)
│   ├── graphql/      # GraphQL response parsing
│   └── embedded/     # ScheduledServerJS/RelayPrefetchedStreamCache payloads
├── normalizers/      # Merge partial data into stable result contracts
├── storage/          # JSON output writing and PostgreSQL persistence
│   ├── postgres/     # PostgreSQL repositories and persistence layer
│   └── schema_versions.ts  # Schema version tracking
├── routes/           # Facebook route definitions
├── types/            # TypeScript contracts (contracts.ts) and schema versions
├── cli/              # Runnable CLI entrypoints
└── core/             # Shared scraper context, job runner, logger
```

### Key Design Rule
GraphQL capture is shared infrastructure. Surface-specific assumptions belong in parsers and extractors, **not** in the transport layer.

### Marketplace Transport Pattern
Marketplace data often arrives via:
1. Embedded `script[type="application/json"][data-sjs]` blocks (ScheduledServerJS)
2. `RelayPrefetchedStreamCache` payloads in HTML
3. `/ajax/bulk-route-definitions/` responses for route/query context
4. DOM as fallback (not primary)

See: [`docs/marketplace_transport_findings.md`](docs/marketplace_transport_findings.md)

## Building and Running

### Prerequisites
- Bun installed
- Google Chrome installed
- PostgreSQL (optional, for persistence)

### Install Dependencies
```bash
bun install
```

### Build / Type Check
```bash
bun run build        # Compile TypeScript to dist/
bun run typecheck    # Type check without emitting
```

### Lint / Format
```bash
bun run lint         # ESLint
bun run format       # Prettier
bun run validate     # Full validation: format + typecheck + lint + test
```

### Run Tests
```bash
bun test tests/*.test.ts
```

### Database Setup (Optional)
```bash
# Copy and configure environment
cp .env.example .env

# Run migrations
npm run db:prepare
```

### Run Scrapers

All scrapers support these common options:
- `--chrome-port 9222`
- `--output-dir ./output`
- `--include-artifacts`
- `--persist-db=false`
- `--timeout-ms 90000`
- `--max-scrolls 8`
- `--scroll-delay-ms 2000`

#### Facebook Page Info
```bash
bun run src/cli/scrape_page_info.ts --url "https://www.facebook.com/<page>"
```

#### Facebook Page Posts
```bash
bun run src/cli/scrape_page_posts.ts --url "https://www.facebook.com/<page>"
```

#### Marketplace Search
```bash
bun run src/cli/scrape_marketplace_search.ts --query "iphone" --location "Dhaka"
```

#### Marketplace Listing
```bash
bun run src/cli/scrape_marketplace_listing.ts --listing-id 1234567890
```

#### Marketplace Seller
```bash
bun run src/cli/scrape_marketplace_seller.ts --seller-id <seller-id>
```

#### Full Smoke Test
```bash
bun run src/cli/smoke.ts \
  --page-url "https://www.facebook.com/<page>" \
  --query "iphone" \
  --location "Dhaka"
```

### Start Chrome (Required)
```bash
google-chrome --user-data-dir=/root/.config/google-chrome/Profile\ 2 \
  --remote-debugging-port=9222 \
  --no-sandbox \
  --remote-allow-origins=*
```

## Development Conventions

### Code Style
- **Indentation**: 2 spaces
- **Quotes**: Single quotes
- **Semicolons**: Required
- **Line length**: 120 characters
- **Trailing commas**: None
- **Arrow function parens**: Always

### Testing Practices
- Tests live in `tests/*.test.ts`
- Run with `bun test`
- Fixtures for DOM snapshots in `fixtures/dom/`
- Fixtures for GraphQL responses in `fixtures/graphql/`

### Output Schemas
All scrapers produce typed results defined in `src/types/contracts.ts` and versioned in `src/storage/schema_versions.ts`:

| Surface | Schema Version | Output File |
|---------|---------------|-------------|
| Page Info | 0.2.0 | `page_info.json` |
| Page Posts | 0.2.0 | `page_posts.json` |
| Marketplace Search | 0.1.0 | `marketplace_search.json` |
| Marketplace Listing | 0.1.0 | `marketplace_listing.json` |
| Marketplace Seller | 0.1.0 | `marketplace_seller.json` |

Key types:
- `PageInfoResult` - Page info, contact details, transparency data, social media links
- `PagePostsResult` - Posts with reactions, comments, shares, media, hashtags, mentions
- `MarketplaceSearchResult` - Search results with location context and ranking
- `MarketplaceListingResult` - Individual listing details with price, seller, images
- `MarketplaceSellerResult` - Seller profile with inventory listings

### Database Schema
PostgreSQL schema is versioned in `db/migrations/`:

**Core tables:**
- `scraper.scrape_runs` - Track all scrape executions (surface, status, timing, summary)
- `scraper.scrape_artifacts` - Compact artifact storage per scrape run

**Durable entities (deduplicated):**
- `scraper.facebook_pages` - Page records with `following`, `bio`, `location_text`
- `scraper.facebook_page_contacts` - Phone, email, website, address contacts
- `scraper.facebook_page_social_links` - Social media links (Instagram, TikTok, etc.)
- `scraper.facebook_posts` - Post records with external IDs and permalinks
- `scraper.marketplace_listings` - Listing records with price, location, seller
- `scraper.marketplace_sellers` - Seller profile records

**Snapshot/context tables:**
- `scraper.facebook_page_scrapes` - Page scrape snapshots
- `scraper.facebook_page_transparency_history` - Page creation/history records
- `scraper.facebook_post_scrapes` - Post metric snapshots (reactions, comments, shares)
- `scraper.facebook_post_tags` - Hashtags, mentions, links per post scrape
- `scraper.facebook_post_media` - Media attachments per post scrape
- `scraper.marketplace_search_scrapes` - Search execution context
- `scraper.marketplace_search_results` - Search result rankings
- `scraper.marketplace_listing_scrapes` - Listing scrape with route/query context
- `scraper.marketplace_seller_scrapes` - Seller scrape with route/query context
- `scraper.marketplace_seller_scrape_listings` - Seller inventory per scrape

See: [`docs/postgres_storage.md`](docs/postgres_storage.md)

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Dependencies, scripts, project metadata |
| `tsconfig.json` | TypeScript configuration (ES2020, CommonJS, strict mode) |
| `.env.example` | Environment variable templates (PostgreSQL connection) |
| `src/types/contracts.ts` | All output type definitions (PageInfo, Posts, Marketplace) |
| `src/storage/schema_versions.ts` | Schema versioning for outputs (pageInfo: 0.2.0, etc.) |
| `src/core/scraper_context.ts` | Shared context factory for scrapers |
| `src/core/job_runner.ts` | Scrape job execution wrapper with DB persistence |
| `src/capture/graphql_capture.ts` | GraphQL response capture (`/graphql/`, `/api/graphql/`) |
| `src/capture/route_definition_capture.ts` | Route definition capture (`/ajax/bulk-route-definitions/`) |
| `src/parsers/dom/page_dom_parser.ts` | DOM extraction for page info (followers, social media, bio) |
| `src/parsers/embedded/marketplace_embedded_parser.ts` | ScheduledServerJS payload extraction |
| `db/migrations/001_initial_schema.sql` | Base PostgreSQL schema |
| `db/migrations/002_page_info_enrichment.sql` | Social links, following, bio, location columns |
| `docs/run_scraper.md` | Detailed runbook for scrapers |
| `docs/architecture.md` | High-level architecture overview |
| `docs/postgres_storage.md` | Database schema and persistence design |
| `docs/marketplace_transport_findings.md` | Marketplace payload transport findings |
| `docs/selectors_and_queries.md` | Known GraphQL queries and DOM selectors |
| `docs/dom_page_extraction.md` | DOM-based page info extraction patterns |
| `docs/RESUME.md` | Current project state and known gaps |

## Runtime Assumptions

1. **Chrome is external**: The scraper does NOT launch Chrome; it attaches to an existing instance
2. **Remote debugging on port 9222**: Configurable via `--chrome-port`
3. **PostgreSQL is optional**: Use `--persist-db=false` to skip DB writes
4. **Outputs default to `./output/`**: JSON files written per-scraper type

## Documentation Status

All documentation has been verified and is in sync with the codebase:

| Document | Status | Notes |
|----------|--------|-------|
| `README.md` | ✅ In sync | Accurate project overview and quick-start |
| `docs/run_scraper.md` | ✅ In sync | CLI commands match implementation |
| `docs/architecture.md` | ✅ In sync | Layer descriptions accurate |
| `docs/postgres_storage.md` | ✅ In sync | Schema design matches migrations |
| `docs/output_schemas.md` | ✅ In sync | References correct type files |
| `docs/marketplace_transport_findings.md` | ✅ In sync | Findings implemented in embedded parsers |
| `docs/selectors_and_queries.md` | ✅ In sync | Known queries documented |
| `docs/dom_page_extraction.md` | ✅ In sync | DOM patterns implemented |
| `docs/plan_page_info_enrichment.md` | ✅ Implemented | Plan executed (social links, following, bio, location) |
| `docs/RESUME.md` | ✅ In sync | Current state and gaps accurately described |

## Known Limitations / Non-Goals

- Does not manage Chrome lifecycle
- Does not handle login or cookie management
- Not designed for large-scale orchestration
- GraphQL query names and selectors may drift with Facebook changes

## Known Gaps (from RESUME.md)

1. Facebook post comments and share counts are weaker than reactions extraction
2. Page transparency extraction contains some noisy visible text
3. No SQL views yet for read models (latest listing, seller inventory, latest page posts)
4. No orchestration or scheduling layer; CLI-first entrypoints
5. No cleanup/retention tooling for old failed scrape runs
