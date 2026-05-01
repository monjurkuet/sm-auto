# Group Scraper v3 — Agentic, Hermes-Orchestrated System

**Date:** 2026-05-01 | **Status:** PLANNING

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    USER (Telegram)                    │
│  "monitor groups" / "add group" / "show observations"│
└──────────────────────┬──────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  HERMES AGENT    │
              │  (orchestrator)  │
              │  - builds tasks  │
              │  - runs cycle    │
              │  - LLM decisions │
              └──┬─────┬────┬────┘
                 │     │    │
      ┌──────────┘     │    └──────────┐
      ▼                ▼               ▼
┌──────────┐  ┌──────────────┐  ┌─────────────┐
│ sm-auto  │  │ training-data│  │ hermesagent  │
│ scraper  │  │ repo (git)   │  │ repo (git)   │
│ + DB     │  │ JSONL data   │  │ knowledge/   │
└──────────┘  └──────────────┘  └─────────────┘

Data Flow:
  Chrome → Scrapers → DB → Observations → training-data/ + hermesagent/
                                    ↑
                              LLM decisions
                         (join? organic? spam?)
```

## Three Output Destinations

1. **sm-auto DB** — structured data (posts, comments, metrics, groups)
2. **training-data repo** — JSONL training examples for LLM fine-tuning
3. **hermesagent repo** — observations, knowledge base, session memories

---

## 1. Hermes-Orchestrated Agentic System

### 1.1 Core Idea

Instead of a rigid cron job, Hermes IS the orchestrator. Each monitoring cycle:

1. Hermes queries the DB for current state (what groups need scraping, what posts need comments, what groups to join)
2. Hermes builds a task queue (mixing info/posts/detail/join/search)
3. Hermes executes tasks one at a time, with humanized delays
4. After each task, Hermes can call the LLM for decisions (should we join? is this organic?)
5. After the cycle, Hermes generates observations and pushes training data

### 1.2 TypeScript Orchestrator

Replace `scripts/group_monitor.sh` with `src/cli/group_monitor.ts`:

```typescript
// Main loop
async function runCycle(config: MonitorConfig): Promise<CycleResult> {
  const tasks = buildTaskQueue(config, registry);  // weighted shuffle
  const planner = createDelayPlanner(config.delays);
  const results: TaskResult[] = [];

  for (const task of tasks) {
    const result = await executeTask(task, config);
    results.push(result);

    // LLM decision hooks
    if (task.type === 'join_group' && result.status === 'found_joinable') {
      const shouldJoin = await llmDecideJoin(result.groupInfo, config);
      if (!shouldJoin) { task.skip = true; continue; }
    }
    if (task.type === 'posts_scrape') {
      // After scraping, let LLM classify conversations
      await llmClassifyPosts(result.posts, config);
    }

    await applyDelay(planner, result.success ? 'success' : 'failure');

    if (exceedsRuntimeCap(config)) break;
  }

  // Post-cycle: generate observations, export training data
  const observations = await generateObservations(results);
  await exportTrainingData(results);
  await pushToRepos();

  return { tasks: results.length, observations, cycleMs: Date.now() - start };
}
```

### 1.3 LLM Decision Functions

New module: `src/core/llm_decisions.ts`

```typescript
interface LLMConfig {
  baseUrl: string;    // https://llm.datasolved.org/v1
  apiKey: string;
  model: string;      // gpt-5.4 for decisions, gpt-5.4-mini for classifications
}

// Should we join this group?
async function llmDecideJoin(groupInfo: GroupInfo, config: MonitorConfig): Promise<boolean> {
  const prompt = `You are monitoring Facebook groups for crypto/trading discussions in Bangladesh.
Group: "${groupInfo.name}" (${groupInfo.memberCount} members, ${groupInfo.privacyType})
Recent activity: ${groupInfo.posting_frequency_7d} posts/day, engagement rate: ${groupInfo.engagementRate}
Should we request to join this group? Consider: relevance, activity level, member count, privacy.
Answer only YES or NO with a brief reason.`;

  const response = await callLLM(config.llm, prompt);
  return response.toLowerCase().includes('yes');
}

