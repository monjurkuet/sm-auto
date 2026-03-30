# Final Merged Review and Revised Implementation Plan

## Executive summary

The original cleanup/refactor plan is fundamentally sound and worth pursuing, especially the storage-layer split and the parser cleanup. However, it should be revised before implementation to reduce breakage risk, keep imports stable, avoid duplicated helper logic, and separate structural refactoring from repo-wide formatting/tooling churn.

The most important improvements are:

1. Keep `src/storage/postgres/persistence.ts` as a compatibility facade.
2. Extract shared Postgres helpers into a dedicated utility module.
3. Explicitly decide where `upsertFacebookPageStub` lives.
4. Extract duplicated brace-balancing logic in the DOM parser.
5. Add parser-focused unit tests before or during refactoring.
6. Treat ESLint/Prettier as a separate phase, not part of the same structural refactor PR.

---

## Final merged review

### What the original plan gets right

#### 1) Storage refactor is justified

`src/storage/postgres/persistence.ts` is large and clearly mixes multiple concerns:

- scrape run lifecycle,
- page persistence,
- post persistence,
- marketplace persistence,
- artifact persistence,
- JSON/timestamp conversion helpers.

Splitting by domain/responsibility will improve readability, local reasoning, and future change safety.

#### 2) Parser refactor is justified

`src/parsers/dom/page_dom_parser.ts` currently mixes:

- raw DOM snapshot capture,
- DOM-based parsing,
- embedded JSON/HTML extraction,
- embedded-data post-processing.

That makes the module harder to test and maintain than necessary.

#### 3) Logging cleanup is valid

The project already has a `Logger` abstraction in `src/core/logger.ts`, so replacing ad hoc `console.log` in `src/cli/db_prepare.ts` is consistent with the codebase direction.

---

### Key corrections and additions to the original plan

#### A. `persistence.ts` should remain a facade, not just an “orchestrator”

This is the single most important implementation detail.

Current consumers import directly from `src/storage/postgres/persistence.ts`, including:

- `src/core/job_runner.ts`
- multiple CLI entrypoints
- `src/storage/postgres/index.ts` re-export path

That means the safest approach is:

- split logic into new internal modules,
- keep `persistence.ts` as the stable public API, re-exporting the same symbols it exports today.

This avoids unnecessary import churn and makes the refactor incremental.

Required public compatibility to preserve:

- `PostgresJobPersistence`
- `ScrapeRunStartInput`
- `ScrapeRunCompletion`
- `ScrapeSurface`
- `failScrapeRun`
- `startPersistenceRun`
- `completePersistenceRun`
- all `create*Persistence(...)` factory functions

#### B. Shared Postgres helpers need their own module

Several functions are cross-domain utilities, not tied to pages/posts/marketplace specifically.

These should be extracted to something like:

- `src/storage/postgres/persistence_utils.ts`, or
- `src/storage/postgres/repository_utils.ts`

Suggested shared helpers:

- `compactJson`
- `toJsonb`
- `toIsoTimestamp`
- `insertArtifacts`

Without this extraction, the split will either duplicate logic or create awkward imports.

#### C. `upsertFacebookPageStub` needs an explicit home

`upsertFacebookPageStub` is page-oriented but is used from `persistPagePostsSurface`. There are two reasonable options:

**Option 1 — preferred**

Put it in `page_repository.ts` and allow `post_repository.ts` to import it.

- Pros: semantically accurate
- Cons: cross-module dependency

**Option 2**

Extract page record upsert helpers into a smaller shared module, for example:

- `facebook_page_store.ts`
- `page_record_repository.ts`

Recommendation: start with Option 1 unless the cross-dependency grows.

#### D. Parser refactor should consolidate duplicated brace-balancing logic

Both of these functions currently contain nearly identical marker/brace-balancing extraction logic:

- `captureEmbeddedProfileData(...)`
- `extractProfileTileItems(...)`

Before or during the parser split, extract a shared helper such as:

- `extractBalancedJsonSegment(source: string, marker: string): string | null`

That utility can then support both browser-side capture flow and post-capture string parsing flow.

#### E. Tooling should be split from structural refactoring

Adding ESLint and Prettier is reasonable, but doing that in the same pass as storage/parser refactoring will:

- create noisy diffs,
- make review harder,
- obscure logic regressions,
- increase conflict risk.

Recommendation:

- Phase 1: structural refactor + tests
- Phase 2: lint/format adoption

If formatting is required during Phase 1, restrict it to touched files only.

#### F. The current test plan is too optimistic

The original plan implies parser coverage is already solid, but current evidence suggests there are not obviously targeted unit tests for the page DOM parsing helpers.

That means parser refactoring carries more risk than the original plan admits.

Add tests for:

- `parseFollowerCount`
- `parseFollowingCount`
- `parseContactInfoFromDom`
- `parseBio`
- `parseLocation`
- `extractProfileTileItems`
- `extractLocationFromEmbeddedData`
- any new `extractBalancedJsonSegment` helper

---

### Additional items that were easy to miss

#### 1) Naming: “repository” may not fully describe these modules

