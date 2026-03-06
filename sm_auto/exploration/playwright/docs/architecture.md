# Facebook Data Architecture (GraphQL & DOM Schema)

This document provides an exhaustive map of the data structures discovered inside Facebook's raw GraphQL payload (based on a 27MB intercepted feed scrape) and the frontend Document Object Model (DOM).

## Part 1: The DOM (Visual Frontend) Schema

While Facebook hides a lot of data in its background GraphQL requests, certain elements are best (and sometimes only) extracted by parsing the fully rendered HTML DOM.

### 1. ARIA Accessibility Labels (The Metric Goldmine)
Because Facebook intentionally obfuscates raw integer counts for metrics (likes, shares, comments) in the GraphQL feed, the DOM's `aria-label` attributes act as the absolute source of truth.
*   **Metric Extraction:** Elements with `role="button"` or `role="link"` contain labels like `"Like: 41 people"` or `"7 reactions; see who reacted to this"`.
*   **Commenter Tracking:** ARIA labels provide the exact string for commenters: `"Comment by [Name] a [Time] ago"`. By mapping these linearly, we can attribute commenters to specific posts without extra network requests.

### 2. Semantic Text Groupings
Facebook's React frontend maintains relatively consistent semantic tags for the Page's core identity.
*   **`<h1>`**: The core Page Name (e.g., `"Ryans Computers Ltd. (Banani)"`).
*   **`<h2>`**: Section headers used to categorize the layout (e.g., `"Details"`, `"Services"`, `"Contact info"`).
*   **`<span>`**: Used heavily for follower counts (`"241 followers • 0 following"`).

### 3. Links & Action Mapping
The DOM correctly renders all active, visible links.
*   **Contact Actions:** Standard `href` tags contain clean `mailto:` or `tel:`.
*   **User Navigation:** Links terminating in `/profile.php` or `facebook.com/[user]` point to interacting users or tagged entities.

### 4. DOM Post Wrappers
Posts can be visually identified in the DOM using the attribute `data-ad-preview="message"`. This provides the raw, formatted HTML layout of the post exactly as the user sees it, which is sometimes cleaner than the fragmented GraphQL `message.ranges`.

---

## Part 2: Top-Level GraphQL Feed Queries

When scrolling, Facebook relies primarily on the `ProfileCometTimelineFeedRefetchQuery`. The payload is a deeply nested tree.

### The "Story" (Post) Object Schema
A typical post is represented as a `Story` object with the following crucial fields:

*   **`id`** (`String`): The internal GraphQL node ID (base64 encoded, e.g., `UzpfSTEwMDA2...`).
*   **`post_id`** (`String`): The raw integer ID of the post (e.g., `1334845018681780`). Useful for constructing direct permalinks.
*   **`url`** / **`permalink_url`** (`String`): Direct link to the post (if available).
*   **`creation_time`** (`Integer`): Epoch timestamp. *Note: Found deeply nested under `comet_sections.context_layout` in some architectures rather than the root story node.*
*   **`message.text`** (`String`): The actual textual caption of the post.
*   **`message.ranges`** (`Array`): Contains `Hashtag` and mention entities with their exact string matching ranges.

#### Tracking & Ads
Facebook injects significant telemetry into every post:
*   **`encrypted_tracking`** (`String`): A massive encrypted blob sent back to Facebook when clicked.
*   **`trackingdata.ei`** (`String`): Event Identifier for telemetry.
*   **`sponsored_data`** (`Object`): If present, indicates the post is an Ad. Contains `ad_id` and `client_token`.

#### The `comet_sections` Object (The Rendering Engine)
Facebook hides the actual user-facing data (what the UI renders) inside a complex object called `comet_sections`.
*   **`context_layout`**: Determines how the author and timestamp are displayed.
*   **`message_container`**: The wrapper around the text.
*   **`feedback`**: The crucial wrapper for interactions (Likes/Comments).

## Part 3: Interactions (The Feedback Object)
Interactions are notoriously difficult to parse directly because Facebook hides the raw integers. The `feedback` object (type `CometFeedUFIContainer_feedback`) handles this:

*   **`feedback.id`** (`String`): E.g., `ZmVlZGJhY2s6MTMzND...`. This ID is required to make subsequent GraphQL calls to fetch the specific users who liked/commented.
*   **Reactions (`top_reactions`)**: Does *not* usually contain a flat integer count. Instead, it provides an array of reaction types used (e.g., `["Like", "Love", "Haha"]`).
*   *Workaround:* To get exact reaction counts, we must correlate the GraphQL `Story` node with the `ARIA-label` in the DOM as detailed in Part 1.
*   **Direct Counts (Potential):** Some GraphQL `doc_id`s in older or alternative queries may directly expose `reaction_count.count`, `comment_rendering_instance.comments.total_count`, and `share_count.count`. Further investigation is needed to identify these specific query parameters.

## Part 4: Media Attachments (`attachments` array)
Posts contain media in the `attachments` array. Each attachment has a `media` object:

### Photo (`__typename: "Photo"`)
*   **`id`** (`String`): Photo ID.
*   **`photo_image.uri`** (`String`): The high-resolution direct URL.
*   **`viewer_image.width` / `height`** (`Integer`): Dimensions.

