# Facebook GraphQL Scraper with Playwright/CDP
# A modified version of facebook-graphql-scraper that uses Playwright instead of Selenium

## Requirements

Install the required dependencies:

```bash
pip install pandas beautifulsoup4 requests playwright
playwright install chromium
```

## Usage

### Prerequisites

1. Start Chrome with remote debugging enabled:
```bash
google-chrome --remote-debugging-port=9222 --no-first-run --no-default-browser-check --no-sandbox --user-data-dir="/tmp/chrome-profile"
```

2. Use an existing authenticated Chrome profile to avoid login issues.

### Example

```python
from fb_graphql_scraper_puppeteer import FacebookBrowserScraper

scraper = FacebookBrowserScraper()
result = scraper.scrape_page('ryanscomputersbanani', max_scrolls=10)
print(result['page_info'])
scraper.close()
```

## Files

- `facebook_browser_scraper.py` - Main scraper using Playwright CDP to connect to existing browser
- `facebook_playwright_scraper.py` - Alternative implementation using Playwright (may need debugging)
- `facebook_direct_api_scraper.py` - Direct API approach (experimental - may not work with extracted cookies)

## Key Differences from Original

- **Browser**: Uses Playwright (pyppeteer/playwright) instead of Selenium + ChromeDriver
- **Connection**: Connects to existing Chrome via CDP (remote debugging port 9222)
- **No ChromeDriver needed**: Uses existing Chrome installation
- **Authentication**: Uses your logged-in Chrome profile, avoiding login-based scraping issues
- **Network Interception**: Uses Playwright's response event to capture GraphQL

## Notes

The scraper works with an existing authenticated browser session. It:
1. Connects to Chrome via CDP (port 9222)
2. Navigates to the Facebook page
3. Extracts page info from DOM (name, followers, address, phone)
4. Captures GraphQL responses during scrolling
5. Parses the responses for post data

The effectiveness depends on:
- Whether the Facebook page allows non-logged-in viewing
- Facebook's current API structure
- Browser authentication state
