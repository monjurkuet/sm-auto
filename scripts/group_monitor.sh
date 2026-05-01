#!/usr/bin/env bash
# group_monitor.sh — Facebook Group Monitoring Pipeline
# Phases: info scrape → posts scrape → detail crawl → vitality compute
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/output/logs"
LOCK_DIR="/tmp/sm-auto-monitor"

# ── Config ──
INFO_INTERVAL="${INFO_INTERVAL:-8}"      # only scrape info for groups overdue by this many hours (overrides registry setting for safety)
POSTS_MAX_SCROLLS="${POSTS_MAX_SCROLLS:-15}"
DETAIL_LIMIT="${DETAIL_LIMIT:-30}"       # max posts to detail-crawl per run
PAUSE_MIN="${PAUSE_MIN:-3}"
PAUSE_MAX="${PAUSE_MAX:-8}"
BURST_EVERY_MIN="${BURST_EVERY_MIN:-4}"
BURST_EVERY_MAX="${BURST_EVERY_MAX:-7}"
BURST_PAUSE_MIN="${BURST_PAUSE_MIN:-20}"
BURST_PAUSE_MAX="${BURST_PAUSE_MAX:-45}"

# ── PSQL helper ──
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE
source "$PROJECT_DIR/.env" 2>/dev/null || true

psql_q() { psql -U "$PGUSER" -d "$PGDATABASE" -h "$PGHOST" -t -A -c "$1" 2>/dev/null; }