// Classify posts for training data curation
async function llmClassifyPosts(posts: GroupPost[], config: MonitorConfig): Promise<Classification[]> {
  const prompt = `Classify these Facebook group posts. For each, determine:
1. language: "bn" (Bangla), "en" (English), "mixed" (both)
2. conversation_type: "discussion" | "question" | "answer" | "promotion" | "spam" | "scam" | "announcement"
3. author_type: "real" | "suspected_bot" | "business" | "verified"
4. is_organic: boolean (genuine community interaction vs manufactured engagement)

Posts:
${posts.map((p, i) => `[${i}] "${p.text?.slice(0, 200)}" by ${p.authorName} (${p.metrics.reactions}r/${p.metrics.comments}c)`).join('\n')}

Return JSON array with same indexing.`;

  return await callLLM(config.llm, prompt, { response_format: 'json' });
}
```

### 1.4 Hermes Skill for Telegram

Create skill: `facebook-group-monitor` (in hermesagent repo)

```yaml
# Trigger phrases
- "monitor groups"
- "group status"
- "add group <url>"
- "search for <query> groups"
- "join pending groups"
- "show observations for <group>"
- "export training data"
- "group vitality"
```

The skill will:
1. Parse the user's intent
2. Call the appropriate sm-auto CLI command or DB query
3. Format the result for Telegram
4. For decisions (join, search), optionally consult the LLM

---

## 2. Training Data Collection

### 2.1 Repo Structure

```
training-data/
├── README.md
├── facebook-groups/
│   ├── raw/
│   │   └── 2026-05-01/
│   │       ├── posts.jsonl        # All posts scraped today
│   │       ├── comments.jsonl     # All comments scraped today
│   │       └── metadata.jsonl    # Group metadata snapshots
│   ├── curated/
│   │   └── 2026-05-01/
│   │       ├── bangla-discussions.jsonl   # Filtered Bangla conversations
│   │       ├── bangla-qa.jsonl            # Question-answer pairs
│   │       ├── organic-interactions.jsonl # Verified organic discussions
│   │       └── spam-scam-samples.jsonl    # Spam/scam examples (negative training)
│   └── schemas/
│       ├── post.schema.json
│       ├── comment.schema.json
│       └── training-example.schema.json
└── .gitignore
```

### 2.2 JSONL Format

**Raw post:**
```json
{
  "id": "post_1315106307381875",
  "text": "বিটকয়েন আজ ভালো যাচ্ছে, কেউ কি মনে করেন এটা চলবে?",
  "language": "bn",
  "author": {"name": "রাহুল আহমেদ", "id": null},
  "group": {"id": "498188334234453", "name": "Crypto Community ✔️"},
  "metrics": {"reactions": 5, "comments": 12, "shares": 1},
  "created_at": "2026-05-01T12:00:00Z",
  "scraped_at": "2026-05-01T16:30:00Z",
  "classification": {"conversation_type": "question", "author_type": "real", "is_organic": true}
}
```

**Training example (curated):**
```json
{
  "messages": [
    {"role": "user", "content": "বিটকয়েন আজ ভালো যাচ্ছে, কেউ কি মনে করেন এটা চলবে?"},
    {"role": "assistant", "content": "হ্যাঁ ভাই, মার্কেট এখন বুলিশ। তবে সতর্ক থাকুন, যেকোনো সময় কারেকশন আসতে পারে।"}
  ],
  "metadata": {
    "source": "facebook_group",
    "group_id": "498188334234453",
    "language": "bn",
    "conversation_type": "discussion",
    "is_organic": true,
    "collected_at": "2026-05-01"
  }
}
```

### 2.3 Export Pipeline

After each monitoring cycle, `exportTrainingData()`:
1. Query DB for new posts/comments since last export
2. Run LLM classification (batch — one call per 20 posts)
3. Write raw JSONL to `training-data/facebook-groups/raw/DATE/`
4. Filter for Bangla content → write curated JSONL
5. Construct Q-A pairs from comment threads → write training examples
6. `git add + commit + push` to training-data repo

---

## 3. Observation/Memory System

### 3.1 Observation Schema

After each cycle, generate structured observations:

```typescript
interface GroupObservation {
  group_id: string;
  group_name: string;
  observed_at: string;          // ISO timestamp
  cycle_id: string;             // UUID linking to the monitoring cycle

  // Group dynamics
  posting_frequency: number;    // posts/day
  active_posters_count: number; // distinct authors in last 7d
  repeat_posters: string[];     // authors with 3+ posts
  dominant_language: string;    // "bn" | "en" | "mixed"
  avg_engagement: number;       // avg total interactions per post

  // Conversation patterns
  conversation_types: {         // distribution
    discussion: number;
    question: number;
    promotion: number;
    spam: number;
    scam: number;
  };

  // Profile analysis
  suspected_bots: {             // profiles with red flags
    author_name: string;
    reasons: string[];          // "generic_name", "repeated_promotion", "no_replies"
  }[];

  // Real vs fake indicators
  organic_ratio: number;        // 0-1, fraction of posts that are genuine
  promotion_ratio: number;      // fraction that are self-promotion
  scam_indicators: string[];    // "p2p_offers", "fake_giveaway", "phishing_links"

  // Trends
  trending_topics: string[];    // extracted from recent posts
  notable_posts: {              // high-engagement or unusual posts
    post_id: string;
    text_preview: string;
    reason: string;             // "high_engagement" | "viral" | "controversial"
  }[];

  // Membership
  membership_status: string;
  member_count: number | null;
  member_count_delta: number | null; // change since last observation
}
```

### 3.2 hermesagent Repo Structure

```
hermesagent/
├── README.md
├── knowledge/
│   ├── facebook-groups/
│   │   ├── observations/
│   │   │   └── 2026-05-01/
│   │   │       ├── group_498188334234453.md   # Observation notes per group
│   │   │       ├── group_117843491401430.md
│   │   │       └── cycle_summary_2026-05-01.md
│   │   ├── profiles/
│   │   │   └── suspicious_profiles.jsonl      # Bot/fake profile tracking
│   │   └── group_registry_notes.md            # Human-readable registry notes
│   └── scraper-insights/
│       └── facebook-group-scraper.md          # Technical knowledge/lessons
├── skills/
│   └── facebook-group-monitor/
│       └── SKILL.md                           # Hermes skill definition
└── memories/
    └── facebook-groups/
        └── session_memories.jsonl             # Cross-session memory entries
