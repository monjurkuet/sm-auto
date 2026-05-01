# Facebook Group Scraper v2 — Enhanced Features Plan

**Date:** 2026-05-01
**Author:** GPT-5.4 architecture review
**Status:** PLANNING — not yet implemented

## Goals

1. **Group join automation** — Send join requests to groups not yet joined, track membership status
2. **Group discovery** — Search Facebook for new groups matching keywords, evaluate and add to registry
3. **Randomized interleaved scraping** — Mix scraping activities (info, posts, detail, comments) in a randomized order with configurable weights, not rigid phases
4. **YAML configuration** — All settings in a single `group_monitor.yaml` file

---

## 1. Group Join Automation

### 1.1 Membership Tracking

Add to `facebook_group_registry`:

```sql
ALTER TABLE scraper.facebook_group_registry ADD COLUMN IF NOT EXISTS
  membership_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (membership_status IN ('unknown', 'not_joined', 'pending', 'joined', 'declined', 'left'));

ALTER TABLE scraper.facebook_group_registry ADD COLUMN IF NOT EXISTS
  join_requested_at TIMESTAMPTZ;

ALTER TABLE scraper.facebook_group_registry ADD COLUMN IF NOT EXISTS
  join_status_checked_at TIMESTAMPTZ;
```

Status flow:
```
unknown → not_joined → pending → joined
                      ↘ declined
joined → left
```

### 1.2 Join Detection

When `extractGroupInfo` navigates to a group page, detect membership status from DOM signals:

- **Joined**: Page shows the group feed (post cards, "Write something" box, "Group info" tab). The URL stays at `/groups/GROUPID/`. No join button visible.
- **Not joined (public)**: Page shows a limited preview with a prominent "Join group" button (`div[role="button"]` containing text "Join group" or "Join"). May see some posts but no posting capability.
- **Not joined (private)**: Page shows "This group is private" with a "Request to join" button. The URL may redirect to `/groups/GROUPID/about/`.
- **Pending**: Page shows "Membership pending" or "You've requested to join" text. No join button visible.
- **Declined**: Page shows a message like "You were declined" or blocks access. Rare.

Detection implementation: in `extractGroupInfo`, after page load and `waitForGroupSignals`, evaluate the DOM:

```typescript
const membershipStatus = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], a[role="button"]'));
  const buttonTexts = buttons.map(b => (b.textContent || '').trim().toLowerCase());

  // Check for pending state
  if (document.body.textContent?.toLowerCase().includes('membership pending') ||
      document.body.textContent?.toLowerCase().includes("you've requested to join")) {
    return 'pending';
  }

  // Check for declined
  if (document.body.textContent?.toLowerCase().includes('declined') &&
      document.body.textContent?.toLowerCase().includes('request')) {
    return 'declined';
  }

  // Check for join/request buttons
  if (buttonTexts.some(t => t.includes('request to join'))) return 'not_joined'; // private group
  if (buttonTexts.some(t => t === 'join group' || t === 'join')) return 'not_joined'; // public group

  // If we see the feed with posting capability, we're joined
  const hasWriteBox = document.querySelector('[contenteditable="true"][role="textbox"]');
  const hasGroupFeed = document.querySelector('[role="feed"]');
  if (hasWriteBox || hasGroupFeed) return 'joined';

  return 'unknown';
});
```

This detection piggybacks on the existing `extractGroupInfo` call — no extra navigation needed. The result updates `facebook_group_registry.membership_status`.

### 1.3 Join Action

New extractor: `src/extractors/group_join_extractor.ts`

```typescript
export async function joinGroup(
  context: ScraperContext,
  groupUrl: string
): Promise<{ status: 'joined' | 'pending' | 'already_joined' | 'failed' }>
```

Implementation:
1. Navigate to group URL
2. Wait for page signals (reuse `waitForGroupSignals`)
3. Check current membership status (same detection as above)
4. If already joined/pending → return early
5. Find and click the "Join group" or "Request to join" button
6. Wait for confirmation (button text changes to "Membership pending" or button disappears)
7. Handle popups: Facebook may show a "Answer questions" dialog for private groups — detect `textarea` or `input` elements in a modal, skip if questions required (log and return `failed`)
8. Return the new status

Safety:
- Never join more than `max_joins_per_run` groups per cycle (default: 3)
- Respect `min_join_interval_ms` between join actions (default: 30000 — 30 seconds)
- Only attempt joins for groups with `is_active = true AND membership_status IN ('unknown', 'not_joined')`
- Never re-attempt groups that were `declined`
- Log every join attempt to `scraper.scrape_runs` with surface `group_join`

