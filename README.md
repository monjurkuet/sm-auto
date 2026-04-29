# Facebook Scraper Platform

This package scaffolds a modular Facebook scraper that attaches to an already-running Chrome instance on port `9222`.

## Requirements
- Bun
- Google Chrome with the DevTools remote debugging port enabled
- PostgreSQL for persisted scrapes

## Scope
- Facebook page information
- Facebook page posts
- Facebook Marketplace search
- Facebook Marketplace listing details
- Facebook Marketplace seller pages
- Facebook group metadata, feed posts, and post comments

## Non-goals
- Chrome launch management
- Login or cookie management
- Large-scale orchestration

## Layout
- `src/browser`: Chrome DevTools attachment and page lifecycle helpers
- `src/capture`: GraphQL capture and request metadata parsing
- `src/extractors`: Surface-specific scraping flows
- `src/parsers`: Pure DOM and GraphQL parsers
- `src/normalizers`: Final result shaping
- `src/storage`: Result and artifact writing
- `src/cli`: Runnable entrypoints
- `db/migrations`: PostgreSQL schema migrations

## Docs Index

Primary docs:
- [`README.md`](README.md): project overview, prerequisites, and quick-start commands
- [`docs/run_scraper.md`](docs/run_scraper.md): step-by-step runbook for starting Chrome, preparing Postgres, and running each scraper CLI
- [`docs/postgres_storage.md`](docs/postgres_storage.md): Postgres setup, schema intent, and persistence behavior
- [`docs/architecture.md`](docs/architecture.md): high-level layer breakdown and the transport/parser separation rule
- [`docs/output_schemas.md`](docs/output_schemas.md): the JSON outputs produced by the scrapers and where their contracts live
- [`docs/selectors_and_queries.md`](docs/selectors_and_queries.md): known GraphQL query names, route targets, and DOM fallback selectors to track
- [`docs/marketplace_transport_findings.md`](docs/marketplace_transport_findings.md): Marketplace-specific transport findings around embedded payloads, route definitions, and DOM fallback behavior
- [`docs/RESUME.md`](docs/RESUME.md): current project state, runtime assumptions, known gaps, and next-work notes

Fixture docs:
- [`fixtures/dom/README.md`](fixtures/dom/README.md): guidance for storing DOM snapshots or reduced HTML fixtures for parser tests
- [`fixtures/graphql/README.md`](fixtures/graphql/README.md): guidance for storing sanitized GraphQL fixtures and required redactions

## Runtime assumption
Chrome is already running with remote debugging enabled, for example:

```bash
google-chrome --user-data-dir=/root/.config/google-chrome/Profile\ 2 --remote-debugging-port=9222 --no-sandbox --remote-allow-origins=*
```

## Getting started

Install dependencies:

```bash
bun install
```

## PostgreSQL
PostgreSQL persistence is env-backed and enabled by default for the scraper CLIs.

Prepare the database:

```bash
npm run db:prepare
```

Disable DB persistence for a scrape:

```bash
bun run src/cli/scrape_marketplace_listing.ts --listing-id 123 --persist-db=false
```

Environment variables are documented in [`.env.example`](.env.example) and the schema design is documented in [`docs/postgres_storage.md`](docs/postgres_storage.md).
