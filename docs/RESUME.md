# Resume Notes

## Working Directory
Use this directory as the project root:
- `/root/codebase/sm-auto`

## What This Project Is
A Facebook and Marketplace scraper platform that:
- attaches to an already running Chrome on port `9222`
- does not manage login or cookies
- persists normalized scraper outputs to local PostgreSQL by default

## Current Runtime Assumptions
Chrome is already running, for example:

```bash
google-chrome --user-data-dir=/root/.config/google-chrome/Profile\ 2 --remote-debugging-port=9222 --no-sandbox --remote-allow-origins=*
```

Postgres is local and env-backed. A working local DB config example is:

```bash
DATABASE_URL=postgresql://agent0@127.0.0.1:5432/facebook_scraper
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=facebook_scraper
PGUSER=agent0
PGPASSWORD=
PGSSLMODE=disable
```

## Important Architectural Findings
1. Facebook page scraping is still hybrid GraphQL + DOM.
2. Marketplace seller and listing data cannot be treated as `/graphql/`-only transport.
3. In live Marketplace sessions, important data often arrives in:
- embedded HTML `script[type="application/json"][data-sjs]`
- `ScheduledServerJS` / `RelayPrefetchedStreamCache` payloads
- `ajax/bulk-route-definitions` responses for route/query context
4. DOM is now a fallback for Marketplace. Embedded payloads and route definitions are primary where available.

See:
- [marketplace_transport_findings.md](/root/codebase/sm-auto/docs/marketplace_transport_findings.md)
- [architecture.md](/root/codebase/sm-auto/docs/architecture.md)

## Current Persistence Status
Implemented and working:
- automatic DB prep via `npm run db:prepare`
- run tracking in `scrape_runs`
- compact artifact persistence in `scrape_artifacts`
- durable entities for pages, posts, sellers, listings
- scrape snapshot tables for search, listing, seller, page info, and post metrics

Schema and ingestion notes:
- [postgres_storage.md](/root/codebase/sm-auto/docs/postgres_storage.md)
- [001_initial_schema.sql](/root/codebase/sm-auto/db/migrations/001_initial_schema.sql)

## Commands To Start With
Prepare DB:

```bash
cd /root/codebase/sm-auto
npm run db:prepare
```

Validate repo:

```bash
cd /root/codebase/sm-auto
npm run validate
```

Run a persisted Marketplace listing scrape:

```bash
cd /root/codebase/sm-auto
bun run src/cli/scrape_marketplace_listing.ts --listing-id 1244539514326495 --include-artifacts
```

Run without DB persistence:

```bash
cd /root/codebase/sm-auto
bun run src/cli/scrape_marketplace_listing.ts --listing-id 1244539514326495 --persist-db=false
```

## Current Known State
The current codebase has been validated and used to persist live sample data into Postgres.
There are historical failed rows in `scrape_runs` from debugging passes. Those are expected and not evidence of a current blocker.

## Known Gaps
1. Facebook post comments and share counts are still weaker than reactions.
2. Page transparency extraction still contains noisy visible text from some page layouts.
3. Search result persistence stores ranking snapshots correctly, but there are no read-oriented SQL views yet.
4. There is no orchestration or scheduling layer yet; current entrypoints are CLI-first.

## Best Next Tasks
1. Add SQL views or read models for latest listing, seller inventory, and latest page posts.
2. Improve Facebook post metrics extraction for comments and shares.
3. Add cleanup and retention tooling for old failed scrape runs and large artifact rows.
4. Add provenance fields if we need to trace each field back to `graphql`, `embedded_document`, `route_definition`, or `dom`.
