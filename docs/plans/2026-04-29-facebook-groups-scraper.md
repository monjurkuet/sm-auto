# Facebook Groups Scraper Implementation Plan

> **STATUS: ALL 18 TASKS COMPLETED (2026-05-01).** See `docs/FACEBOOK_GROUPS_REPORT.md` for the current system report. This plan is the original design; the monitoring system (registry, vitality scoring, cron orchestration) was added in a second phase documented in `docs/plans/2026-05-01-group-monitoring-system.md`.

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add Facebook Groups scraping to sm-auto, covering group metadata, feed posts, and post detail (comments, replies, reactions).

**Architecture:** Follows the existing extractor/parser/normalizer/storage pipeline. Three new surfaces: `group_info` (group metadata, member count, privacy, admins), `group_posts` (scrollable feed with post summaries), and `group_post_detail` (individual post with comments, replies, reactions). Reuses existing `GraphQLCapture`, `RouteDefinitionCapture`, `ChromeClient`/`PageSession`, and the DOM snapshot pattern. Post and comment types extend the existing `PagePost` pattern but are separate types because group posts have different fields (group context, different reaction types, reply threading).

**Tech Stack:** Bun, TypeScript, puppeteer-core, PostgreSQL (scraper schema), yargs

---

## Design Decisions (resolved upfront)

1. **Groups are a separate entity from Pages.** Facebook groups and pages share some fields but have different semantics (members vs followers, privacy levels, admin roles, group rules, post approval queues). Separate tables, separate types.

2. **Group posts are a separate type from PagePosts.** Group posts have: group context, post approval status, different comment threading (top-level comments + nested replies), reaction breakdowns (not just total count). Keeping them separate avoids nullable pollution on `PagePost`.

3. **Comments and replies are stored in a flat table with `parent_comment_id` for threading.** Nested replies are typically 1-2 levels deep on Facebook. A flat table with a self-referencing FK is simpler than recursive adjacency and queries well with CTEs.

4. **Post detail scraping is a separate surface from feed scrolling.** The feed scroll captures post summaries (title, text snippet, metrics, author). Post detail is a separate scrape that opens the post permalink and captures full comments. This matches how the existing marketplace works (search -> listing detail is two surfaces).

5. **GraphQL friendly names for groups.** Based on Facebook's known GraphQL surface names: `GroupCometFeedQuery`, `GroupCometDiscussionRootQuery`, `GroupsCometFeedRegularStoriesPaginationQuery`, `CometGroupDiscussionRootQuery`. Post detail uses `CometUFIFeedbackMutation` for reactions and `CometFeedbackFeedbackMutation` for comments. We'll discover the exact names during implementation and update `selectors_and_queries.md`.

6. **Group URL format:** `https://www.facebook.com/groups/{groupId}/` with optional vanity slug like `https://www.facebook.com/groups/430419725850542/`. Post permalinks: `https://www.facebook.com/groups/{groupId}/posts/{postId}/`.

---

## Database Schema

### Migration: `009_facebook_groups.sql`