```

### 3.3 Observation Generation

`scripts/generate_observations.py` (Python + psycopg3):

After each cycle:
1. Query DB for this cycle's data (new posts, comments, metrics)
2. Compute group dynamics (posting freq, active posters, language distribution)
3. Load LLM classifications from training data export
4. Detect suspicious profiles (repeated promotion, generic names, no-reply patterns)
5. Identify trending topics (word frequency on recent posts)
6. Find notable posts (top 5 by engagement, controversial posts)
7. Write per-group observation markdown files
8. Write cycle summary
9. `git add + commit + push` to hermesagent repo

### 3.4 Cross-Session Memory

Observations are saved as markdown files in the hermesagent repo. Hermes can:
- Read them with `read_file` in future sessions
- Search them with `search_files`
- The skill instructs Hermes to check `hermesagent/knowledge/facebook-groups/observations/` for context before making decisions

---

## 4. Implementation Tasks

### Phase A: Repo Setup + Schema (3 tasks)
1. Clone and set up `training-data` repo at `/root/codebase/training-data/`
2. Clone and set up `hermesagent` repo at `/root/codebase/hermesagent/`
3. Migration 014: membership_status columns on registry, group_search/group_join surfaces

### Phase B: Join Automation (4 tasks)
4. `group_join_extractor.ts` — detect membership status, click join button, handle questions
5. `scrape_group_join.ts` CLI
6. Update `extractGroupInfo` to return membership_status
7. Update `group_repository.ts` to persist membership_status

### Phase C: Group Search (4 tasks)
8. `group_search_extractor.ts` — search Facebook groups, scroll and collect results
9. `group_search_dom_parser.ts` — parse search result cards from DOM
10. `scrape_group_search.ts` CLI
11. Auto-registration logic for discovered groups

### Phase D: YAML Config + Orchestrator (5 tasks)
12. Add `yaml` npm package
13. `monitor_config.ts` — YAML loader, validator, defaults, merge with CLI args
14. `group_monitor.yaml` — default config file
15. `group_monitor.ts` — TypeScript orchestrator with weighted task queue
16. Replace bash cron with `bun run src/cli/group_monitor.ts`

### Phase E: LLM Decision Layer (3 tasks)
17. `llm_decisions.ts` — call LLM endpoint for join/classify/organic decisions
18. Integrate LLM decisions into orchestrator task execution
19. Add `llm` section to group_monitor.yaml config

### Phase F: Training Data Export (4 tasks)
20. `export_training_data.py` — query DB, write JSONL, push to training-data repo
21. LLM batch classification for post/comment curation
22. Q-A pair extraction from comment threads
23. Schemas for training data formats

### Phase G: Observation System (4 tasks)
24. `generate_observations.py` — compute group dynamics, detect bots, find trends
25. Observation markdown template per group
26. Cycle summary generation
27. Push observations to hermesagent repo

### Phase H: Hermes Skill + Integration (3 tasks)
28. Create `facebook-group-monitor` skill in hermesagent repo
29. Wire Telegram commands: monitor/status/add/search/join/observations/export
30. Cron entry for automated cycle + push

Total: 30 tasks across 8 phases

---

## 5. Key Design Decisions

1. **Hermes IS the orchestrator** — not a separate daemon. Hermes builds the task queue, runs it, makes LLM decisions, and pushes data. The cron job triggers Hermes (via the group_monitor.ts CLI), but the intelligence is in the TypeScript code + LLM calls.

2. **LLM calls are batched** — classify 20 posts per call, not 1-by-1. This reduces API costs and speeds up the cycle. Use `gpt-5.4-mini` for classifications (cheaper/faster), `gpt-5.4` for join decisions (needs better reasoning).

3. **Training data is raw first, curated second** — raw JSONL is a direct DB dump. Curated JSONL goes through LLM classification and filtering. This separation means you can re-curate from raw data later without re-scraping.

4. **Observations are markdown, not JSON** — markdown files in the hermesagent repo are human-readable, git-diffable, and easy for Hermes to read in future sessions.

5. **Git push is batched, not per-task** — training data and observations are pushed once at the end of each cycle, not after each individual scrape. This reduces git churn.

6. **The YAML config is the single source of truth** — all settings (phases, delays, search queries, LLM config, repo paths) are in `group_monitor.yaml`. CLI args override, code defaults are fallback.

7. **Bangla detection is heuristic + LLM** — first check for Bengali Unicode range (\u0980-\u09FF), then let the LLM confirm language on ambiguous posts. This avoids expensive LLM calls on obviously English posts.
