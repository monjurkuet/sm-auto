# Facebook Groups Scraper — System Report

**Last updated:** 2026-05-01  
**Codebase:** `/root/codebase/sm-auto`

---

## 1. System Overview

The Facebook Groups scraper is a production monitoring system that periodically scrapes registered Facebook groups, extracts posts with metrics, crawls comments/replies, and scores group vitality. It runs alongside the existing Facebook Marketplace scraper on the same Chrome instance.

### Architecture

```
Cron (every 6h)
  └── group_monitor.sh
        ├── Phase 1: Group Info Scrape (daily per registry interval)
        ├── Phase 2: Group Posts Scrape (every 6h per registry interval)
        ├── Phase 3: Post Detail Crawl (queue-based, up to 30 posts)
        └── Phase 4: Vitality Computation (Python scoring)

Cron (every 4h)
  └── scrape_group_post_details.ts --limit 20
        └── Continuous queue-based comment/reply crawling
```

Data flow per surface:

```
CLI → runCli → Extractor → [GraphQLCapture + DOM Snapshot + Embedded Parser]
                                     ↓
                              Parser (GraphQL + Embedded)
                                     ↓
                              Normalizer
                                     ↓
                              Postgres Persistence
```

---

## 2. Scraper Surfaces

### Surface 1: Group Info (`scrape_group_info.ts`)

Extracts group metadata from a Facebook group page.

| Field | Source | Coverage |
|-------|--------|----------|
| group_id | URL + route definitions + embedded data | 100% |
| name | DOM + embedded data | 100% |
| privacy_type | DOM span ("Public group" / "Private group") | 100% |
| member_count | DOM span ("254.5K members") + embedded | 100% |
| description | Embedded `group.description.text` | ~80% |
| cover_photo_url | Embedded `GroupsCometCoverPhotoRenderer` | 100% |
| admins | Embedded `GroupsAboutFeedAboutCardUnit` | Partial (structure varies) |
| rules | Embedded `GroupsAboutFeedRulesCardUnit` | Partial (structure varies) |
| tags | Embedded `GroupTag` nodes | Partial |

**Extractor:** `group_info_extractor.ts`  
**Embedded parser:** `group_info_embedded_parser.ts`  
**Normalizer:** `group_info_normalizer.ts`

### Surface 2: Group Posts (`scrape_group_posts.ts`)

Scrolls the group feed and extracts post summaries.

| Field | Source | Coverage |
|-------|--------|----------|
| postId | `story_key` / `post_id` / base64 decode | 100% |
| text | `comet_sections.content.story.message.text` | 97% |
| author | `node.actors[0].name` / `node.actor` | 97% |
| reactions | Two-phase Feedback merge + UFI renderer | 100% |
| comments | `comment_rendering_instance.comments.total_count` | 100% |
| shares | `share_count.count` | 94% |
| created_at | `comet_sections.timestamp.story.creation_time` | 97% |
| permalink | `node.permalink_url` / `node.url` | 100% |
| media | `attachments[].styles.attachment.all_subattachments.nodes[].media` | 47% |

**Extractor:** `group_posts_extractor.ts`  
**Parser:** `group_feed_parser.ts`  
**Normalizer:** `group_post_normalizer.ts`

