#!/usr/bin/env bash
#
# Crawl Facebook page info and posts from tracked pages in the database
# Usage: ./scripts/crawl_pages.sh [OPTIONS]
#
# Examples:
#   ./scripts/crawl_pages.sh                          # Crawl all pages with defaults
#   ./scripts/crawl_pages.sh --limit 5                # Crawl first 5 pages
#   ./scripts/crawl_pages.sh --page-id 123456789      # Crawl specific page
#   ./scripts/crawl_pages.sh --max-scrolls 10 --scroll-delay-ms 3000
#

set -euo pipefail

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default values
DEFAULT_MAX_SCROLLS=8
DEFAULT_SCROLL_DELAY_MS=2000
DEFAULT_TIMEOUT_MS=90000
DEFAULT_CHROME_PORT=9222
DEFAULT_OUTPUT_DIR="./output/crawl"
DEFAULT_PERSIST_DB=true
DEFAULT_INCLUDE_ARTIFACTS=false
DEFAULT_LIMIT=0  # 0 means no limit

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_PAGES=0
SUCCESS_COUNT=0
FAILED_COUNT=0
SKIPPED_COUNT=0

# Load environment variables if .env exists
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  source "${PROJECT_ROOT}/.env"
fi

# Default DB values
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-facebook_scraper}"
PGUSER="${PGUSER:-agent0}"
PGPASSWORD="${PGPASSWORD:-}"
PGSSLMODE="${PGSSLMODE:-disable}"

export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE

# Options
MAX_SCROLLS=${DEFAULT_MAX_SCROLLS}
SCROLL_DELAY_MS=${DEFAULT_SCROLL_DELAY_MS}
TIMEOUT_MS=${DEFAULT_TIMEOUT_MS}
CHROME_PORT=${DEFAULT_CHROME_PORT}
OUTPUT_DIR=${DEFAULT_OUTPUT_DIR}
PERSIST_DB=${DEFAULT_PERSIST_DB}
INCLUDE_ARTIFACTS=${DEFAULT_INCLUDE_ARTIFACTS}
LIMIT=${DEFAULT_LIMIT}
SPECIFIC_PAGE_ID=""
CRAWL_PAGE_INFO=true
CRAWL_PAGE_POSTS=true
DRY_RUN=false
VERBOSE=false

usage() {
  cat << EOF
${BLUE}Facebook Page Crawler${NC}

Crawl page info and posts for tracked Facebook pages in the database.

${YELLOW}Usage:${NC}
  ${GREEN}./scripts/crawl_pages.sh${NC} [OPTIONS]

${YELLOW}Options:${NC}
  ${GREEN}--limit <n>${NC}              Limit to first N pages (0 = all, default: ${DEFAULT_LIMIT})
  ${GREEN}--page-id <id>${NC}           Crawl specific page by ID only
  ${GREEN}--url <url>${NC}              Crawl specific page by URL only
  ${GREEN}--max-scrolls <n>${NC}        Max scrolls per page (default: ${DEFAULT_MAX_SCROLLS})
  ${GREEN}--scroll-delay-ms <ms>${NC}   Delay between scrolls in ms (default: ${DEFAULT_SCROLL_DELAY_MS})
  ${GREEN}--timeout-ms <ms>${NC}        Timeout per scrape in ms (default: ${DEFAULT_TIMEOUT_MS})
  ${GREEN}--chrome-port <port>${NC}     Chrome DevTools port (default: ${DEFAULT_CHROME_PORT})
  ${GREEN}--output-dir <dir>${NC}       Output directory (default: ${DEFAULT_OUTPUT_DIR})
  ${GREEN}--persist-db <bool>${NC}      Persist to database (default: ${DEFAULT_PERSIST_DB})
  ${GREEN}--include-artifacts${NC}      Include artifacts in output
  ${GREEN}--page-info-only${NC}         Crawl page info only (skip posts)
  ${GREEN}--page-posts-only${NC}        Crawl page posts only (skip info)
  ${GREEN}--dry-run${NC}                Show what would be crawled without executing
  ${GREEN}--verbose${NC}                Verbose output
  ${GREEN}--help, -h${NC}               Show this help message

${YELLOW}Examples:${NC}
  ${GREEN}./scripts/crawl_pages.sh${NC}
      Crawl all tracked pages with default settings

  ${GREEN}./scripts/crawl_pages.sh --limit 5 --max-scrolls 10${NC}
      Crawl first 5 pages with 10 scrolls each

  ${GREEN}./scripts/crawl_pages.sh --page-id 123456789 --page-info-only${NC}
      Crawl page info for specific page ID only

  ${GREEN}./scripts/crawl_pages.sh --url "https://www.facebook.com/somepage"${NC}
      Crawl a specific page by URL

  ${GREEN}./scripts/crawl_pages.sh --dry-run --verbose${NC}
      Preview what would be crawled

EOF
  exit 0
}

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_verbose() {
  if [[ "${VERBOSE}" == "true" ]]; then
    echo -e "${BLUE}[DEBUG]${NC} $1"
  fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    --page-id)
      SPECIFIC_PAGE_ID="$2"
      shift 2
      ;;
    --url)
      SPECIFIC_URL="$2"
      shift 2
      ;;
    --max-scrolls)
      MAX_SCROLLS="$2"
      shift 2
      ;;
    --scroll-delay-ms)
      SCROLL_DELAY_MS="$2"
      shift 2
      ;;
    --timeout-ms)
      TIMEOUT_MS="$2"
      shift 2
      ;;
    --chrome-port)
      CHROME_PORT="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --persist-db)
      PERSIST_DB="$2"
      shift 2
      ;;
    --include-artifacts)
      INCLUDE_ARTIFACTS=true
      shift
      ;;
    --page-info-only)
      CRAWL_PAGE_INFO=true
      CRAWL_PAGE_POSTS=false
      shift
      ;;
    --page-posts-only)
      CRAWL_PAGE_INFO=false
      CRAWL_PAGE_POSTS=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      log_error "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Check if psql is available