```sql
-- ── Group entity ──
CREATE TABLE scraper.facebook_groups (
  group_id        TEXT PRIMARY KEY,
  name            TEXT,
  vanity_slug     TEXT,
  privacy_type    TEXT,          -- 'public' | 'private' | 'secret'
  group_type      TEXT,          -- e.g. 'buy_and_sell', 'hobbies', 'work'
  member_count    INTEGER,
  description     TEXT,
  cover_photo_url TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at TIMESTAMPTZ,
  latest_payload  JSONB
);

-- ── Group admins/moderators ──
CREATE TABLE scraper.facebook_group_admins (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  user_id         TEXT NOT NULL,
  user_name       TEXT,
  admin_type      TEXT,          -- 'admin' | 'moderator'
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- ── Group rules ──
CREATE TABLE scraper.facebook_group_rules (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  rule_text       TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group tags/topics ──
CREATE TABLE scraper.facebook_group_tags (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  tag_text        TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group info scrape snapshots ──
CREATE TABLE scraper.facebook_group_info_scrapes (
  id              BIGSERIAL PRIMARY KEY,
  scrape_run_id   UUID NOT NULL REFERENCES scraper.scrape_runs(id),
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group posts (extends the post pattern) ──
CREATE TABLE scraper.facebook_group_posts (
  post_id         TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES scraper.facebook_groups(group_id),
  author_id       TEXT,
  author_name     TEXT,
  permalink       TEXT,
  created_at      TIMESTAMPTZ,
  text_content    TEXT,
  has_attachments BOOLEAN,
  attachment_type TEXT,          -- 'photo' | 'video' | 'link' | 'shared_post' | null
  is_approved     BOOLEAN,      -- null if group doesn't require approval
  reaction_count  INTEGER,
  comment_count   INTEGER,
  share_count     INTEGER,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at TIMESTAMPTZ,
  latest_payload  JSONB
);

-- ── Group post media ──
CREATE TABLE scraper.facebook_group_post_media (
  id              BIGSERIAL PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES scraper.facebook_group_posts(post_id),
  media_type      TEXT NOT NULL,  -- 'photo' | 'video'
  media_id        TEXT,
  media_url       TEXT,
  width           INTEGER,
  height          INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Group post scrape snapshots ──
CREATE TABLE scraper.facebook_group_post_scrapes (
  id              BIGSERIAL PRIMARY KEY,
  scrape_run_id   UUID NOT NULL REFERENCES scraper.scrape_runs(id),
  post_id         TEXT NOT NULL REFERENCES scraper.facebook_group_posts(post_id),
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Comments (flat with parent_comment_id for threading) ──
CREATE TABLE scraper.facebook_group_post_comments (
  comment_id      TEXT PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES scraper.facebook_group_posts(post_id),
  parent_comment_id TEXT REFERENCES scraper.facebook_group_post_comments(comment_id),
  author_id       TEXT,
  author_name     TEXT,
  text_content    TEXT,
  created_at      TIMESTAMPTZ,
  reaction_count  INTEGER,
  reply_count     INTEGER,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_scraped_at TIMESTAMPTZ,
  latest_payload  JSONB
);

-- ── Comment scrape snapshots ──
CREATE TABLE scraper.facebook_group_comment_scrapes (
  id              BIGSERIAL PRIMARY KEY,
  scrape_run_id   UUID NOT NULL REFERENCES scraper.scrape_runs(id),
  comment_id      TEXT NOT NULL REFERENCES scraper.facebook_group_post_comments(comment_id),
  scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX idx_group_posts_group ON scraper.facebook_group_posts(group_id);
CREATE INDEX idx_group_posts_created ON scraper.facebook_group_posts(created_at DESC);
CREATE INDEX idx_group_comments_post ON scraper.facebook_group_post_comments(post_id);
CREATE INDEX idx_group_comments_parent ON scraper.facebook_group_post_comments(parent_comment_id);
CREATE INDEX idx_group_admins_group ON scraper.facebook_group_admins(group_id);
CREATE INDEX idx_group_rules_group ON scraper.facebook_group_rules(group_id);
CREATE INDEX idx_group_info_scrapes_run ON scraper.facebook_group_info_scrapes(scrape_run_id);
CREATE INDEX idx_group_post_scrapes_run ON scraper.facebook_group_post_scrapes(scrape_run_id);
CREATE INDEX idx_group_comment_scrapes_run ON scraper.facebook_group_comment_scrapes(scrape_run_id);
```

### Migration: `010_facebook_groups_views.sql`

```sql
-- Latest group info view
CREATE OR REPLACE VIEW scraper.v_latest_group_info AS
SELECT DISTINCT ON (g.group_id)
  g.group_id, g.name, g.vanity_slug, g.privacy_type, g.group_type,
  g.member_count, g.description, g.cover_photo_url,
  g.last_scraped_at
FROM scraper.facebook_groups g
WHERE g.is_active = true
ORDER BY g.group_id, g.last_seen_at DESC;

-- Latest group posts view
CREATE OR REPLACE VIEW scraper.v_latest_group_posts AS
SELECT DISTINCT ON (gp.post_id)
  gp.post_id, gp.group_id, gp.author_name, gp.permalink,
  gp.created_at, gp.text_content, gp.reaction_count,
  gp.comment_count, gp.share_count, gp.last_scraped_at,
  g.name as group_name
FROM scraper.facebook_group_posts gp
JOIN scraper.facebook_groups g ON g.group_id = gp.group_id
ORDER BY gp.post_id, gp.last_seen_at DESC;

-- Post comment summary view
CREATE OR REPLACE VIEW scraper.v_post_comment_summary AS
SELECT
  c.post_id,
  COUNT(*) FILTER (WHERE c.parent_comment_id IS NULL) as top_level_comments,
  COUNT(*) FILTER (WHERE c.parent_comment_id IS NOT NULL) as replies,
  COUNT(DISTINCT c.author_id) as unique_authors
FROM scraper.facebook_group_post_comments c
WHERE c.is_active = true
GROUP BY c.post_id;
```

---

## TypeScript Type Contracts

Add to `src/types/contracts.ts`:

```ts
// ── Group Info ──

export interface GroupInfoResult {
  groupId: string | null;
  url: string;
  name: string | null;
  vanitySlug: string | null;
  privacyType: string | null;
  groupType: string | null;
  memberCount: number | null;
  description: string | null;
  coverPhotoUrl: string | null;
  admins: GroupAdmin[];
  rules: string[];
  tags: string[];
  scrapedAt: string;
  provenance?: Record<string, DataProvenance>;
}

export interface GroupAdmin {
  id: string | null;
  name: string | null;
  adminType: string | null; // 'admin' | 'moderator'
}

// ── Group Posts ──

export interface GroupPost {
  id: string | null;
  postId: string | null;
  permalink: string | null;
  createdAt: string | null;
  text: string | null;
  author: {
    id: string | null;
    name: string | null;
  };
  media: Array<{
    type: string | null;  // 'photo' | 'video'
    id: string | null;
    url: string | null;
    width?: number;
    height?: number;
  }>;
  metrics: {
    reactions: number | null;
    comments: number | null;
    shares: number | null;
  };
  isApproved: boolean | null;
}

export interface GroupPostsResult {
  groupId: string | null;
  url: string;
  posts: GroupPost[];
  scrapedAt: string;
}

// ── Group Post Detail ──

export interface GroupPostComment {
  id: string | null;
  parentId: string | null;  // null for top-level, comment_id for replies
  author: {
    id: string | null;
    name: string | null;
  };
  text: string | null;
  createdAt: string | null;
  metrics: {
    reactions: number | null;
    replies: number | null;
  };
}

export interface GroupPostDetailResult {
  postId: string | null;
  url: string;
  groupId: string | null;
  post: GroupPost;
  comments: GroupPostComment[];
  totalCommentCount: number | null;
  scrapedAt: string;
}
```

Also extend `ScrapeSurface` in `persistence_contracts.ts`:

```ts
export type ScrapeSurface =
  | 'page_info'
  | 'page_posts'
  | 'marketplace_search'
  | 'marketplace_listing'
  | 'marketplace_seller'
  | 'group_info'
  | 'group_posts'
  | 'group_post_detail';
```

---

## File Map (new files only)

```
src/
├── types/contracts.ts                    # MODIFY — add GroupInfoResult, GroupPost, GroupPostsResult, GroupPostComment, GroupPostDetailResult
├── routes/facebook_routes.ts             # MODIFY — add buildGroupUrl(), buildGroupPostUrl()
├── capture/graphql_capture.ts            # NO CHANGE — reuse as-is
├── capture/route_definition_capture.ts   # NO CHANGE — reuse as-is
├── extractors/
│   ├── group_info_extractor.ts           # NEW
│   ├── group_posts_extractor.ts          # NEW
│   └── group_post_detail_extractor.ts    # NEW
├── parsers/
│   ├── graphql/
│   │   ├── group_feed_parser.ts          # NEW — collect/parse group feed GraphQL fragments
│   │   └── group_comment_parser.ts       # NEW — collect/parse post detail GraphQL fragments
│   ├── dom/
│   │   └── group_dom_parser.ts           # NEW — snapshot group metadata from DOM
│   └── embedded/
│       └── group_route_identity.ts       # NEW — extract groupId from route definitions
├── normalizers/
│   ├── group_info_normalizer.ts          # NEW
│   └── group_post_normalizer.ts          # NEW — merge GraphQL posts with DOM metrics
├── storage/postgres/
│   ├── group_repository.ts              # NEW — upsert/persist for group tables
│   ├── group_queue_repository.ts        # NEW — bulk queue: select uncrawled posts for detail
│   ├── persistence.ts                    # MODIFY — add createGroupInfoPersistence, createGroupPostsPersistence, createGroupPostDetailPersistence
│   └── schema_versions.ts               # MODIFY — add groupInfo, groupPosts, groupPostDetail
├── cli/
│   ├── scrape_group_info.ts             # NEW
│   ├── scrape_group_posts.ts            # NEW
│   └── scrape_group_post_detail.ts      # NEW
db/migrations/
│   ├── 009_facebook_groups.sql           # NEW
│   └── 010_facebook_groups_views.sql     # NEW
docs/
│   └── facebook_groups_design.md         # NEW — this plan document
```

---

## Tasks

### Task 1: Add group type contracts

**Objective:** Define all TypeScript types for groups in contracts.ts

**Files:**
- Modify: `src/types/contracts.ts`

**Step 1:** Add `GroupAdmin`, `GroupInfoResult`, `GroupPost`, `GroupPostsResult`, `GroupPostComment`, `GroupPostDetailResult` interfaces to `contracts.ts` (see type definitions above).

**Step 2:** Add `'group_info' | 'group_posts' | 'group_post_detail'` to `ScrapeSurface` in `src/storage/postgres/persistence_contracts.ts`.

**Step 3:** Run typecheck:

```bash
cd /root/codebase/sm-auto && bun run typecheck
```

Expected: errors from missing files that will reference these types later — that's fine. No new errors from the contracts themselves.

**Step 4:** Commit:

```bash
git add src/types/contracts.ts src/storage/postgres/persistence_contracts.ts
git commit -m "feat(groups): add type contracts for group info, posts, and post detail"
```

---

### Task 2: Add group route builders

**Objective:** Add URL builder functions for group pages and group post permalinks.

**Files:**
- Modify: `src/routes/facebook_routes.ts`

**Step 1:** Add functions:

```ts
export function buildGroupUrl(groupId: string): string {
  return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/`;
}