### 1.4 CLI

```
src/cli/scrape_group_join.ts — Join a single group by URL
```

Usage: `bun run src/cli/scrape_group_join.ts --url <GROUP_URL>`

---

## 2. Group Discovery

### 2.1 Search Surface

Facebook group search URL: `https://www.facebook.com/search/groups/?q=KEYWORD`

The search results page shows group cards with: name, member count, privacy type, and a "Join" button. We can extract these without joining.

New extractor: `src/extractors/group_search_extractor.ts`

```typescript
export interface GroupSearchResult {
  name: string;
  url: string;
  groupId: string | null;
  memberCount: number | null;
  privacyType: string | null;
  description: string | null;
}

export async function searchGroups(
  context: ScraperContext,
  query: string,
  options?: { maxScrolls?: number }
): Promise<GroupSearchResult[]>
```

Implementation:
1. Navigate to `https://www.facebook.com/search/groups/?q=ENCODED_QUERY`
2. Wait for search results to load
3. Scroll and collect group cards (similar pattern to `extractGroupPosts` — stall detection)
4. Parse group cards from DOM: each card is a clickable element containing group name (link to `/groups/ID`), member count span, privacy span
5. Also capture embedded document fragments for richer data (member counts from embedded are more reliable than DOM text parsing)
6. Deduplicate by group URL
7. Return results

### 2.2 Discovery Evaluation

After search, evaluate each result against quality criteria before adding to registry:

```python
# In compute_group_vitality.py or a new script
def should_add_group(result, config):
    min_members = config.get('discovery_min_members', 100)
    max_members = config.get('discovery_max_members', 10_000_000)
    require_public = config.get('discovery_require_public', False)

    if result.member_count and result.member_count < min_members:
        return False, f"Too few members ({result.member_count} < {min_members})"
    if result.member_count and result.member_count > max_members:
        return False, f"Too many members ({result.member_count} > {max_members})"
    if require_public and result.privacy_type != 'Public':
        return False, f"Not public ({result.privacy_type})"
    return True, "Meets criteria"
```

### 2.3 Auto-Registration

If a discovered group passes evaluation AND isn't already in the registry:
1. INSERT into `facebook_group_registry` with `priority = discovery_default_priority` (from config), `membership_status = 'unknown'`, `notes = 'Auto-discovered via search: QUERY'`
2. The next monitoring cycle will pick it up for info scrape and further evaluation

### 2.4 CLI

```
src/cli/scrape_group_search.ts — Search for groups by keyword
```

Usage: `bun run src/cli/scrape_group_search.ts --query "crypto bangladesh" --max-scrolls 5`

---

## 3. Randomized Interleaved Scraping

### 3.1 Problem with Current Approach

The current `group_monitor.sh` runs activities in rigid phases:
```
Phase 1: ALL info scrapes → Phase 2: ALL post scrapes → Phase 3: Detail crawl → Phase 4: Vitality
```

This is predictable and unnatural. A real user would:
- Check one group's feed
- Read some comments on a post
- Search for new groups
- Check another group
- Join a group
- Read more comments

### 3.2 Task Scheduler Design

Replace the phase-based bash script with a TypeScript orchestrator that:

1. Builds a **task queue** from the registry and config
2. **Shuffles** the queue with weighted randomness
3. Executes tasks one at a time, sharing the Chrome instance
4. Applies humanized delays between tasks
5. Respects per-task-type rate limits

Task types:
```typescript
type TaskType =
  | 'info_scrape'      // scrape group info
  | 'posts_scrape'     // scrape group feed
  | 'detail_crawl'     // crawl post comments
  | 'join_group'       // send join request
  | 'search_groups'    // search for new groups
  | 'compute_vitality' // update vitality scores
  | 'check_membership' // re-check membership status
```

Each task type has:
- **weight**: how likely this task type appears in the queue (controls proportion)
- **max_per_run**: cap on how many of this type can run per cycle
- **cooldown_ms**: minimum time between consecutive tasks of same type
- **delay_range**: [min_ms, max_ms] delay after completing this task type

### 3.3 Task Queue Construction