Key parsing techniques:
- **Two-phase Feedback merge**: Phase 1 collects standalone Feedback nodes, decodes their base64 IDs (`ZmVlZGJhY2s6MTMx...` → `feedback:POSTID`), extracts metrics from `comet_ufi_summary_and_actions_renderer.feedback`. Phase 2 parses Story nodes and merges metrics by matching `post.postId === decodedFeedbackPostId`.
- **Comet rendering architecture**: Text and metrics are NOT at the Story node top level. Text is inside `comet_sections.content.story.message.text`. Metrics are in a separate Feedback node with matching ID.
- **Path A (feed pages)**: `feedbackSection.story_ufi_container → story → feedback_context → feedback_target_with_context`
- **Path B (detail pages)**: `feedbackSection.story → story_ufi_container → story → feedback_context → feedback_target_with_context` (extra `.story` layer)
- **Base64 ID extraction**: Compound entity IDs like `UzpfSTYxNTY2...:VK:1315106307381875` are decoded and the trailing numeric post ID is extracted.
- **Ghost post filtering**: Posts with no text, no author, and all-null metrics are discarded after Feedback merge.
- **DOM snapshot capture**: Every 5 scrolls, a DOM snapshot is taken to prevent losing posts that scroll out of the viewport (Facebook's virtual scrolling removes off-screen nodes).
- **Stall detection**: Monitors 4 signals: `fragmentCount`, `totalGraphQLResponseCount`, `postLinkCount`, `scrollHeight`. Terminates after 15 consecutive no-progress scrolls.

### Surface 3: Post Detail (`scrape_group_post_detail.ts`)

Opens a post permalink and extracts full comments with nested replies.

| Field | Source | Coverage |
|-------|--------|----------|
| comments | Embedded `__typename=Comment` nodes | Extracted |
| comment.id | Base64 decode (`comment:POSTID_COMMENTID`) | 100% |
| comment.text | `body.text` | 88% (null for emoji-only) |
| comment.author | `author.name` | 100% |
| comment.created_at | `timestamp` / `created_time` | 100% |
| comment.parent | `comment_direct_parent.id` (decoded) | Available |
| comment.reactions | Not available in embedded data | Always null |
| reply expansion | "View X replies" click + scroll | Up to 50 replies |

**Extractor:** `group_post_detail_extractor.ts`  
**Parser:** `group_comment_parser.ts`

Comment extraction techniques:
- Embedded document fragments are the primary data source (detail pages don't produce relevant GraphQL API responses).
- Comments are filtered by post ID prefix (`comment.id.startsWith(effectivePostId + '_')`).
- Reply expansion uses click-to-expand with humanized delays and a max expansion cap.
- Base64-encoded comment IDs and parent IDs are decoded using `Buffer.from(id, 'base64').toString('utf-8')`.
- Two-phase Feedback merge for comment reply counts (same pattern as post metrics).

### Surface 3b: Bulk Detail Crawler (`scrape_group_post_details.ts`)

Queue-based batch crawler that processes posts not yet detail-scraped.

- Selects posts from `facebook_group_posts` that have no entry in `facebook_group_comment_scrapes`
- Processes up to `--limit` posts per run with humanized delays
- Uses composite ID encoding (`postId::groupId`) to fit the bulk command interface
- Delay modes: `off`, `fixed`, `humanized` (default) with burst pauses every 4-8 items
- Error recovery: `--continue-on-error` (default true) with configurable error delay multiplier

---

## 3. Monitoring System

### Group Registry (`facebook_group_registry`)

Tracks which groups to monitor and how often:

| Column | Type | Description |
|--------|------|-------------|
| group_url | TEXT PK | Canonical Facebook group URL |
| group_id | TEXT UNIQUE | Numeric group ID (populated after first info scrape) |
| name | TEXT | Cached group name |
| priority | SMALLINT | 1=critical, 10=low (default 5) |
| is_active | BOOLEAN | Whether to include in monitoring cycles |
| relevance_score | SMALLINT | 0-100 vitality score |
| info_scrape_interval_hrs | SMALLINT | How often to scrape group info (default 24) |
| posts_scrape_interval_hrs | SMALLINT | How often to scrape posts (default 6) |
| last_info_scrape_at | TIMESTAMPTZ | Timestamp of last info scrape |
| last_posts_scrape_at | TIMESTAMPTZ | Timestamp of last posts scrape |
| added_at | TIMESTAMPTZ | When the group was added |
| notes | TEXT | Free-form notes |

### Vitality Scoring (0-100)

Computed by `scripts/compute_group_vitality.py`:

| Factor | Max Points | Formula |
|--------|-----------|---------|
| Posting frequency | 30 | avg posts/day over last 7d, capped at 10/day → 30pts |
| Engagement rate | 25 | (avg reactions+comments+shares) / member_count × 1000, capped |
| Comment density | 20 | avg comments per post, capped at 20 |
| Member count | 15 | log₁₀ scale: 100→0, 1M→15 |
| Organic conversation | 10 | ratio of posts with 5+ comments |

### Cron Schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `group_monitor.sh` | `30 0,6,12,18 * * *` | Full pipeline every 6h |
| `scrape_group_post_details.ts` | `15 2,6,10,14,18,22 * * *` | Detail crawl every 4h (20 posts/run) |

### Currently Monitored Groups

| Group | ID | Members | Priority | Vitality | Privacy | Posts |
|-------|-----|---------|----------|----------|---------|-------|
| Crypto Community ✔️ | 498188334234453 | 836K | 3 | 46 | Public | 6 |
| Bangladesh Investors Alliance | 117843491401430 | 105K | 5 | 26 | Public | 7 |
| iphone (Apple) User BD | 430419725850542 | 255K | — | 21 | Public | 14 |
| Binance Exchange Help BD | 1163744920338154 | 105K | 5 | 12 | Public | 3 |
| Bangladesh Crypto Community BCC | 744625853485107 | 524 | 3 | 12 | Public | 22 |
| BD Crypto & Forex পরিবার | 220173140445218 | 32K | 5 | 11 | Public | 6 |
| Binance Bangladesh | 1961521867349725 | 31K | 3 | 10 | Public | 3 |
| Growing Bulls Community | 276632390946258 | 41K | 3 | 9 | Private | 0 |
| ~~YTCryptodada~~ | — | — | — | — | Page | Disabled |

Two legacy groups (Crypto & Web3 Career Community, Binance community of Bangladesh) exist in `facebook_groups` but aren't in the registry yet — they were scraped during earlier testing.

---

## 4. Database Schema

### Core Tables

| Table | Rows | Description |
|-------|------|-------------|
| `facebook_groups` | 10 | Group entity with vitality metrics |
| `facebook_group_registry` | 8 | Monitoring configuration |
| `facebook_group_posts` | 75 | Post entity (post_id PK, group_id FK) |
| `facebook_group_post_media` | 67 | Photos/videos per post |
| `facebook_group_post_comments` | 10 | Flat comments with parent_comment_id |
| `facebook_group_admins` | 0 | Admin/moderator users |
| `facebook_group_rules` | 0 | Group rules with position |
| `facebook_group_tags` | 0 | Topics/tags |
| `facebook_group_post_metrics_history` | 6 | Time-series snapshots |

### Scrape Tracking Tables

| Table | Rows | Description |
|-------|------|-------------|
| `facebook_group_info_scrapes` | 10 | Info scrape snapshots |
| `facebook_group_post_scrapes` | 74 | Post scrape snapshots |
| `facebook_group_comment_scrapes` | 95 | Comment scrape snapshots |

### Analytics Views

| View | Description |
|------|-------------|
| `v_group_vitality` | Dashboard: group scores, post counts, last scrape times |
| `v_top_posts_7d` | Top 100 posts by engagement in last 7 days |
| `v_groups_needing_posts_scrape` | Groups overdue for posts scrape (for orchestrator) |
| `v_groups_needing_info_scrape` | Groups overdue for info scrape (for orchestrator) |
| `v_latest_group_info` | Latest info scrape per group |
| `v_latest_group_posts` | Latest posts scrape per group |

### Migrations

| # | File | Description |
|---|------|-------------|
| 009 | `facebook_groups.sql` | Core group tables |
| 010 | `facebook_groups_views.sql` | Read views |
| 011 | `group_surfaces_constraint.sql` | Add group surfaces to scrape_runs CHECK |
| 012 | `group_post_media_unique_index.sql` | Unique index for ON CONFLICT |
| 013 | `group_registry.sql` | Registry, vitality columns, metrics history, analytics views |

---

## 5. File Map

### CLI Entry Points
```
src/cli/scrape_group_info.ts          — Single group info scrape
src/cli/scrape_group_posts.ts         — Single group feed scrape with scrolling
src/cli/scrape_group_post_detail.ts   — Single post detail (comments/replies)
src/cli/scrape_group_post_details.ts  — Bulk queue-based detail crawler
```

### Extractors
```
src/extractors/group_info_extractor.ts        — Group metadata extraction
src/extractors/group_posts_extractor.ts       — Feed scrolling with stall detection
src/extractors/group_post_detail_extractor.ts — Post detail with comment expansion
```

### Parsers
```
src/parsers/graphql/group_feed_parser.ts       — Story node → GroupPost (two-phase Feedback merge)
src/parsers/graphql/group_comment_parser.ts    — Comment extraction with base64 ID decode
src/parsers/embedded/group_info_embedded_parser.ts — Embedded document group metadata
src/parsers/embedded/group_route_identity.ts        — Route definition group ID/slug extraction
```

### Normalizers
```
src/normalizers/group_info_normalizer.ts  — Raw group data → normalized GroupInfo
src/normalizers/group_post_normalizer.ts  — Raw post data → normalized GroupPost
```

### Storage
```
src/storage/postgres/group_repository.ts       — CRUD for groups, posts, comments, media
src/storage/postgres/group_queue_repository.ts — Queue queries for detail crawl candidates
```

### Orchestration
```
scripts/group_monitor.sh              — Main 4-phase pipeline (bash)
scripts/compute_group_vitality.py     — Vitality scoring (Python + psycopg3)
```

### Docs
```
docs/plans/2026-04-29-facebook-groups-scraper.md  — Original design plan
docs/plans/2026-05-01-group-monitoring-system.md  — Monitoring system design
docs/FACEBOOK_GROUPS_REPORT.md                    — This report
```

---

## 6. Data Quality (as of 2026-05-01)

### Posts: 75 total across 9 groups

| Metric | Count | Percentage |
|--------|-------|------------|
| With reactions | 75 | 100% |
| With comments | 75 | 100% |
| With shares | 74 | 99% |
| With text | 71 | 95% |
| With media | 35 (67 items) | 47% |
| With author | 71 | 95% |
| With permalink | 75 | 100% |
| With created_at | 71 | 95% |
| Ghost posts | 0 | 0% |
| Base64 post IDs | 0 | 0% |

### Comments: 10 total

| Metric | Count | Percentage |
|--------|-------|------------|
| With text | 9 | 90% |
| With author | 10 | 100% |
| With created_at | 10 | 100% |
| With parent (replies) | 1 | 10% |
| With reactions | 0 | 0% (Facebook limitation) |

---

## 7. Known Limitations

1. **Comment reaction counts are always null.** Facebook doesn't include comment-level reaction data in embedded documents. Only available via live GraphQL during active comment scrolling.

2. **Private groups return 0 posts.** The Growing Bulls Community (Private) returns no posts because the Chrome session is not a member. The info scrape works but shows `privacy_type = Private`.

3. **Some comments have null text.** Emoji-only or attachment-only comments have `body: null`. These are stored with null `text_content`.

4. **Group admins/rules/tags extraction is partial.** The embedded parser handles standard patterns but Facebook's about page uses card renderer components with nested structures that need deeper investigation.

5. **Detail page can match wrong post.** Mixed-content pages (Reels + group posts) may return a sidebar post instead of the URL's target post. The `find(p => p.postId === postIdFromUrl)` fallback mitigates this.

6. **Comment crawl coverage is low.** Only 10 comments from 75 posts. The detail crawl cron (every 4h, 20 posts/run) will gradually increase this. At current rate: ~3-4 full cycles to cover all 75 posts.

7. **Two groups not in registry.** `Crypto & Web3 Career Community Bangladesh` (963612522046155) and `Binance community of Bangladesh` (963934784182695) exist in `facebook_groups` from earlier testing but aren't in the monitoring registry.

---

## 8. What's Not Yet Implemented

- **Group post alerts/reports** — No Telegram notifications for high-engagement group posts (unlike marketplace which has full Telegram reporting)
- **Trend analysis queries** — The `facebook_group_post_metrics_history` table has snapshots but no SQL queries or visualizations for trends over time
- **Cross-post detection** — No detection of the same post appearing in multiple groups
- **Author profiling** — No tracking of prolific authors across groups
- **Private group support** — No login-wall detection or membership-based scraping
- **Admin/rules/tags full extraction** — The card renderer structures need mapping
- **Comment reaction extraction** — Would require simulating GraphQL comment scrolling