export function buildGroupPostUrl(groupId: string, postId: string): string {
  return `https://www.facebook.com/groups/${encodeURIComponent(groupId)}/posts/${encodeURIComponent(postId)}/`;
}
```

**Step 2:** Add a test in `tests/facebook_routes.test.ts` (or create it if it doesn't exist) verifying the URL encoding.

**Step 3:** Commit:

```bash
git add src/routes/facebook_routes.ts
git commit -m "feat(groups): add buildGroupUrl and buildGroupPostUrl"
```

---

### Task 3: Add schema versions and DB migrations

**Objective:** Create the PostgreSQL schema for groups and register schema versions.

**Files:**
- Create: `db/migrations/009_facebook_groups.sql`
- Create: `db/migrations/010_facebook_groups_views.sql`
- Modify: `src/storage/postgres/schema_versions.ts`

**Step 1:** Create `009_facebook_groups.sql` with the full schema from the "Database Schema" section above.

**Step 2:** Create `010_facebook_groups_views.sql` with the views from above.

**Step 3:** Add to `schema_versions.ts`:

```ts
groupInfo: '0.1.0',
groupPosts: '0.1.0',
groupPostDetail: '0.1.0',
```

**Step 4:** Run the DB migration:

```bash
cd /root/codebase/sm-auto && bun run src/cli/db_prepare.ts
```

Expected: migrations 009 and 010 applied.

**Step 5:** Verify tables exist:

```bash
psql -h 127.0.0.1 -U agent0 -d facebook_scraper -c "\dt scraper.facebook_group*"
```

**Step 6:** Commit:

```bash
git add db/migrations/ src/storage/postgres/schema_versions.ts
git commit -m "feat(groups): add PostgreSQL schema for groups, posts, and comments"
```

---

### Task 4: Add group DOM parser

**Objective:** Create DOM snapshot and parsing functions for group metadata (name, member count, privacy, etc.).

**Files:**
- Create: `src/parsers/dom/group_dom_parser.ts`

**Step 1:** Create the file with these functions following the `page_dom_parser.ts` pattern:

```ts
// Snapshot type — captured in browser context via page.evaluate()
export interface GroupDomSnapshot {
  title: string;
  url: string;
  headings: string[];
  spans: string[];
  links: Array<{ href: string; text: string }>;
  metaTags: Array<{ name: string; content: string }>;
}

// Capture function — runs inside page.evaluate()
export async function snapshotGroupDom(page: Page): Promise<GroupDomSnapshot> {
  return page.evaluate(() => {
    // Same pattern as snapshotPageDom: collect headings, spans, links, meta tags
    // Groups have <h1> with group name, spans with "X members", "Public group", etc.
    // meta[property='og:description'] often has member count + group type
    ...
  });
}

// Pure parse functions — operate on GroupDomSnapshot, not live page
export function parseGroupName(snapshot: GroupDomSnapshot): string | null { ... }
export function parseGroupMemberCount(snapshot: GroupDomSnapshot): number | null { ... }
export function parseGroupPrivacyType(snapshot: GroupDomSnapshot): string | null { ... }
export function parseGroupDescription(snapshot: GroupDomSnapshot): string | null { ... }
```

**Step 2:** Write tests with a mock `GroupDomSnapshot` fixture in `tests/group_dom_parser.test.ts`.

**Step 3:** Run tests:

```bash
cd /root/codebase/sm-auto && bun test tests/group_dom_parser.test.ts
```

**Step 4:** Commit:

```bash
git add src/parsers/dom/group_dom_parser.ts tests/group_dom_parser.test.ts
git commit -m "feat(groups): add group DOM parser with snapshot and parse functions"
```

---

### Task 5: Add group route identity parser

**Objective:** Extract groupId from route definition responses, following the `page_route_identity.ts` pattern.

**Files:**
- Create: `src/parsers/embedded/group_route_identity.ts`

**Step 1:** Create the file:

```ts
import type { RouteDefinitionRecord } from '../../capture/route_definition_capture';

// Route patterns that carry group identity
const GROUP_ROUTE_PATTERNS = [
  /GroupComet/i,
  /CometGroup/i,
  /GroupsComet/i,
];

export function extractGroupRouteIdentity(
  records: RouteDefinitionRecord[]
): { groupId: string | null; vanitySlug: string | null } {
  // Walk records.routes for matching route names
  // Extract groupID from route parameters (similar to page_route_identity.ts)
  ...
}
```

**Step 2:** Write a test with a mock route definition fixture.

**Step 3:** Commit:

```bash
git add src/parsers/embedded/group_route_identity.ts tests/group_route_identity.test.ts
git commit -m "feat(groups): add group route identity extraction from route definitions"
```

---

### Task 6: Add group GraphQL feed parser

**Objective:** Parse group feed GraphQL fragments to extract GroupPost[], following the `timeline_parser.ts` pattern.

**Files:**
- Create: `src/parsers/graphql/group_feed_parser.ts`

**Step 1:** Create the file with two functions:

```ts
import type { GraphQLFragment } from '../../types/contracts';
import { deepVisit, asRecord, getString, getNumber } from './shared_graphql_utils';
import type { GroupPost } from '../../types/contracts';