```typescript
function buildTaskQueue(config: MonitorConfig, registry: GroupRegistry): Task[] {
  const tasks: Task[] = [];

  // Info scrape: groups overdue by info_scrape_interval_hrs
  if (config.phases.info_scrape.enabled) {
    const overdue = registry.getGroupsNeedingInfoScrape();
    for (const g of overdue.slice(0, config.phases.info_scrape.max_per_run)) {
      tasks.push({ type: 'info_scrape', groupUrl: g.group_url, groupId: g.group_id });
    }
  }

  // Posts scrape: groups overdue by posts_scrape_interval_hrs
  if (config.phases.posts_scrape.enabled) {
    const overdue = registry.getGroupsNeedingPostsScrape();
    for (const g of overdue.slice(0, config.phases.posts_scrape.max_per_run)) {
      tasks.push({ type: 'posts_scrape', groupUrl: g.group_url, groupId: g.group_id });
    }
  }

  // Detail crawl: posts without comments
  if (config.phases.detail_crawl.enabled) {
    const uncrawled = registry.getUncrawledPosts(config.phases.detail_crawl.limit);
    for (const p of uncrawled) {
      tasks.push({ type: 'detail_crawl', postId: p.post_id, groupId: p.group_id });
    }
  }

  // Join groups
  if (config.phases.join_group.enabled) {
    const joinable = registry.getJoinableGroups(config.phases.join_group.max_per_run);
    for (const g of joinable) {
      tasks.push({ type: 'join_group', groupUrl: g.group_url });
    }
  }

  // Search groups
  if (config.phases.search_groups.enabled) {
    for (const query of config.phases.search_groups.queries) {
      tasks.push({ type: 'search_groups', query });
    }
  }

  // Vitality (always add once)
  if (config.phases.compute_vitality.enabled) {
    tasks.push({ type: 'compute_vitality' });
  }

  // Membership status check
  if (config.phases.check_membership.enabled) {
    const stale = registry.getStaleMembershipChecks(config.phases.check_membership.max_per_run);
    for (const g of stale) {
      tasks.push({ type: 'check_membership', groupUrl: g.group_url });
    }
  }

  return shuffleByWeight(tasks, config);
}
```

### 3.4 Weighted Shuffle

Not a pure random shuffle. Tasks are grouped by type, then each group is distributed across the queue using a **stride** pattern with jitter:

```typescript
function shuffleByWeight(tasks: Task[], config: MonitorConfig): Task[] {
  // Group tasks by type
  const byType = new Map<TaskType, Task[]>();
  for (const t of tasks) byType.set(t.type, [...(byType.get(t.type) || []), t]);

  // Shuffle each group independently
  for (const [type, group] of byType) {
    shuffleArray(group);
  }

  // Interleave: distribute high-weight types more frequently
  // E.g., if posts_scrape weight=4 and join_group weight=1,
  // we get roughly 4 post scrapes for every 1 join attempt
  const result: Task[] = [];
  const weights = Object.fromEntries(
    [...byType.keys()].map(t => [t, config.phases[t]?.weight ?? 1])
  );

  // Round-robin with weight: each type gets `weight` slots per round
  while ([...byType.values()].some(g => g.length > 0)) {
    for (const [type, group] of byType) {
      if (group.length === 0) continue;
      const w = weights[type] ?? 1;
      for (let i = 0; i < w && group.length > 0; i++) {
        result.push(group.shift()!);
      }
    }
  }

  // Add jitter: swap adjacent pairs with 30% probability
  for (let i = 0; i < result.length - 1; i++) {
    if (Math.random() < 0.3) {
      [result[i], result[i + 1]] = [result[i + 1], result[i]];
    }
  }

  return result;
}
```

### 3.5 Execution Loop

```typescript
async function runMonitorCycle(config: MonitorConfig): Promise<void> {
  const registry = await loadRegistry();
  const taskQueue = buildTaskQueue(config, registry);
  const planner = createDelayPlanner(config.delays);

  console.log(`[MONITOR] Built task queue: ${taskQueue.length} tasks`);
  console.log(`[MONITOR] Task breakdown: ${summarizeTasks(taskQueue)}`);

  for (const task of taskQueue) {
    console.log(`[MONITOR] Running: ${task.type} ${task.groupUrl ?? task.query ?? task.postId ?? ''}`);

    try {
      await executeTask(task, config);
      await plannerDelay(planner, 'success');
    } catch (err) {
      console.error(`[MONITOR] Failed: ${task.type} — ${err.message}`);
      await plannerDelay(planner, 'failure');
    }

    // Check if we've exceeded the max runtime for this cycle
    if (Date.now() - cycleStart > config.max_cycle_runtime_ms) {
      console.log(`[MONITOR] Cycle runtime limit reached. Stopping early.`);
      break;
    }
  }
}
```

---

## 4. YAML Configuration

### 4.1 Config File: `group_monitor.yaml`