# ── Lock management ──
acquire_lock() {
  local phase="$1"
  mkdir -p "$LOCK_DIR"
  local lockfile="$LOCK_DIR/${phase}.lock"
  if [ -f "$lockfile" ]; then
    local pid
    pid=$(cat "$lockfile" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "[MONITOR] Phase '$phase' already running (PID $pid), skipping."
      return 1
    fi
    rm -f "$lockfile"
  fi
  echo $$ > "$lockfile"
  return 0
}

release_lock() {
  local phase="$1"
  rm -f "$LOCK_DIR/${phase}.lock"
}

# ── Random sleep helper ──
rand_sleep() {
  local lo="$1" hi="$2"
  local delay=$(( RANDOM % (hi - lo + 1) + lo ))
  sleep "$delay"
}

# ── Phase 1: Info Scrape ──
phase_info() {
  echo ""
  echo "════════════════════════════════════════════════"
  echo "[INFO] Phase 1: Group Info Scrape"
  echo "════════════════════════════════════════════════"

  acquire_lock "info" || return 0

  local groups
  groups=$(psql_q "
    SELECT group_url FROM scraper.v_groups_needing_info_scrape
    ORDER BY priority ASC
  " 2>/dev/null) || true

  if [ -z "$groups" ]; then
    echo "[INFO] No groups need info scrape. Skipping."
    release_lock "info"
    return 0
  fi

  local count=0
  local burst_counter=0
  local burst_at=$(( RANDOM % (BURST_EVERY_MAX - BURST_EVERY_MIN + 1) + BURST_EVERY_MIN ))

  while IFS= read -r url; do
    [ -z "$url" ] && continue
    count=$((count + 1))
    burst_counter=$((burst_counter + 1))

    echo "[INFO] Scraping group info: $url"

    if cd "$PROJECT_DIR" && bun run src/cli/scrape_group_info.ts --url "$url" 2>&1 | tail -1; then
      # Update registry: set last_info_scrape_at and pull group_id from facebook_groups
      local group_id
      group_id=$(psql_q "
        UPDATE scraper.facebook_group_registry
        SET last_info_scrape_at = now(),
            group_id = fg.group_id,
            name = fg.name
        FROM scraper.facebook_groups fg
        WHERE scraper.facebook_group_registry.group_url = '$url'
          AND fg.group_id IS NOT NULL
          AND (scraper.facebook_group_registry.group_id IS NULL
               OR scraper.facebook_group_registry.group_id = fg.group_id)
        RETURNING scraper.facebook_group_registry.group_id
      " 2>/dev/null) || true

      # If group_id wasn't matched via join, try extracting from URL
      if [ -z "$group_id" ]; then
        local url_gid
        url_gid=$(echo "$url" | grep -oP '/groups/\K[^/]+' | head -1)
        if [ -n "$url_gid" ] && echo "$url_gid" | grep -qP '^\d+$'; then
          psql_q "UPDATE scraper.facebook_group_registry SET group_id = '$url_gid', last_info_scrape_at = now() WHERE group_url = '$url' AND group_id IS NULL;" 2>/dev/null || true
        else
          psql_q "UPDATE scraper.facebook_group_registry SET last_info_scrape_at = now() WHERE group_url = '$url';" 2>/dev/null || true
        fi
      fi
    else
      echo "[INFO] FAILED: $url"
    fi

    # Burst pause check
    if [ "$burst_counter" -ge "$burst_at" ]; then
      echo "[INFO] Burst pause..."
      rand_sleep "$BURST_PAUSE_MIN" "$BURST_PAUSE_MAX"
      burst_counter=0
      burst_at=$(( RANDOM % (BURST_EVERY_MAX - BURST_EVERY_MIN + 1) + BURST_EVERY_MIN ))
    else
      rand_sleep "$PAUSE_MIN" "$PAUSE_MAX"
    fi
  done <<< "$groups"

  echo "[INFO] Phase 1 complete. Scraped $count groups."
  release_lock "info"
}

# ── Phase 2: Posts Scrape ──
phase_posts() {
  echo ""
  echo "════════════════════════════════════════════════"
  echo "[POSTS] Phase 2: Group Posts Scrape"
  echo "════════════════════════════════════════════════"

  acquire_lock "posts" || return 0

  local groups
  groups=$(psql_q "
    SELECT group_url FROM scraper.v_groups_needing_posts_scrape
    ORDER BY priority ASC
  " 2>/dev/null) || true

  if [ -z "$groups" ]; then
    echo "[POSTS] No groups need posts scrape. Skipping."
    release_lock "posts"
    return 0
  fi

  local count=0
  local burst_counter=0
  local burst_at=$(( RANDOM % (BURST_EVERY_MAX - BURST_EVERY_MIN + 1) + BURST_EVERY_MIN ))

  while IFS= read -r url; do
    [ -z "$url" ] && continue
    count=$((count + 1))
    burst_counter=$((burst_counter + 1))

    echo "[POSTS] Scraping group posts: $url (maxScrolls=$POSTS_MAX_SCROLLS)"

    if cd "$PROJECT_DIR" && bun run src/cli/scrape_group_posts.ts --url "$url" --max-scrolls "$POSTS_MAX_SCROLLS" 2>&1 | tail -1; then
      psql_q "UPDATE scraper.facebook_group_registry SET last_posts_scrape_at = now() WHERE group_url = '$url';" 2>/dev/null || true
    else
      echo "[POSTS] FAILED: $url"
    fi

    if [ "$burst_counter" -ge "$burst_at" ]; then
      echo "[POSTS] Burst pause..."
      rand_sleep "$BURST_PAUSE_MIN" "$BURST_PAUSE_MAX"
      burst_counter=0
      burst_at=$(( RANDOM % (BURST_EVERY_MAX - BURST_EVERY_MIN + 1) + BURST_EVERY_MIN ))
    else
      rand_sleep "$PAUSE_MIN" "$PAUSE_MAX"
    fi
  done <<< "$groups"

  # Snapshot metrics after all groups scraped
  echo "[POSTS] Snapshotting group metrics..."
  psql_q "
    INSERT INTO scraper.facebook_group_post_metrics_history (group_id, post_count, posts_with_reactions, posts_with_comments, avg_reactions, avg_comments, avg_shares)
    SELECT
      g.group_id,
      COUNT(p.post_id),
      COUNT(p.reaction_count),
      COUNT(p.comment_count),
      AVG(p.reaction_count::numeric),
      AVG(p.comment_count::numeric),
      AVG(p.share_count::numeric)
    FROM scraper.facebook_groups g
    LEFT JOIN scraper.facebook_group_posts p ON p.group_id = g.group_id
    JOIN scraper.facebook_group_registry r ON r.group_id = g.group_id
    WHERE r.is_active = true
    GROUP BY g.group_id
  " 2>/dev/null || true

  echo "[POSTS] Phase 2 complete. Scraped $count groups."
  release_lock "posts"
}

# ── Phase 3: Detail Crawl ──
phase_detail() {
  echo ""
  echo "════════════════════════════════════════════════"
  echo "[DETAIL] Phase 3: Post Detail Crawl (limit=$DETAIL_LIMIT)"
  echo "════════════════════════════════════════════════"

  acquire_lock "detail" || return 0

  cd "$PROJECT_DIR" && bun run src/cli/scrape_group_post_details.ts \
    --limit "$DETAIL_LIMIT" \
    --continue-on-error true \
    --delay-mode humanized \
    --delay-ms 2500 \
    --delay-jitter-ms 1500 \
    --pause-every-min 4 \
    --pause-every-max 8 \
    --pause-min-ms 15000 \
    --pause-max-ms 40000 \
    2>&1 | tail -5 || true

  echo "[DETAIL] Phase 3 complete."
  release_lock "detail"
}

# ── Phase 4: Vitality Compute ──
phase_vitality() {
  echo ""
  echo "════════════════════════════════════════════════"
  echo "[VITALITY] Phase 4: Computing group vitality scores"
  echo "════════════════════════════════════════════════"

  acquire_lock "vitality" || return 0

  cd "$PROJECT_DIR" && python3 scripts/compute_group_vitality.py 2>&1 || true

  echo "[VITALITY] Phase 4 complete."
  release_lock "vitality"
}

# ── Main ──
main() {
  mkdir -p "$LOG_DIR"
  echo "╔══════════════════════════════════════════════╗"
  echo "║  Facebook Group Monitor — $(date -Iseconds)  ║"
  echo "╚══════════════════════════════════════════════╝"

  phase_info
  phase_posts
  phase_detail
  phase_vitality

  echo ""
  echo "════════════════════════════════════════════════"
  echo "[MONITOR] Pipeline complete."
  echo "════════════════════════════════════════════════"

  # Quick summary
  psql_q "
    SELECT group_id, LEFT(name, 40) as name, vitality_score, posts_last_24h, posts_last_7d
    FROM scraper.v_group_vitality
    ORDER BY vitality_score DESC NULLS LAST
  " 2>/dev/null | while IFS= read -r line; do
    echo "  $line"
  done || true
}

main "$@"
