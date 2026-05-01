#!/usr/bin/env bash
set -uo pipefail

# ── Config (defaults, overridable via CLI args) ──
PROJECT_DIR="/root/codebase/sm-auto"
QUERY="${QUERY:-iphone}"
LOCATION="${LOCATION:-Dhaka}"
MAX_SCROLLS=200
SCROLL_DELAY_MS=800
# Telegram delivery target: group topic for marketplace reports
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:--1003974246097}"
TELEGRAM_THREAD_ID="${TELEGRAM_THREAD_ID:-2}"

# ── Parse CLI args ──
while [[ $# -gt 0 ]]; do
 case "$1" in
 --query) QUERY="$2"; shift 2 ;;
 --location) LOCATION="$2"; shift 2 ;;
 --max-scrolls) MAX_SCROLLS="$2"; shift 2 ;;
 --scroll-delay-ms) SCROLL_DELAY_MS="$2"; shift 2 ;;
 --chat-id) TELEGRAM_CHAT_ID="$2"; shift 2 ;;
 --thread-id) TELEGRAM_THREAD_ID="$2"; shift 2 ;;
 *) echo "Unknown arg: $1" >&2; exit 1 ;;
 esac
done

OUTPUT_FILE="${PROJECT_DIR}/output/marketplace_search.json"
LOG_DIR="${PROJECT_DIR}/output/logs"
LOCK_FILE="${PROJECT_DIR}/scripts/.scrape-$(echo "${QUERY}-${LOCATION}" | tr ' ' '_' | tr '[:upper:]' '[:lower:]').lock"
mkdir -p "${LOG_DIR}"

# ── Concurrency guard (per query+location) ──
if [[ -f "${LOCK_FILE}" ]]; then
  LOCK_PID=$(cat "${LOCK_FILE}" 2>/dev/null)
  if [[ -n "${LOCK_PID}" ]] && kill -0 "${LOCK_PID}" 2>/dev/null; then
    echo "[$(date)] Another scrape for '${QUERY}' in '${LOCATION}' is already running (PID ${LOCK_PID}). Exiting." >&2
    exit 0
  fi
  rm -f "${LOCK_FILE}"
fi
echo $$ > "${LOCK_FILE}"
trap 'rm -f "${LOCK_FILE}"' EXIT

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/scrape_${TIMESTAMP}.log"

# Ensure cron environment has needed vars
export DISPLAY="${DISPLAY:-:0}"
export PATH="/root/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Read Telegram credentials from Hermes .env (safe grep instead of source,
# because .env contains markdown comments that break shell sourcing)
TELEGRAM_BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$HOME/.hermes/.env" 2>/dev/null | head -1 | cut -d= -f2-)
TELEGRAM_ALLOWED_USERS=$(grep -E '^TELEGRAM_ALLOWED_USERS=' "$HOME/.hermes/.env" 2>/dev/null | head -1 | cut -d= -f2-)
TELEGRAM_HOME_CHANNEL=$(grep -E '^TELEGRAM_HOME_CHANNEL=' "$HOME/.hermes/.env" 2>/dev/null | head -1 | cut -d= -f2-)