```yaml
# ── Facebook Group Monitor Configuration ──

# Global settings
chrome_port: 9222
max_cycle_runtime_minutes: 45        # Hard cap on how long a single cycle can run
db_persist: true                     # Persist results to PostgreSQL

# Delay settings (applied between ALL tasks)
delays:
  mode: humanized                    # off | fixed | humanized
  base_ms: 3000                      # Base delay between tasks
  jitter_ms: 2000                    # Random jitter added to base
  burst_pause_every_min: 4           # Min tasks before a burst pause
  burst_pause_every_max: 8           # Max tasks before a burst pause
  burst_pause_min_ms: 15000          # Min burst pause duration
  burst_pause_max_ms: 45000          # Max burst pause duration
  error_backoff_multiplier: 1.75     # Multiply delay after errors

# ── Phase Configuration ──
# Each phase can be enabled/disabled, has its own limits,
# and contributes a weight to the task scheduler.
# Higher weight = more tasks of this type in the queue.

phases:
  info_scrape:
    enabled: true
    weight: 1                         # Low weight: info doesn't change often
    max_per_run: 10                   # Max groups to info-scrape per cycle
    default_interval_hours: 24       # Override registry interval if not set

  posts_scrape:
    enabled: true
    weight: 4                         # High weight: this is the primary activity
    max_per_run: 10
    default_interval_hours: 6
    max_scrolls: 15

  detail_crawl:
    enabled: true
    weight: 3                         # Second most common: reading comments
    limit: 30                         # Max posts to detail-crawl per cycle

  join_group:
    enabled: false                    # Off by default — enable when ready
    weight: 1
    max_per_run: 3                    # Never join more than 3 groups per cycle
    min_join_interval_ms: 30000       # 30s between join attempts
    auto_join: false                  # If true, automatically join groups that pass criteria
    skip_if_questions: true           # Skip groups that require answers to join questions

  search_groups:
    enabled: false                    # Off by default — enable when ready
    weight: 1
    max_per_run: 3                    # Max search queries per cycle
    max_scrolls: 5                    # Scroll depth for search results
    queries:                          # Search queries to run
      - "crypto bangladesh"
      - "bitcoin trading bd"
      - "cryptocurrency community bangla"
    discovery:
      min_members: 50                # Minimum members to consider
      max_members: 10000000           # Maximum members
      require_public: false           # Only auto-add public groups
      default_priority: 5            # Priority for auto-discovered groups
      auto_register: false           # If true, auto-add discovered groups to registry

  check_membership:
    enabled: true
    weight: 1
    max_per_run: 10
    stale_after_hours: 24            # Re-check membership if older than this

  compute_vitality:
    enabled: true
    weight: 1                         # Always runs once per cycle

# ── Group-specific overrides ──
# Override settings for specific groups by group_url or group_id

group_overrides: []
  # - group_id: "276632390946258"
  #   skip_posts_scrape: true          # Private group, can't scrape posts
  #   skip_join: true                  # Don't try to join this group
  #   notes: "Private group, member already"
```

### 4.2 Config Loading

New module: `src/core/monitor_config.ts`

```typescript
export interface MonitorConfig {
  chromePort: number;
  maxCycleRuntimeMinutes: number;
  dbPersist: boolean;
  delays: DelayPlannerOptions;
  phases: Record<string, PhaseConfig>;
  groupOverrides: GroupOverride[];
}

export function loadConfig(path: string): MonitorConfig {
  // Parse YAML, validate with Zod or manual checks, apply defaults
}

export function mergeWithCliArgs(config: MonitorConfig, args: Record<string, unknown>): MonitorConfig {
  // CLI args override YAML values
}
```

Dependencies: `yaml` npm package for parsing.

### 4.3 Config Precedence

1. CLI arguments (highest priority)
2. `group_monitor.yaml`
3. Default values in code (lowest priority)

---

## 5. New DB Schema Changes

### Migration 014: `group_monitor_v2.sql`