These files do more than classic repository CRUD. They also persist scrape-surface snapshots and related artifacts.

While names like `page_repository.ts` are acceptable, alternatives such as these may better reflect behavior:

- `page_persistence.ts`
- `post_persistence.ts`
- `marketplace_persistence.ts`
- `run_persistence.ts`

#### 2) Keep transaction boundaries unchanged

`job_runner.ts` currently wraps persistence calls in `withTransaction(...)`.
That behavior should not change during refactor.

The plan should explicitly preserve:

- run creation transaction behavior,
- persist + completion transaction behavior,
- failure-marking fallback behavior.

#### 3) Avoid changing public contracts unless necessary

The factory functions like `createPageInfoPersistence(...)` and `createMarketplaceListingPersistence(...)` are already the integration seam used by the CLI commands.

Do not redesign this API during the refactor unless there is a concrete need. The safest implementation is internal restructuring only.

#### 4) `src/storage/postgres/index.ts` should continue to export the same surface

Because `index.ts` currently re-exports `./persistence`, the storage refactor should not require downstream callers to know about the new internal files.

If desired, `index.ts` can later re-export the new modules too, but that should be optional and not required for this refactor.

#### 5) Parser module boundary may need two files, not one

The original proposal suggested a single `embedded_dom_parser.ts`. That works, but note that:

- `captureEmbeddedProfileData(...)` interacts with Puppeteer page context,
- `extractProfileTileItems(...)` and `extractLocationFromEmbeddedData(...)` are pure string/data helpers.

Two reasonable structures:

**Simple**

- `embedded_dom_parser.ts` contains all three

**Cleaner**

- `embedded_dom_capture.ts` for Puppeteer/browser extraction
- `embedded_dom_parser.ts` for pure helpers

Either is fine, but the implementation should choose intentionally.

#### 6) Minimal lint config is better than strict lint config initially

If tooling is added, start with a low-friction config:

- TypeScript-aware linting
- obvious correctness rules
- formatting delegated to Prettier
- avoid rule sets that produce a repo-wide cleanup explosion

#### 7) Verification commands should align with declared scripts

The repo defines:

- `npm test`
- `npm run typecheck`
- `npm run validate`

Even if Bun is used under the hood, the plan should prefer the declared package scripts in documentation because they are clearer and more stable.

#### 8) Smoke verification may not be deterministic

`src/cli/smoke.ts` likely depends on local browser/auth/runtime state, so it should be treated as best-effort manual verification, not a hard gate.

#### 9) Use a rollback-safe implementation strategy

Each step should leave the repo in a working state. That means:

- create new modules,
- move logic gradually,
- keep old imports stable,
- run validation after each stage.

#### 10) Artifact persistence is a shared concern, not a domain concern

`insertArtifacts(...)` is used by every `persist*Surface(...)` path. It should not live in one domain repository after the split.

#### 11) Run lifecycle exports need an explicit transition plan

The current file has a mix of internal and exported lifecycle functions. After extraction into `run_repository.ts`, those functions should be exported there and re-exposed through `persistence.ts` with compatibility-preserving names.

#### 12) Keep the refactor behaviorally neutral around SQL semantics

The refactor should not change:

- `ON CONFLICT` behavior,
- `COALESCE` merge behavior,
- insert/update ordering,
- per-item loop semantics for tags, media, images, and delivery options,
- the shape of stored JSON payloads.

This is especially important because many of these behaviors double as data normalization policy.

---

## Revised implementation plan

### Phase 0 — Guardrails and scope

Goal: keep the refactor behaviorally neutral.

- No database schema changes.
- No changes to external CLI behavior.
- No changes to the public persistence API unless unavoidable.
- No repo-wide formatting sweep in the same PR.

### Phase 1 — Strengthen tests before risky moves

Goal: reduce refactor risk, especially for parser changes.

Add targeted parser unit tests for:

- `parseFollowerCount`
- `parseFollowingCount`
- `parseContactInfoFromDom`
- `parseBio`
- `parseLocation`
- `extractProfileTileItems`
- `extractLocationFromEmbeddedData`
- new shared brace-balancing extraction helper

Also run baseline checks:

- `npm test`
- `npm run typecheck`

### Phase 2 — Extract shared Postgres utilities

Goal: prepare for the storage split without duplication.

Create a shared module, e.g.:

- `src/storage/postgres/persistence_utils.ts`

Move these there:

- `compactJson`
- `toJsonb`
- `toIsoTimestamp`
- `insertArtifacts`

Validation:

- `npm run typecheck`
- `npm test`

### Phase 3 — Split scrape run lifecycle logic

Goal: isolate run start/complete/fail responsibilities.

Create:

- `src/storage/postgres/run_repository.ts`

Move/export:

- `startScrapeRun`
- `completeScrapeRun`
- `failScrapeRun`

Then keep `persistence.ts` exporting compatibility wrappers or direct re-exports:

- `startPersistenceRun`
- `completePersistenceRun`
- `failScrapeRun`

Validation:

- `npm run typecheck`
- `npm test`