# ── Telegram notification ──
send_telegram() {
 local token="${TELEGRAM_BOT_TOKEN:-}"
 local chat_id="${TELEGRAM_CHAT_ID:-${TELEGRAM_HOME_CHANNEL:-${TELEGRAM_ALLOWED_USERS:-}}}"
 local thread_id="${TELEGRAM_THREAD_ID:-}"
 if [[ -z "$token" || -z "$chat_id" ]]; then
 echo "[$(date)] Telegram credentials not found; skipping notification." | tee -a "${LOG_FILE}"
 return
 fi
 local payload="$1"
 # Telegram limit ~4096 chars
 local len=${#payload}
 if [[ $len -gt 4000 ]]; then
 payload="${payload:0:3990}..."
 fi
 local curl_args=(
 --data-urlencode "chat_id=${chat_id}"
 --data-urlencode "text=${payload}"
 --data-urlencode "parse_mode=HTML"
 )
 # Add message_thread_id for group topics (forums)
 if [[ -n "${thread_id}" ]]; then
 curl_args+=( --data-urlencode "message_thread_id=${thread_id}" )
 fi
 curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
 "${curl_args[@]}" > /dev/null 2>&1 || true
}

# ── Step 1: Ensure Chrome is running with remote debugging ──
echo "[$(date)] Checking Chrome remote debugging on port 9222..." | tee -a "${LOG_FILE}"

if ! curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
  echo "[$(date)] Chrome not reachable on port 9222. Launching chrome-remote..." | tee -a "${LOG_FILE}"
  nohup google-chrome \
  --no-sandbox \
  --remote-debugging-port=9222 \
  --user-data-dir=/root/.config/google-chrome/Profile \
  > /dev/null 2>&1 &

  for i in $(seq 1 30); do
    if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
      echo "[$(date)] Chrome is ready after ${i}s." | tee -a "${LOG_FILE}"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "[$(date)] ERROR: Chrome did not become ready in 30s. Aborting." | tee -a "${LOG_FILE}"
      send_telegram "❌ Marketplace Scraper FAILED

Query: ${QUERY} | Location: ${LOCATION}
Chrome did not start within 30s.
Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
      exit 1
    fi
    sleep 1
  done
else
  echo "[$(date)] Chrome already running on port 9222." | tee -a "${LOG_FILE}"
fi

# ── Step 2: Run the scraper ──
echo "[$(date)] Running marketplace scraper: query='${QUERY}' location='${LOCATION}' max-scrolls=${MAX_SCROLLS} scroll-delay-ms=${SCROLL_DELAY_MS}" | tee -a "${LOG_FILE}"

cd "${PROJECT_DIR}"

SCRAPER_EXIT=0
/root/.bun/bin/bun run src/cli/scrape_marketplace_search.ts \
  --query "${QUERY}" \
  --location "${LOCATION}" \
  --max-scrolls "${MAX_SCROLLS}" \
  --scroll-delay-ms "${SCROLL_DELAY_MS}" \
  > "${LOG_DIR}/scrape_output_${TIMESTAMP}.log" 2>&1 \
  || SCRAPER_EXIT=$?

cat "${LOG_DIR}/scrape_output_${TIMESTAMP}.log" >> "${LOG_FILE}"

echo "[$(date)] Scraper exited with code: ${SCRAPER_EXIT}" | tee -a "${LOG_FILE}"

# ── Step 3: Generate summary from output ──
SUMMARY=""
if [ "${SCRAPER_EXIT}" -eq 0 ] && [ -f "${OUTPUT_FILE}" ]; then
  export OUTPUT_FILE QUERY LOCATION
  SUMMARY=$(python3 << 'PYEOF'
import json, datetime, os
from collections import Counter
from statistics import median, quantiles

OUTPUT_FILE = os.environ["OUTPUT_FILE"]
QUERY = os.environ.get("QUERY", "N/A")
LOCATION = os.environ.get("LOCATION", "N/A")

with open(OUTPUT_FILE) as f:
    data = json.load(f)

listings = data.get("listings", [])
query = data.get("query", QUERY)
location = data.get("location", LOCATION)
url = data.get("searchUrl", "N/A")

# ── Extract priced listings ──
priced = []
for l in listings:
    p = l.get("price") or {}
    amt = p.get("amount")
    if amt is not None and amt > 0:
        priced.append(l)

prices = [l["price"]["amount"] for l in priced]
cur_counter = Counter()
for l in priced:
    cur = (l.get("price") or {}).get("currency", "")
    if cur:
        cur_counter[cur] += 1
# Use dominant currency for display
cur_str = cur_counter.most_common(1)[0][0] if cur_counter else ""

# ── Stats helper ──
def pct(sorted_vals, p):
    """p-th percentile from sorted list (0-100)."""
    if not sorted_vals:
        return 0
    idx = (p / 100) * (len(sorted_vals) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return sorted_vals[lo] + frac * (sorted_vals[hi] - sorted_vals[lo])

def fmt(v):
    return f"{v:,.0f}"

sp = sorted(prices) if prices else []

lines = []
lines.append("<b>Marketplace Scrape Report</b>")
lines.append("")
lines.append(f"Query: {query}")
lines.append(f"Location: {location}")
lines.append(f"Total Listings: {len(listings)}")
lines.append(f"With Valid Price: {len(priced)}")
lines.append(f"URL: {url}")
lines.append("")

# ── Detailed Price Statistics ──
if prices:
    lines.append("<b>Price Statistics</b>")
    lines.append(f"  Min:    {fmt(sp[0])} {cur_str}")
    lines.append(f"  P10:    {fmt(pct(sp,10))} {cur_str}")
    lines.append(f"  P25:    {fmt(pct(sp,25))} {cur_str}")
    lines.append(f"  Median: {fmt(pct(sp,50))} {cur_str}")
    lines.append(f"  P75:    {fmt(pct(sp,75))} {cur_str}")
    lines.append(f"  P90:    {fmt(pct(sp,90))} {cur_str}")
    lines.append(f"  Max:    {fmt(sp[-1])} {cur_str}")
    lines.append(f"  Mean:   {fmt(sum(sp)/len(sp))} {cur_str}")
    iqr = pct(sp,75) - pct(sp,25)
    lines.append(f"  IQR:    {fmt(iqr)} {cur_str}")
    lines.append(f"  StdDev: {fmt((sum((x-sum(sp)/len(sp))**2 for x in sp)/len(sp))**0.5)} {cur_str}")
    lines.append("")

# ── Price Group Buckets ──
if prices:
    lines.append("<b>Price Groups</b>")
    # Auto-generate sensible buckets based on data spread
    p10 = pct(sp,10)
    p25 = pct(sp,25)
    p50 = pct(sp,50)
    p75 = pct(sp,75)
    p90 = pct(sp,90)
    # Use quantile-based groups
    buckets = [
        (f"Under {fmt(p10)}", lambda a, b=p10: a < b),
        (f"{fmt(p10)} - {fmt(p25)}", lambda a, lo=p10, hi=p25: lo <= a < hi),
        (f"{fmt(p25)} - {fmt(p50)}", lambda a, lo=p25, hi=p50: lo <= a < hi),
        (f"{fmt(p50)} - {fmt(p75)}", lambda a, lo=p50, hi=p75: lo <= a < hi),
        (f"{fmt(p75)} - {fmt(p90)}", lambda a, lo=p75, hi=p90: lo <= a < hi),
        (f"Over {fmt(p90)}", lambda a, b=p90: a >= b),
    ]
    for label, test in buckets:
        grp = [l for l in priced if test(l["price"]["amount"])]
        if not grp:
            lines.append(f"  {label}: 0 listings")
            continue
        gp = sorted([l["price"]["amount"] for l in grp])
        lines.append(f"  {label}: {len(grp)} listings | min {fmt(gp[0])} | med {fmt(pct(gp,50))} | avg {fmt(sum(gp)/len(gp))} | max {fmt(gp[-1])}")
    lines.append("")

# ── Top 5 Cheapest ──
if priced:
    sorted_listings = sorted(priced, key=lambda x: x["price"]["amount"])
    lines.append("<b>Top 5 Cheapest</b>")
    for i, l in enumerate(sorted_listings[:5], 1):
        title = l.get("title", "N/A") or "N/A"
        price_str = (l.get("price") or {}).get("formatted", "N/A")
        seller = (l.get("seller") or {}).get("name", "N/A")
        loc = (l.get("location") or {}).get("city", "N/A")
        lines.append(f"  {i}. {title} - {price_str} | {seller} ({loc})")
    lines.append("")

    sorted_desc = sorted(priced, key=lambda x: x["price"]["amount"], reverse=True)
    lines.append("<b>Top 5 Most Expensive</b>")
    for i, l in enumerate(sorted_desc[:5], 1):
        title = l.get("title", "N/A") or "N/A"
        price_str = (l.get("price") or {}).get("formatted", "N/A")
        seller = (l.get("seller") or {}).get("name", "N/A")
        loc = (l.get("location") or {}).get("city", "N/A")
        lines.append(f"  {i}. {title} - {price_str} | {seller} ({loc})")
    lines.append("")

# ── Best Value (closest to median, i.e. fair price) ──
if priced and len(priced) >= 3:
    med = pct(sp, 50)
    by_deviation = sorted(priced, key=lambda l: abs(l["price"]["amount"] - med))
    lines.append("<b>Best Value (near median)</b>")
    for i, l in enumerate(by_deviation[:3], 1):
        title = l.get("title", "N/A") or "N/A"
        price_str = (l.get("price") or {}).get("formatted", "N/A")
        seller = (l.get("seller") or {}).get("name", "N/A")
        loc = (l.get("location") or {}).get("city", "N/A")
        dev = l["price"]["amount"] - med
        dev_str = f"+{fmt(dev)}" if dev >= 0 else fmt(dev)
        lines.append(f"  {i}. {title} - {price_str} ({dev_str} vs med) | {seller} ({loc})")
    lines.append("")

# ── Outliers (price > P75 + 1.5*IQR or < P25 - 1.5*IQR) ──
if priced and len(priced) >= 10:
    q1 = pct(sp, 25)
    q3 = pct(sp, 75)
    iqr = q3 - q1
    upper_fence = q3 + 1.5 * iqr
    lower_fence = q1 - 1.5 * iqr
    high_outliers = [l for l in priced if l["price"]["amount"] > upper_fence]
    low_outliers = [l for l in priced if l["price"]["amount"] < max(lower_fence, 0)]
    if high_outliers or low_outliers:
        lines.append("<b>Outliers</b>")
        lines.append(f"  Normal range: {fmt(max(lower_fence,0))} - {fmt(upper_fence)} {cur_str}")
        lines.append(f"  High outliers: {len(high_outliers)} | Low outliers: {len(low_outliers)}")
        if high_outliers:
            lines.append(f"  Priciest outlier: {high_outliers[0].get('title','?')} at {high_outliers[0]['price']['formatted']}")
        if low_outliers:
            lo = sorted(low_outliers, key=lambda x: x["price"]["amount"])
            lines.append(f"  Cheapest outlier: {lo[0].get('title','?')} at {lo[0]['price']['formatted']}")
        lines.append("")

# ── Top Locations ──
if priced:
    loc_counter = Counter()
    loc_prices = {}
    for l in priced:
        city = (l.get("location") or {}).get("city") or "Unknown"
        loc_counter[city] += 1
        loc_prices.setdefault(city, []).append(l["price"]["amount"])
    lines.append("<b>Top 5 Locations</b>")
    for city, count in loc_counter.most_common(5):
        cp = sorted(loc_prices[city])
        lines.append(f"  {city}: {count} listings | med {fmt(pct(cp,50))} | avg {fmt(sum(cp)/len(cp))}")
    lines.append("")

# ── Delivery Options ──
if priced:
    del_counter = Counter()
    del_prices = {}
    for l in priced:
        for d in l.get("deliveryOptions", []):
            del_counter[d] += 1
            del_prices.setdefault(d, []).append(l["price"]["amount"])
    if del_counter:
        lines.append("<b>Delivery Options</b>")
        for opt, count in del_counter.most_common():
            op = sorted(del_prices[opt])
            lines.append(f"  {opt}: {count} | med {fmt(pct(op,50))} | avg {fmt(sum(op)/len(op))}")
        lines.append("")

# ── Price-per-seller uniqueness (duplicate detection) ──
if priced and len(priced) >= 5:
    seller_counter = Counter()
    for l in priced:
        sid = (l.get("seller") or {}).get("id") or "unknown"
        seller_counter[sid] += 1
    repeat_sellers = {s: c for s, c in seller_counter.items() if c > 1}
    if repeat_sellers:
        lines.append(f"<b>Repeat Sellers</b>")
        lines.append(f"  {len(repeat_sellers)} sellers with 2+ listings (top 3):")
        for sid, count in sorted(repeat_sellers.items(), key=lambda x: -x[1])[:3]:
            name = next((l.get("seller",{}).get("name","?") for l in priced if (l.get("seller") or {}).get("id") == sid), "?")
            lines.append(f"  - {name}: {count} listings")
        lines.append("")

lines.append(f"Run: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

print("\n".join(lines))
PYEOF
  )
else
  SUMMARY="❌ Marketplace Scrape FAILED

Query: ${QUERY} | Location: ${LOCATION}
Exit code: ${SCRAPER_EXIT}
Output file missing or scraper error.
Log: ${LOG_FILE}"
fi

echo "" | tee -a "${LOG_FILE}"
echo "${SUMMARY}" | tee -a "${LOG_FILE}"

# ── Step 4: Send summary to Telegram ──
echo "[$(date)] Sending summary to Telegram..." | tee -a "${LOG_FILE}"
send_telegram "${SUMMARY}"
echo "[$(date)] Telegram notification sent." | tee -a "${LOG_FILE}"

exit ${SCRAPER_EXIT}