// Collect fragments relevant to group feed
export function collectGroupFeedFragments(fragments: GraphQLFragment[]): GraphQLFragment[] {
  return fragments.filter(fragment => {
    const friendlyName = fragment.request.friendlyName ?? '';
    if (/GroupCometFeed|GroupsCometFeed|GroupCometDiscussion/i.test(friendlyName)) {
      return true;
    }
    // Also check payload for group feed path markers
    return fragment.fragments.some(payload => hasGroupFeedPath(payload));
  });
}

// Parse collected fragments into GroupPost[]
export function parseGroupFeedFragments(fragments: GraphQLFragment[]): GroupPost[] {
  // Walk fragment payloads with deepVisit()
  // Find Story nodes (same __typename as page posts)
  // Extract: id, text, author, media, metrics, createdAt, permalink
  // Deduplicate by postId with scoring (prefer richer data)
  ...
}
```

**Step 2:** Write a test with a mock GraphQL fragment fixture. Create `fixtures/graphql/group_feed_fragment.json` with a sanitized real response (to be captured during first live test).

**Step 3:** Commit:

```bash
git add src/parsers/graphql/group_feed_parser.ts tests/group_feed_parser.test.ts fixtures/graphql/group_feed_fragment.json
git commit -m "feat(groups): add GraphQL group feed parser for post extraction"
```

---

### Task 7: Add group comment GraphQL parser

**Objective:** Parse post detail GraphQL fragments to extract comments and replies.

**Files:**
- Create: `src/parsers/graphql/group_comment_parser.ts`

**Step 1:** Create the file:

```ts
import type { GraphQLFragment } from '../../types/contracts';
import { deepVisit, asRecord, getString, getNumber } from './shared_graphql_utils';
import type { GroupPostComment } from '../../types/contracts';

// Collect fragments relevant to post comments
export function collectGroupCommentFragments(fragments: GraphQLFragment[]): GraphQLFragment[] {
  return fragments.filter(fragment => {
    const friendlyName = fragment.request.friendlyName ?? '';
    if (/CometUFI|Feedback|CommentMutation|UFIFeedback/i.test(friendlyName)) {
      return true;
    }
    return fragment.fragments.some(payload => hasCommentPath(payload));
  });
}

// Parse collected fragments into GroupPostComment[]
export function parseGroupCommentFragments(fragments: GraphQLFragment[]): GroupPostComment[] {
  // Walk fragments with deepVisit()
  // Find nodes with __typename === 'Comment'
  // Extract: id, parent (for replies), author, text, createdAt, reaction_count, reply_count
  // Deduplicate by commentId with scoring
  ...
}
```

**Step 2:** Write a test. Create `fixtures/graphql/group_comment_fragment.json`.

**Step 3:** Commit:

```bash
git add src/parsers/graphql/group_comment_parser.ts tests/group_comment_parser.test.ts fixtures/graphql/group_comment_fragment.json
git commit -m "feat(groups): add GraphQL comment parser for post detail"
```

---

### Task 8: Add group info normalizer

**Objective:** Assemble GroupInfoResult from parsed parts (DOM, route identity, embedded data).

**Files:**
- Create: `src/normalizers/group_info_normalizer.ts`

**Step 1:** Create the file:

```ts
import type { GroupInfoResult, DataProvenance } from '../types/contracts';

interface GroupInfoInput {
  groupId: string | null;
  url: string;
  name: string | null;
  vanitySlug: string | null;
  privacyType: string | null;
  groupType: string | null;
  memberCount: number | null;
  description: string | null;
  coverPhotoUrl: string | null;
  admins: Array<{ id: string | null; name: string | null; adminType: string | null }>;
  rules: string[];
  tags: string[];
  provenance?: Record<string, DataProvenance>;
}