if ! command -v psql &> /dev/null; then
  log_error "psql is not installed or not in PATH"
  exit 1
fi

# Check database connectivity
check_db_connection() {
  if ! psql -c "SELECT 1" &> /dev/null; then
    log_error "Cannot connect to PostgreSQL database"
    log_error "Database: ${PGDATABASE} at ${PGHOST}:${PGPORT}"
    exit 1
  fi
}

# Get list of pages to crawl
get_pages_to_crawl() {
  if [[ -n "${SPECIFIC_PAGE_ID:-}" ]]; then
    psql -t -A -c "
      SELECT page_id, canonical_url, name
      FROM scraper.facebook_pages
      WHERE page_id = '${SPECIFIC_PAGE_ID}';
    "
  elif [[ -n "${SPECIFIC_URL:-}" ]]; then
    psql -t -A -c "
      SELECT page_id, canonical_url, name
      FROM scraper.facebook_pages
      WHERE canonical_url = '${SPECIFIC_URL}'
         OR canonical_url LIKE '%/${SPECIFIC_URL}/%'
         OR canonical_url LIKE '%/${SPECIFIC_URL}';
    "
  else
    local limit_clause=""
    if [[ "${LIMIT}" -gt 0 ]]; then
      limit_clause="LIMIT ${LIMIT}"
    fi
    psql -t -A -c "
      SELECT page_id, canonical_url, name
      FROM scraper.facebook_pages
      ORDER BY last_scraped_at ASC NULLS FIRST
      ${limit_clause};
    "
  fi
}

# Crawl page info
crawl_page_info() {
  local page_url="$1"
  local page_id="$2"
  local output_subdir="${OUTPUT_DIR}/page_info/${page_id}"
  
  local cmd="bun run ${PROJECT_ROOT}/src/cli/scrape_page_info.ts"
  cmd+=" --url \"${page_url}\""
  cmd+=" --chrome-port ${CHROME_PORT}"
  cmd+=" --output-dir \"${output_subdir}\""
  cmd+=" --max-scrolls ${MAX_SCROLLS}"
  cmd+=" --scroll-delay-ms ${SCROLL_DELAY_MS}"
  cmd+=" --timeout-ms ${TIMEOUT_MS}"
  
  if [[ "${PERSIST_DB}" == "true" ]]; then
    cmd+=" --persist-db=true"
  else
    cmd+=" --persist-db=false"
  fi
  
  if [[ "${INCLUDE_ARTIFACTS}" == "true" ]]; then
    cmd+=" --include-artifacts"
  fi
  
  log_verbose "Running: ${cmd}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "  [DRY-RUN] Would execute: ${cmd}"
    return 0
  fi
  
  if eval "${cmd}"; then
    return 0
  else
    return 1
  fi
}

# Crawl page posts
crawl_page_posts() {
  local page_url="$1"
  local page_id="$2"
  local output_subdir="${OUTPUT_DIR}/page_posts/${page_id}"
  
  local cmd="bun run ${PROJECT_ROOT}/src/cli/scrape_page_posts.ts"
  cmd+=" --url \"${page_url}\""
  cmd+=" --chrome-port ${CHROME_PORT}"
  cmd+=" --output-dir \"${output_subdir}\""
  cmd+=" --max-scrolls ${MAX_SCROLLS}"
  cmd+=" --scroll-delay-ms ${SCROLL_DELAY_MS}"
  cmd+=" --timeout-ms ${TIMEOUT_MS}"
  
  if [[ "${PERSIST_DB}" == "true" ]]; then
    cmd+=" --persist-db=true"
  else
    cmd+=" --persist-db=false"
  fi
  
  if [[ "${INCLUDE_ARTIFACTS}" == "true" ]]; then
    cmd+=" --include-artifacts"
  fi
  
  log_verbose "Running: ${cmd}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "  [DRY-RUN] Would execute: ${cmd}"
    return 0
  fi
  
  if eval "${cmd}"; then
    return 0
  else
    return 1
  fi
}