### Phase 4 — Split page and post persistence

Goal: isolate Facebook page/post logic cleanly.

Create:

- `src/storage/postgres/page_repository.ts`
- `src/storage/postgres/post_repository.ts`

`page_repository.ts`

Move:

- `upsertFacebookPage`
- `upsertFacebookPageStub`
- `upsertFacebookPageContacts`
- `persistPageInfoSurface`

`post_repository.ts`

Move:

- `findFacebookPostRecordId`
- `upsertFacebookPost`
- `persistPagePostsSurface`

Dependency handling:

Allow `post_repository.ts` to import `upsertFacebookPageStub` from `page_repository.ts`, or extract that helper if the dependency feels too awkward.

Important: leave `createPageInfoPersistence(...)` and `createPagePostsPersistence(...)` exported from `persistence.ts`.

Validation:

- `npm run typecheck`
- `npm test`

### Phase 5 — Split marketplace persistence

Goal: isolate marketplace-specific persistence.

Create:

- `src/storage/postgres/marketplace_repository.ts`

Move:

- `upsertMarketplaceSeller`
- `upsertMarketplaceListing`
- `persistMarketplaceSearchSurface`
- `persistMarketplaceListingSurface`
- `persistMarketplaceSellerSurface`

Keep factory functions publicly available via `persistence.ts`:

- `createMarketplaceSearchPersistence(...)`
- `createMarketplaceListingPersistence(...)`
- `createMarketplaceSellerPersistence(...)`

Validation:

- `npm run typecheck`
- `npm test`
- `npm run validate` if the split is complete enough

### Phase 6 — Convert `persistence.ts` into the stable facade

Goal: preserve the existing import surface.

Refactor `src/storage/postgres/persistence.ts` so it:

- defines or re-exports shared types,
- re-exports the run/page/post/marketplace public functions,
- keeps all existing public symbols available,
- contains minimal or no heavy implementation logic.

This file becomes the backward-compatible entrypoint used by:

- `job_runner.ts`
- CLI commands
- `src/storage/postgres/index.ts`

Validation:

- `npm run validate`

### Phase 7 — Refactor parser internals

Goal: separate embedded JSON extraction from generic DOM parsing.

First extract shared embedded extraction helper:

- `extractBalancedJsonSegment(source, marker)`

Then split embedded logic.

Option A:

- `src/parsers/dom/embedded_dom_parser.ts` for all embedded helpers

Option B:

- `src/parsers/dom/embedded_dom_capture.ts`
- `src/parsers/dom/embedded_dom_parser.ts`

Move out of `page_dom_parser.ts`:

- `captureEmbeddedProfileData`
- `extractProfileTileItems`
- `extractLocationFromEmbeddedData`

Also extract inline regex/constants where that improves readability, but do not over-engineer this.

Update `page_info_extractor.ts` imports accordingly.

Validation:

- `npm test`
- `npm run typecheck`

### Phase 8 — Logging cleanup

Goal: align CLI behavior with existing logging abstraction.

Update `src/cli/db_prepare.ts` to use the existing logger pattern rather than raw `console.log`.

Likely approach:

- instantiate `ConsoleLogger` directly in the CLI, or
- add a tiny CLI helper if that pattern will be reused.

Validation:

- `npm run typecheck`

### Phase 9 — Optional tooling pass (separate PR preferred)

Goal: add lint/format infrastructure without contaminating the refactor diff.

Add:

- ESLint config
- Prettier config
- `lint` script
- optional `format` script
- necessary `devDependencies`

Recommended style:

- minimal TypeScript-aware rules,
- Prettier handles formatting,
- avoid strict rules that generate a large unrelated cleanup.

If formatting is applied, prefer:

- touched files only in the refactor PR,
- repo-wide formatting in a dedicated follow-up.

Validation:

- `npm run typecheck`
- `npm test`
- `npm run lint` if added
- `npm run validate` if scripts are updated accordingly

---

## Final recommendation

### Approve, but with revisions

The plan should be approved only after incorporating the following required changes.

#### Required revisions

- Preserve `persistence.ts` as a public compatibility facade.
- Extract shared Postgres helpers into a dedicated utility module.
- Explicitly place `upsertFacebookPageStub`.
- Extract duplicated brace-balancing logic into a shared parser helper.
- Add targeted parser tests.
- Separate tooling/formatting from the main structural refactor.
- Preserve transaction behavior and public factory APIs.
- Keep SQL semantics and stored payload shapes unchanged.

#### Nice-to-have revisions

- Reconsider naming of “repository” modules if you want names to reflect snapshot persistence responsibilities.
- Optionally split embedded capture from embedded parsing into two files if cleaner.

---

## Suggested implementation order

For the safest path:

1. Add parser test coverage.
2. Extract shared Postgres utilities.
3. Split run lifecycle.
4. Split page/post persistence.
5. Split marketplace persistence.
6. Turn `persistence.ts` into a facade/barrel.
7. Refactor parser embedded-data helpers.
8. Clean up logging.
9. Add ESLint/Prettier in a separate pass.