export function normalizeGroupInfo(input: GroupInfoInput): GroupInfoResult {
  return {
    groupId: input.groupId,
    url: input.url,
    name: input.name,
    vanitySlug: input.vanitySlug,
    privacyType: input.privacyType,
    groupType: input.groupType,
    memberCount: input.memberCount,
    description: input.description,
    coverPhotoUrl: input.coverPhotoUrl,
    admins: input.admins,
    rules: input.rules,
    tags: input.tags,
    scrapedAt: new Date().toISOString(),
    provenance: input.provenance,
  };
}
```

**Step 2:** Write a unit test.

**Step 3:** Commit.

---

### Task 9: Add group post normalizer

**Objective:** Merge GraphQL post data with DOM metrics, following the `post_normalizer.ts` pattern.

**Files:**
- Create: `src/normalizers/group_post_normalizer.ts`

**Step 1:** Create the normalizer that merges `GroupPost[]` from GraphQL with DOM metric snapshots, matching posts by text similarity scoring (same approach as `normalizePosts` for page posts).

**Step 2:** Write a unit test.

**Step 3:** Commit.

---

### Task 10: Add group info extractor

**Objective:** Create the top-level `extractGroupInfo()` function that orchestrates Chrome navigation, capture setup, DOM snapshot, parsing, and normalization for a single group's metadata.

**Files:**
- Create: `src/extractors/group_info_extractor.ts`

**Step 1:** Create the file following the `extractPageInfo` pattern:

```ts
export async function extractGroupInfo(
  context: ScraperContext,
  groupUrl: string
): Promise<ExtractorResult<GroupInfoResult>> {
  const chrome = new ChromeClient(context.chromePort);
  const browser = await chrome.connect();
  const session = new PageSession(browser, context.timeoutMs);

  try {
    return await session.withPage(async (page) => {
      const capture = new GraphQLCapture();
      const routeCapture = new RouteDefinitionCapture();
      await capture.attach(page);
      await routeCapture.attach(page);
      const disableRequestFiltering = await enableMarketplaceRequestFiltering(page);

      try {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
        await waitForGroupSignals(page, context.timeoutMs); // wait for h1, "members", etc.
        await waitForCondition(() => routeCapture.records.length > 0, 5_000).catch(() => undefined);

        const domSnapshot = await snapshotGroupDom(page);
        const html = await page.content();
        const embeddedDocument = createEmbeddedDocumentFragment(page.url(), html);

        // Parse
        const name = parseGroupName(domSnapshot);
        const memberCount = parseGroupMemberCount(domSnapshot);
        const privacyType = parseGroupPrivacyType(domSnapshot);
        const description = parseGroupDescription(domSnapshot);
        const { groupId, vanitySlug } = extractGroupRouteIdentity(routeCapture.records);

        // Also visit /about sub-page for rules, admins, tags (if accessible)
        // ... navigate, wait, snapshot, parse ...

        const result = normalizeGroupInfo({
          groupId, url: groupUrl, name, vanitySlug, privacyType,
          groupType, memberCount, description, coverPhotoUrl,
          admins, rules, tags,
          provenance: { ... }
        });

        return { data: result, artifacts: { ... } };
      } finally {
        await capture.detach(page).catch(() => undefined);
        await routeCapture.detach(page).catch(() => undefined);
        await disableRequestFiltering().catch(() => undefined);
      }
    });
  } finally {
    await chrome.disconnect();
  }
}
```

**Step 2:** Commit.

---

### Task 11: Add group posts extractor (feed with scrolling)

**Objective:** Create `extractGroupPosts()` that scrolls the group feed and collects posts.

**Files:**
- Create: `src/extractors/group_posts_extractor.ts`

**Step 1:** Create the file following the `extractPagePosts` and `extractMarketplaceSearch` patterns. Key differences from page posts:
- Group feed URL is `/groups/{groupId}/`
- Uses `collectGroupFeedFragments` instead of `collectTimelineFragments`
- Stall detection with `maxStalledScrolls` (same as marketplace search)
- Returns `GroupPostsResult` instead of `PagePostsResult`

```ts
export async function extractGroupPosts(
  context: ScraperContext,
  groupUrl: string
): Promise<ExtractorResult<GroupPostsResult>> {
  // ChromeClient -> PageSession -> withPage
  // Attach GraphQLCapture + RouteDefinitionCapture
  // Navigate to groupUrl
  // Wait for group feed signals
  // Scroll group feed (same stall-detection loop as marketplace search)
  // Collect group feed fragments from GraphQL capture
  // Parse fragments -> GroupPost[]
  // Merge with DOM metrics
  // Extract groupId from route capture
  // Return { data: { groupId, url, posts, scrapedAt }, artifacts }
}
```

**Step 2:** Commit.

---

### Task 12: Add group post detail extractor (comments, replies, reactions)

**Objective:** Create `extractGroupPostDetail()` that opens a post permalink and captures comments.

**Files:**
- Create: `src/extractors/group_post_detail_extractor.ts`

**Step 1:** Create the file. This is the most complex extractor — it needs to:
1. Navigate to the post permalink URL
2. Wait for post content + comments to load
3. Scroll to load more comments (with stall detection)
4. Click "View more replies" buttons to expand nested replies
5. Collect comment fragments from GraphQL capture
6. Parse comments + replies with parent threading
7. Also capture the full post content (may have more data than the feed summary)

```ts
export async function extractGroupPostDetail(
  context: ScraperContext,
  postUrl: string
): Promise<ExtractorResult<GroupPostDetailResult>> {
  // ChromeClient -> PageSession -> withPage
  // Attach GraphQLCapture + RouteDefinitionCapture
  // Navigate to postUrl
  // Wait for post + comment signals
  // Scroll comments (with stall detection)
  // Expand reply threads (click "X replies" buttons, with a max expand limit)
  // Collect comment fragments from GraphQL capture
  // Parse fragments -> GroupPostComment[]
  // Also re-parse post from this page's fragments (may be richer than feed version)
  // Return { data: { postId, url, groupId, post, comments, totalCommentCount, scrapedAt }, artifacts }
}
```

**Key implementation detail — expanding reply threads:**

```ts
async function expandReplyThreads(page: Page, maxExpansions: number): Promise<void> {
  for (let i = 0; i < maxExpansions; i++) {
    // Find "X replies" or "View more replies" buttons that haven't been clicked
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll(
        'div[role="button"]'
      )).filter(el => /replies|Reply|View more/i.test(el.textContent ?? ''));

      if (buttons.length === 0) return false;
      (buttons[0] as HTMLElement).click();
      return true;
    });

    if (!clicked) break;
    await sleep(800); // Wait for reply content to load
  }
}
```

**Step 2:** Commit.

---

### Task 13: Add group repository (Postgres persistence)

**Objective:** Create the database persistence layer for groups.

**Files:**
- Create: `src/storage/postgres/group_repository.ts`
- Create: `src/storage/postgres/group_queue_repository.ts`

**Step 1:** Create `group_repository.ts` with:

```ts
// Upsert a group entity
export async function upsertFacebookGroup(client: PoolClient, group: { ... }): Promise<string>

