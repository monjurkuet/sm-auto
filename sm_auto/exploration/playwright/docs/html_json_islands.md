# Facebook HTML JSON Data Islands (SPA Architecture)

## Overview
During the deep analysis of Facebook's frontend Document Object Model (DOM), we discovered that standard HTML scraping techniques (like parsing `<p>` or `<div>` tags directly from the raw `index.html` source) will completely fail on modern Facebook Pages.

This is because Facebook uses a highly specialized React-based Single Page Application (SPA) architecture, powered by a system internally called `ScheduledServerJS`.

## The "Data Island" Phenomenon

When you make a standard GET request to a Facebook Page (e.g., `https://www.facebook.com/ryanscomputersbanani/about_profile_transparency`), the server does **not** return the populated HTML structure. 

Instead, the server returns an empty HTML shell populated with **JSON Data Islands**.

### 1. Structure of an Island
A data island is a massive JSON payload embedded directly within a `<script>` tag. In a standard page load, we detected **169 separate JSON islands** totaling over **3 Megabytes** of raw text.

They look like this in the raw HTML:
```html
<script type="application/json" data-sjs="" data-processed="1">
{"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"require":[... massive payload ...]}}]]]}
</script>
```

### 2. How Facebook Uses Them
1.  **Initial Load:** The browser downloads the HTML containing these script tags.
2.  **Hydration:** Facebook's React engine boots up.
3.  **Consumption:** The engine reads the `{"require": ...}` JSON blocks. These blocks contain the exact GraphQL cache (`RelayPrefetchedStreamCache`) and component states needed to render the page.
4.  **Rendering:** React uses this JSON data to dynamically build the `<div>` and `<span>` elements you actually see on screen.

### 3. Impact on Scraping

This architecture completely breaks simple scrapers (like Python's `BeautifulSoup` or `requests` library). 
If you search the raw HTML for the phrase `"Page created"`, you will **not find it**, even if you are on the Transparency page. 

**Why?**
*   Because the string `"Page created"` is stored as a dynamic React translation node or fetched via a secondary WebSocket GraphQL stream *after* the initial HTML has loaded.
*   The raw HTML only contains routing policies (e.g., `"cePolicy":"comet.profile.collection.about_profile_transparency"`).

## The Extraction Solution

To successfully extract data from Facebook's SPA architecture, we **must** use a headless browser (like Puppeteer) with the following approach:

1.  **Network Interception First:** Intercept the raw GraphQL responses traversing the WebSocket/XHR interfaces, as they bypass the complex HTML parsing entirely.
2.  **DOM Evaluation Second:** Instead of downloading the HTML source, we must use `page.evaluate()` to let Facebook's React engine finish "painting" the UI from the data islands, and *then* scrape the fully rendered `document.body.innerText`.
3.  **Active Clicking (Stealth):** For hidden sections like Page Transparency or Admin Locations, the initial HTML data islands do not contain the data at all. A scraper must physically `click()` the UI tabs to force the React engine to dispatch a new GraphQL request to populate those specific components.