```sql
-- Membership tracking on registry
ALTER TABLE scraper.facebook_group_registry
  ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (membership_status IN ('unknown', 'not_joined', 'pending', 'joined', 'declined', 'left'));
ALTER TABLE scraper.facebook_group_registry
  ADD COLUMN IF NOT EXISTS join_requested_at TIMESTAMPTZ;
ALTER TABLE scraper.facebook_group_registry
  ADD COLUMN IF NOT EXISTS join_status_checked_at TIMESTAMPTZ;

-- Index for finding joinable groups
CREATE INDEX IF NOT EXISTS idx_registry_joinable
  ON scraper.facebook_group_registry(membership_status, is_active)
  WHERE is_active = true AND membership_status IN ('unknown', 'not_joined');

-- Index for stale membership checks
CREATE INDEX IF NOT EXISTS idx_registry_membership_stale
  ON scraper.facebook_group_registry(join_status_checked_at)
  WHERE is_active = true AND membership_status NOT IN ('joined', 'declined');

-- Add group_search surface to scrape_runs CHECK constraint
ALTER TABLE scraper.scrape_runs DROP CONSTRAINT scrape_runs_surface_check;
ALTER TABLE scraper.scrape_runs ADD CONSTRAINT scrape_runs_surface_check
  CHECK (surface IN (
    'marketplace_search', 'marketplace_listing', 'marketplace_seller',
    'page_info', 'page_posts',
    'group_info', 'group_posts', 'group_post_detail',
    'group_join', 'group_search'
  ));

-- View: joinable groups
CREATE OR REPLACE VIEW scraper.v_groups_joinable AS
SELECT group_url, group_id, name, priority, membership_status
FROM scraper.facebook_group_registry
WHERE is_active = true
  AND membership_status IN ('unknown', 'not_joined')
ORDER BY priority ASC, group_id;
```

---

## 6. New Files

```
# Join automation
src/extractors/group_join_extractor.ts       — Join/request group membership
src/cli/scrape_group_join.ts                 — CLI for joining a single group

# Group search/discovery
src/extractors/group_search_extractor.ts      — Search Facebook for groups by keyword
src/parsers/dom/group_search_dom_parser.ts    — Parse search result cards from DOM
src/cli/scrape_group_search.ts                — CLI for searching groups

# Config
src/core/monitor_config.ts                    — YAML config loader + validator
group_monitor.yaml                            — Default config file

# Orchestrator (replaces bash script)
src/cli/group_monitor.ts                      — TypeScript orchestrator with randomized task queue

# DB
db/migrations/014_group_monitor_v2.sql        — Membership columns, search surface, new views
```

---

## 7. Implementation Order

### Phase A: Foundation (config + membership tracking)
1. Add `yaml` package dependency
2. Create `src/core/monitor_config.ts` with YAML loader and defaults
3. Create `group_monitor.yaml` with current bash-script behavior as defaults
4. Migration 014: add `membership_status`, `join_requested_at`, `join_status_checked_at` to registry
5. Update `extractGroupInfo` to detect and return membership status
6. Update `group_repository.ts` to persist membership status

### Phase B: Join automation
7. Create `group_join_extractor.ts` with join/request logic
8. Create `scrape_group_join.ts` CLI
9. Test join detection on known joined vs not-joined groups
10. Test join action on a test group (with safety limits)

### Phase C: Group search
11. Create `group_search_extractor.ts` with search + scroll
12. Create `group_search_dom_parser.ts` for parsing result cards
13. Create `scrape_group_search.ts` CLI
14. Test search with "crypto bangladesh" query
15. Add auto-registration logic for discovered groups

### Phase D: TypeScript orchestrator
16. Create `group_monitor.ts` with task queue builder and weighted shuffle
17. Implement the execution loop with DelayPlanner integration
18. Add all task type handlers (info, posts, detail, join, search, membership check, vitality)
19. Test with `--dry-run` flag that shows the task queue without executing
20. Replace bash script in cron with `bun run src/cli/group_monitor.ts`

### Phase E: Config polish
21. Validate all YAML fields with sensible error messages
22. Add group-specific overrides support
23. Add `--config` CLI flag for custom config path
24. Document all config options in the YAML file itself (comments)

---

## 8. Risk Analysis

| Risk | Mitigation |
|------|-----------|
| Facebook detects automated join requests | max_per_run=3 default, 30s+ delays, humanized jitter. Join is off by default — user must opt in. |
| Join questions dialog blocks the flow | Detect textarea/input in modal, skip group, log as "requires_questions" |
| Group search results DOM changes | Parse defensively with multiple selectors, fall back to embedded data extraction |
| Task scheduler runs too long | `max_cycle_runtime_minutes: 45` hard cap, checked after each task |
| YAML config becomes stale after code changes | Config loader validates all fields, throws clear errors for unknown keys |
| Race condition between cron runs | Per-phase lock files (reuse existing pattern from bash script) |

---

## 9. Compatibility Notes

- The bash `group_monitor.sh` continues to work unchanged. The TypeScript orchestrator is a separate CLI that can be swapped in when ready.
- The YAML config defaults reproduce the current bash behavior exactly, so switching is zero-diff.
- `scrape_group_join.ts` and `scrape_group_search.ts` are standalone CLIs usable independently of the orchestrator.
- Membership status detection piggybacks on `extractGroupInfo` — no extra page navigation.