# Main execution
main() {
  echo ""
  echo "=============================================="
  echo "  ${BLUE}Facebook Page Crawler${NC}"
  echo "=============================================="
  echo ""
  
  # Check DB connection
  check_db_connection
  log_verbose "Database connection OK"
  
  # Get pages to crawl
  log_info "Fetching pages to crawl..."
  
  local pages
  pages=$(get_pages_to_crawl)
  
  if [[ -z "${pages}" ]]; then
    if [[ -n "${SPECIFIC_PAGE_ID:-}" ]]; then
      log_error "Page ID '${SPECIFIC_PAGE_ID}' not found in database"
    elif [[ -n "${SPECIFIC_URL:-}" ]]; then
      log_error "URL '${SPECIFIC_URL}' not found in database"
    else
      log_warning "No tracked pages found in database"
      log_info "Run scrapers first to populate the database"
    fi
    exit 1
  fi
  
  # Count pages
  TOTAL_PAGES=$(echo "${pages}" | wc -l | tr -d ' ')
  
  echo ""
  echo "${YELLOW}Configuration:${NC}"
  echo "  Max scrolls:        ${MAX_SCROLLS}"
  echo "  Scroll delay:       ${SCROLL_DELAY_MS}ms"
  echo "  Timeout:            ${TIMEOUT_MS}ms"
  echo "  Chrome port:        ${CHROME_PORT}"
  echo "  Output directory:   ${OUTPUT_DIR}"
  echo "  Persist to DB:      ${PERSIST_DB}"
  echo "  Include artifacts:  ${INCLUDE_ARTIFACTS}"
  echo "  Crawl page info:    ${CRAWL_PAGE_INFO}"
  echo "  Crawl page posts:   ${CRAWL_PAGE_POSTS}"
  echo ""
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "${YELLOW}=== DRY RUN MODE - No actual scraping will occur ===${NC}"
    echo ""
  fi
  
  echo "${YELLOW}Pages to crawl: ${TOTAL_PAGES}${NC}"
  echo ""
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "${YELLOW}Would crawl the following pages:${NC}"
    echo "${pages}" | while IFS='|' read -r page_id page_url page_name; do
      echo "  - ${page_name:-Unknown} (${page_id})"
      echo "    URL: ${page_url}"
      [[ "${CRAWL_PAGE_INFO}" == "true" ]] && echo "    → Page Info"
      [[ "${CRAWL_PAGE_POSTS}" == "true" ]] && echo "    → Page Posts"
      echo ""
    done
    exit 0
  fi
  
  # Create output directory
  mkdir -p "${OUTPUT_DIR}"
  
  # Crawl each page
  echo "${YELLOW}Starting crawl...${NC}"
  echo ""
  
  local current=0
  echo "${pages}" | while IFS='|' read -r page_id page_url page_name; do
    current=$((current + 1))
    local page_name_display="${page_name:-Unknown}"
    
    echo "----------------------------------------------"
    echo "${BLUE}[${current}/${TOTAL_PAGES}]${NC} ${page_name_display}"
    echo "  Page ID: ${page_id}"
    echo "  URL:     ${page_url}"
    echo ""
    
    local page_info_result="skipped"
    local page_posts_result="skipped"
    
    # Crawl page info
    if [[ "${CRAWL_PAGE_INFO}" == "true" ]]; then
      log_info "Crawling page info..."
      if crawl_page_info "${page_url}" "${page_id}"; then
        log_success "Page info completed"
        page_info_result="success"
      else
        log_error "Page info failed"
        page_info_result="failed"
      fi
    fi
    
    # Crawl page posts
    if [[ "${CRAWL_PAGE_POSTS}" == "true" ]]; then
      log_info "Crawling page posts..."
      if crawl_page_posts "${page_url}" "${page_id}"; then
        log_success "Page posts completed"
        page_posts_result="success"
      else
        log_error "Page posts failed"
        page_posts_result="failed"
      fi
    fi
    
    echo ""
  done
  
  # Summary
  echo ""
  echo "=============================================="
  echo "  ${BLUE}Crawl Summary${NC}"
  echo "=============================================="
  echo ""
  echo "  Total pages:    ${TOTAL_PAGES}"
  echo "  Output dir:     ${OUTPUT_DIR}"
  echo ""
  echo "${GREEN}Crawl completed!${NC}"
  echo ""
}

# Run main
main