// Upsert group admins (with is_active soft-delete pattern)
export async function upsertGroupAdmins(client: PoolClient, groupId: string, admins: Array<{ ... }>): Promise<void>

// Upsert group rules
export async function upsertGroupRules(client: PoolClient, groupId: string, rules: string[]): Promise<void>

// Upsert group tags
export async function upsertGroupTags(client: PoolClient, groupId: string, tags: string[]): Promise<void>

// Persist group info surface (wraps all above + inserts scrape record)
export async function persistGroupInfoSurface(client: PoolClient, scrapeRunId: string, result: GroupInfoResult): Promise<ScrapeRunCompletion>

// Upsert group posts (batch with unnest, following post_repository pattern)
export async function upsertGroupPosts(client: PoolClient, groupId: string, posts: GroupPost[]): Promise<void>

// Persist group posts surface
export async function persistGroupPostsSurface(client: PoolClient, scrapeRunId: string, result: GroupPostsResult): Promise<ScrapeRunCompletion>

// Upsert comments (batch)
export async function upsertGroupPostComments(client: PoolClient, postId: string, comments: GroupPostComment[]): Promise<void>

// Persist group post detail surface
export async function persistGroupPostDetailSurface(client: PoolClient, scrapeRunId: string, result: GroupPostDetailResult): Promise<ScrapeRunCompletion>
```

**Step 2:** Create `group_queue_repository.ts` with:

```ts
// Select group posts that haven't been detail-scraped yet (for bulk comment crawling)
export async function selectGroupPostsForDetailCrawl(client: PoolClient, options: {
  groupId?: string;
  uncrawledOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Array<{ post_id: string; group_id: string; permalink: string }>>

// Count candidates for detail crawl
export async function countGroupPostsForDetailCrawl(client: PoolClient, options: { ... }): Promise<number>
```

**Step 3:** Commit.

---

### Task 14: Add persistence factory functions

**Objective:** Wire up the persistence layer to the job runner.

**Files:**
- Modify: `src/storage/postgres/persistence.ts`

**Step 1:** Add three factory functions:

```ts
export function createGroupInfoPersistence(groupUrl: string): PostgresJobPersistence<GroupInfoResult> {
  return {
    start: { surface: 'group_info', schemaVersion: SCHEMA_VERSIONS.groupInfo, sourceUrl: groupUrl },
    persist: persistGroupInfoSurface,
  };
}

export function createGroupPostsPersistence(groupUrl: string): PostgresJobPersistence<GroupPostsResult> {
  return {
    start: { surface: 'group_posts', schemaVersion: SCHEMA_VERSIONS.groupPosts, sourceUrl: groupUrl },
    persist: persistGroupPostsSurface,
  };
}

export function createGroupPostDetailPersistence(postUrl: string): PostgresJobPersistence<GroupPostDetailResult> {
  return {
    start: { surface: 'group_post_detail', schemaVersion: SCHEMA_VERSIONS.groupPostDetail, sourceUrl: postUrl },
    persist: persistGroupPostDetailSurface,
  };
}
```

**Step 2:** Commit.

---

### Task 15: Add CLI entrypoints

**Objective:** Create the three CLI scripts for running group scrapers.

**Files:**
- Create: `src/cli/scrape_group_info.ts`
- Create: `src/cli/scrape_group_posts.ts`
- Create: `src/cli/scrape_group_post_detail.ts`
- Modify: `package.json` (add scripts)

**Step 1:** Create each CLI following the exact pattern from `scrape_page_info.ts`:

```ts
// scrape_group_info.ts
async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('url', { type: 'string', demandOption: true })
    .parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'group-info',
    outputName: 'group_info.json',
    run: (ctx) => extractGroupInfo(ctx, args.url),
    persistence: createGroupInfoPersistence(args.url)
  });
}
void main();
```

Similar for `scrape_group_posts.ts` (jobName: 'group-posts', outputName: 'group_posts.json') and `scrape_group_post_detail.ts` (adds `--post-url` arg, jobName: 'group-post-detail').

**Step 2:** Add to `package.json` scripts:

```json
"scrape:group-info": "bun run src/cli/scrape_group_info.ts",
"scrape:group-posts": "bun run src/cli/scrape_group_posts.ts",
"scrape:group-post-detail": "bun run src/cli/scrape_group_post_detail.ts"
```

**Step 3:** Commit.

---

### Task 16: Live smoke test against real group

**Objective:** Verify all three scrapers work against a real Facebook group.

**Step 1:** Run group info:

```bash
cd /root/codebase/sm-auto && bun run src/cli/scrape_group_info.ts \
  --url "https://www.facebook.com/groups/430419725850542/" \
  --persist-db=true --include-artifacts
