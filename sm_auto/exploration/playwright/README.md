# Facebook Page Scraper & Analyzer

This directory contains scripts to autonomously connect to a running Chrome instance, scrape a Facebook page deeply (intercepting hidden GraphQL data and visual DOM nodes), and filter that data.

## Prerequisites

1.  **Node.js, Bun & Puppeteer-core:**
    Ensure you have `bun` installed (recommended over `npm` for performance). If you don't have `puppeteer-core` or `node-fetch` in this directory, run:
    ```bash
    bun add puppeteer-core node-fetch
    ```

2.  **Running Chrome with Debugging:**
    You must have an active Chrome browser running with the remote debugging port enabled. 
    Start Chrome via terminal:
    ```bash
    google-chrome --remote-debugging-port=9222 --no-first-run --no-default-browser-check --no-sandbox --user-data-dir="/tmp/chrome-profile"
    ```
    *(Note: Using your personal Chrome profile allows scraping as a logged-in user, which is crucial for accessing some data).*

## Automated Facebook Page Scraper (`facebook_page_scraper.js`)

This is the production-ready script that implements the hybrid scraping strategy (Puppeteer-driven browser automation combined with network interception and targeted DOM parsing). It extracts a comprehensive catalog of a Facebook page.

### Usage

```bash
bun run facebook_page_scraper.js <facebook_page_url> <output_directory> [max_scrolls]
```

*   `<facebook_page_url>`: The full URL of the Facebook page to scrape (e.g., `https://www.facebook.com/ryanscomputersbanani`).
*   `<output_directory>`: The directory where the `final_page_catalog.json` (and intermediate raw data files) will be saved.
*   `[max_scrolls]`: (Optional) The number of times to scroll down the page to load more posts. Defaults to 15.

### Example

```bash
bun run facebook_page_scraper.js https://www.facebook.com/ryanscomputersbanani /root/output_data 20
```

This will generate the `final_page_catalog.json` in `/root/output_data`, containing all available metadata, posts, media, and interaction metrics.

## Helper Scripts (Intermediate Analysis)

The following scripts were used during the exploration phase to generate the comprehensive raw data and perform initial filtering. They are now superseded by `facebook_page_scraper.js` for full automation, but remain for reference or debugging.

### 1. Generate the Raw Comprehensive Data (`comprehensive_scraper.js`)
To scrape the page and generate the massive raw data file:
```bash
node /root/codebase/sm-auto/sm_auto/exploration/comprehensive_scraper.js
```
**What this does:** 
*   Connects to Chrome on port 9222.
*   Navigates to the target Facebook page.
*   Scrolls deeply to trigger lazy-loaded posts.
*   Interceptors and parses every single `api/graphql` network response.
*   Extracts the entire DOM's textual layout.
*   Saves everything to `fb_comprehensive_data.json` (~20-30MB).

### 2. Filter and Analyze the Data (`filter_data.js`)
To parse the massive raw JSON and extract the key information:
```bash
node /root/codebase/sm-auto/sm_auto/exploration/filter_data.js
```
**What this does:**
*   Reads `fb_comprehensive_data.json`.
*   Extracts contact info, addresses, and follower counts from the DOM.
*   Digs into the complex GraphQL JSON trees to find high-resolution photo URLs and videos.
*   Generates `filtered_facebook_data.json`.
*   Generates `analysis_report.md` summarizing the findings.
