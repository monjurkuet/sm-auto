#!/usr/bin/env bash
# ── Batch Group Discovery ──
# Runs a large set of search queries against Facebook group search
# and collects discovered groups into a JSON report.
#
# Usage:
#   bash scripts/batch_group_search.sh [--max-scrolls 5] [--dry-run]
#
# Output: output/logs/batch_search_YYYY-MM-DDTHH-MM-SS.json

set -euo pipefail

cd "$(dirname "$0")/.."
set -a && source .env && set +a

MAX_SCROLLS=5
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --max-scrolls=*) MAX_SCROLLS="${arg#*=}" ;;
    --max-scrolls)   shift; MAX_SCROLLS="$1" ;;
    --dry-run)       DRY_RUN=true ;;
  esac
done

# ── Query tiers ──
# Tier 1: Broad, highest yield
TIER1=(
  "crypto bangladesh"
  "bitcoin bangladesh"
  "cryptocurrency bangladesh"
  "crypto trading bd"
  "bitcoin trading bd"
  "crypto community bangla"
  "binance bangladesh"
  "crypto bd"
  "blockchain bangladesh"
  "crypto investment bangladesh"
)

# Tier 2: Specific coins / activities
TIER2=(
  "ethereum bangladesh"
  "solana bangladesh"
  "dogecoin bangladesh"
  "usdt bangladesh"
  "tron bangladesh"
  "xrp bangladesh"
  "crypto mining bangladesh"
  "crypto signals bangladesh"
  "crypto airdrop bangladesh"
  "p2p crypto bangladesh"
  "crypto exchange bangladesh"
  "crypto wallet bangladesh"
  "binance p2p bangladesh"
  "crypto staking bangladesh"
  "bitcoin mining bd"
  "altcoin bangladesh"
  "meme coin bangladesh"
  "defi bangladesh"
  "nft bangladesh"
  "web3 bangladesh"
)

# Tier 3: Regional / Bengali-language / niche
TIER3=(
  "crypto dhaka"
  "crypto chittagong"
  "bitcoin dhaka"
  "crypto sylhet"
  "ক্রিপ্টো বাংলাদেশ"
  "বিটকয়েন বাংলাদেশ"
  "ট্রেডিং বাংলাদেশ"
  "crypto bengali"
  "bengali crypto community"
  "bangla crypto trading"
  "bangla bitcoin"
  "ico bangladesh"
  "forex crypto bangladesh"
  "telegram crypto bangladesh"
  "crypto earning bangladesh"
  "passive income crypto bd"
  "crypto news bangladesh"
  "bangladesh crypto investors"
)

ALL_QUERIES=("${TIER1[@]}" "${TIER2[@]}" "${TIER3[@]}")

echo "============================================================"
echo "BATCH GROUP SEARCH — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Queries: ${#ALL_QUERIES[@]} | Max scrolls: $MAX_SCROLLS | Dry run: $DRY_RUN"
echo "============================================================"

TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%S)
LOG_FILE="output/logs/batch_search_${TIMESTAMP}.json"
mkdir -p output/logs

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "[DRY RUN] Queries that would be executed:"
  for i in "${!ALL_QUERIES[@]}"; do
    TIER="T1"
    if [ "$i" -ge "${#TIER1[@]}" ]; then TIER="T2"; fi
    if [ "$i" -ge "$((${#TIER1[@]} + ${#TIER2[@]}))" ]; then TIER="T3"; fi
    printf "  [%s] %2d. %s\n" "$TIER" "$((i+1))" "${ALL_QUERIES[$i]}"
  done
  echo ""
  echo "Total: ${#ALL_QUERIES[@]} queries"
  exit 0
fi

# ── Run searches ──
SUCCESS=0
FAILED=0
TOTAL=${#ALL_QUERIES[@]}
RESULTS=()

for i in "${!ALL_QUERIES[@]}"; do
  QUERY="${ALL_QUERIES[$i]}"
  NUM=$((i+1))
  echo ""
  echo "[$NUM/$TOTAL] Searching: \"$QUERY\""

  if timeout 120 bun run src/cli/scrape_group_search.ts \
    --query "$QUERY" \
    --max-scrolls "$MAX_SCROLLS" \
    --chrome-port 9222 \
    --persist-db true \
    --output "output/logs/batch_query_${TIMESTAMP}_$(printf '%03d' $NUM).json" \
    2>&1; then
    SUCCESS=$((SUCCESS + 1))
    echo "  ✓ OK"
  else
    FAILED=$((FAILED + 1))
    echo "  ✗ FAILED"
  fi

  # Humanized delay between queries (5-15s)
  if [ "$NUM" -lt "$TOTAL" ]; then
    DELAY=$((5 + RANDOM % 11))
    echo "  Waiting ${DELAY}s..."
    sleep "$DELAY"
  fi
done

echo ""
echo "============================================================"
echo "BATCH SEARCH COMPLETE"
echo "  Total:   $TOTAL"
echo "  Success: $SUCCESS"
echo "  Failed:  $FAILED"
echo "  Log dir: output/logs/"
echo "============================================================"

# ── Aggregate discovered groups ──
echo ""
echo "Aggregating discovered groups..."
python3 scripts/aggregate_search_results.py