### Video (`__typename: "Video"`)
*   **`id`** (`String`): Video ID.
*   **`playable_url`** (`String`): The MP4 direct link (often requires active session cookies to play).
*   **`dash_manifest`** (`String`): XML manifest for high-quality streaming (not always present).
*   **`is_reel`** (`Boolean`): Flag to identify short-form videos (Reels/Shorts), based on aspect ratio or internal flags.

### External Links (`__typename: "ExternalUrl"`)
*   Facebook masks outbound links. They are represented as `https://l.facebook.com/l.php?u=...`. The actual URL must be parsed from the `u` search parameter.

## Part 5: Page Metadata ("The New Page Experience")
A critical discovery: Facebook no longer represents most business pages as `Page` entities. They are now `User` entities.
*   When querying the API for a business page, you will receive `__typename: "User"`.
*   Because of this, standard `Page` fields (like `category_name`, `global_brand_like_count`, `is_always_open`) are **missing** from the root GraphQL response.
*   To extract deep page metadata (like the exact creation date or Page Transparency location data), one must use Puppeteer to explicitly click the `About -> Page transparency` UI tabs to trigger the specific SPA (Single Page Application) sub-queries, as this data is not loaded in the standard timeline feed.
*   **HTML Data Islands:** When forcing a direct load of the transparency page, the data is not in standard DOM nodes, but rather embedded in massive `<script type="application/json">` blocks handled by Facebook's React runtime (`ScheduledServerJS`).
*   **Follower Count Robustness:** The most reliable way to get an accurate follower count is to scrape the embedded Facebook plugin page: `https://www.facebook.com/plugins/page.php?href=...`

## Part 6: Advanced Telemetry, Media, and UI Configurations (New Discoveries)

### 1. Hardware Fingerprinting (`device_created_on`)
Facebook's GraphQL responses reveal highly specific hardware information of registered devices for the logged-in user.
*   **Location:** Found within `xfb_backup.virtual_devices` objects.
*   **Data Points:** `device_type` (`GOOGLE_ONE_AUTO_BACKUP`, `KEYCHAIN`, `BLOCK_STORE`), `device_created_on` (e.g., `Apple iPhone XS`, `Realme RMX3871`), `creation_time` (epoch timestamp of device registration).
*   **Implication:** This indicates a high level of device tracking. For Puppeteer-based scraping, maintaining consistent browser/device profiles (user-agent, viewport, etc.) is crucial.

### 2. Hidden Media Sets (`MediaUploadedByUserMediaSet`)
Photos on Facebook are organized into underlying "media sets" or albums, which are addressable via GraphQL.
*   **Discovery:** Photos are frequently tied to a parent `MediaUploadedByUserMediaSet` object with an associated Base64 `id` (e.g., `bWVkaWFzZXQ6cGIuNjE1NzY4Mzk4Njc4MDUuLTIyMDc1MjAwMDA=`).
*   **Implication:** This ID can be used in targeted GraphQL queries to fetch an entire album's contents without needing to scroll.

### 3. Dynamic UI Configurations (`reaction_display_config`, `inline_survey_config`)
Facebook's GraphQL responses dictate UI rendering rules, not just raw data.
*   **`reaction_display_config`:** Controls how reactions are displayed (e.g., showing icons vs. summary strings).
*   **`inline_survey_config`:** Contains triggers for injecting user surveys directly into the feed based on user behavior.

### 4. The Analytics "Banzai" Endpoint (`/ajax/bnzai`)
Beyond GraphQL, Facebook makes frequent calls to telemetry endpoints.
*   `/ajax/bnzai`: This endpoint receives continuous payloads tracking user interaction (scroll speed, hover events, viewport visibility). It's Facebook's real-time analytics system.

## Part 7: Client-Side GraphQL Interception (Alternative Scraping Strategy)
Exploring `floriandiud/facebook-group-members-scraper` revealed an alternative method for data extraction: client-side interception.
*   **Mechanism:** This method involves injecting a JavaScript script directly into the user's browser (e.g., via a browser extension). This script then hijacks `XMLHttpRequest.prototype.open` to intercept *all* AJAX requests made by the Facebook page itself.
*   **Advantages:**
    *   Leverages the user's active logged-in session, bypassing complex authentication flows.
    *   Traffic appears as legitimate browser requests, potentially reducing detection risks.
    *   No need for external headless browser management.
*   **Disadvantages:**
    *   Less scalable for large-scale, automated scraping tasks without complex browser farm setups.
    *   Limited control over navigation compared to server-side browser automation tools like Puppeteer.
*   **Specific Group GraphQL Queries:** This method successfully revealed group-specific GraphQL structures (e.g., `data.group.new_members.edges` or `data.node.__typename === 'Group'`) for extracting member lists, a distinct data domain from page posts.

## Conclusion
A complete scraping solution *must* be a hybrid engine:
1.  **GraphQL Interception:** For High-Resolution Media, Historical Posts, Exact Timestamps, and deep structural hierarchies. Efficiently using direct `requests` for pagination after initial `doc_id` acquisition.
2.  **DOM ARIA Parsing:** To unlock the hidden integers for likes, shares, and comment attribution, and other visible textual metadata.
3.  **Active SPA Navigation:** To force Facebook to fetch protected page metadata (like Page Transparency) that is omitted from the standard feed.
4.  **Targeted Plugin Scraping:** For robust extraction of follower counts and certain image data from Facebook's dedicated plugin URLs.

---
*Documented during the SM-Auto Exploration Phase, comparing with existing open-source scrapers for enhanced insights.*
