#!/usr/bin/env bash
#
# List all tracked Facebook pages from the database
# Usage: ./scripts/list_pages.sh
#

set -euo pipefail

# Load environment variables if .env exists
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

# Default values (match .env.example)
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-facebook_scraper}"
PGUSER="${PGUSER:-agent0}"
PGPASSWORD="${PGPASSWORD:-}"
PGSSLMODE="${PGSSLMODE:-disable}"

export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE

# Check if psql is available
if ! command -v psql &> /dev/null; then
  echo "Error: psql is not installed or not in PATH"
  echo "Install PostgreSQL client or use: docker run --rm -e PGHOST=host.docker.internal postgres psql ..."
  exit 1
fi

# Check database connectivity
if ! psql -c "SELECT 1" &> /dev/null; then
  echo "Error: Cannot connect to PostgreSQL database"
  echo "Database: ${PGDATABASE} at ${PGHOST}:${PGPORT}"
  echo "User: ${PGUSER}"
  echo ""
  echo "Make sure:"
  echo "  1. PostgreSQL is running"
  echo "  2. Database '${PGDATABASE}' exists"
  echo "  3. User '${PGUSER}' has access"
  echo "  4. Environment variables are set correctly"
  exit 1
fi

# Query Facebook pages
psql -c "
SELECT 
  page_id,
  name,
  category,
  followers,
  canonical_url,
  creation_date_text,
  first_seen_at,
  last_scraped_at
FROM scraper.facebook_pages
ORDER BY last_scraped_at DESC NULLS LAST;
"

echo ""
echo "--- Summary ---"
psql -t -c "SELECT COUNT(*) || ' page(s) tracked' FROM scraper.facebook_pages;"