```

**Step 2:** Inspect `output/group_info.json` — verify groupId, name, memberCount, privacyType are populated.

**Step 3:** Run group posts:

```bash
bun run src/cli/scrape_group_posts.ts \
  --url "https://www.facebook.com/groups/430419725850542/" \
  --max-scrolls 50 --persist-db=true
```

**Step 4:** Inspect `output/group_posts.json` — verify posts array is non-empty, post IDs are present, metrics look reasonable.

**Step 5:** Pick a post ID from the output and run detail scrape:

```bash
bun run src/cli/scrape_group_post_detail.ts \
  --post-url "https://www.facebook.com/groups/430419725850542/posts/{postId}/" \
  --max-scrolls 50 --persist-db=true
```

**Step 6:** Inspect `output/group_post_detail.json` — verify comments array is non-empty, parent threading is correct, reaction counts present.

**Step 7:** Fix any issues found during live testing. Update GraphQL friendly name patterns in `group_feed_parser.ts` and `group_comment_parser.ts` based on actual captured data. Update DOM selectors in `group_dom_parser.ts` if needed.

**Step 8:** Commit fixes.

---

### Task 17: Add bulk group post detail crawler

**Objective:** Create a bulk crawler that iterates uncrawled group posts and scrapes comments for each, following the marketplace bulk pattern.

**Files:**
- Create: `src/cli/scrape_group_post_details.ts` (bulk CLI)

**Step 1:** Create the bulk CLI following the `scrape_marketplace_listings.ts` / `marketplace_bulk.ts` pattern:

- Uses `group_queue_repository.selectGroupPostsForDetailCrawl()` to find posts without comment data
- Iterates with `DelayPlanner` for humanized pacing
- Creates child `ScraperContext` per post with entity-specific output dir
- Calls `extractGroupPostDetail()` for each

**Step 2:** Add to `package.json`:

```json
"scrape:group-post-details-bulk": "bun run src/cli/scrape_group_post_details.ts"
```

**Step 3:** Commit.

---

### Task 18: Update documentation

**Objective:** Update all docs to cover the new group scraping capabilities.

**Files:**
- Modify: `docs/run_scraper.md` — add group CLI examples
- Modify: `docs/RESUME.md` — update known gaps, add groups to scope
- Modify: `docs/output_schemas.md` — add group output schemas
- Modify: `docs/selectors_and_queries.md` — add group GraphQL friendly names and DOM selectors discovered during live testing
- Modify: `README.md` — add groups to scope

**Step 1:** Update each doc file.

**Step 2:** Commit and push.

---

## Risk Areas and Open Questions

1. **GraphQL friendly names are not yet confirmed.** The parser uses pattern matching (`/GroupCometFeed|GroupsCometFeed/i`) but the actual names will be discovered during the live smoke test (Task 16). The `include-artifacts` flag captures raw fragments for inspection.

2. **Private group access.** If the Chrome session isn't a member of a private group, the scraper will hit a login wall or "This content isn't available." The extractor should detect this and return a clear error rather than hanging.

3. **Comment pagination.** Facebook uses "View more comments" buttons that may load via GraphQL mutations rather than scroll pagination. The comment extractor may need to click these buttons rather than just scrolling, depending on the group's UI. Task 12 includes an `expandReplyThreads` helper for this.

4. **Rate limiting.** Group scraping is heavier per page than marketplace search because each post detail is a separate page load. The bulk crawler (Task 17) uses `DelayPlanner` with humanized pacing, but we may need to increase delays if Facebook throttles.

5. **Group about page.** Not all groups expose a `/about` sub-page with rules, admins, and tags. The extractor should handle 404s gracefully and fall back to what's available on the main group page.

6. **Comment depth.** Facebook typically nests replies 1-2 levels deep. The schema supports arbitrary depth via `parent_comment_id`, but the scraper should limit reply expansion to avoid infinite loops (Task 12 caps `maxExpansions`).

---

## Estimated Timeline

| Tasks | Description | Effort |
|-------|-------------|--------|
| 1-3 | Types, routes, schema | 30 min |
| 4-5 | DOM parser, route identity | 45 min |
| 6-7 | GraphQL parsers | 1.5 hr |
| 8-9 | Normalizers | 30 min |
| 10-12 | Extractors (core logic) | 2 hr |
| 13-14 | Postgres persistence | 1 hr |
| 15 | CLI entrypoints | 20 min |
| 16 | Live smoke test + fixes | 1-2 hr |
| 17 | Bulk detail crawler | 45 min |
| 18 | Documentation | 30 min |
| **Total** | | **~7-9 hr** |
