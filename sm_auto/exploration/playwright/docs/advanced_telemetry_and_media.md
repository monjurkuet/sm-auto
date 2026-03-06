# Advanced Telemetry, Media, and UI Configurations

During our exploratory analysis of the 27MB raw GraphQL and HTML payload, we discovered several hidden mechanisms Facebook uses for tracking, media grouping, and dynamic UI rendering.

## 1. Hardware Fingerprinting (`device_created_on`)
We discovered that Facebook transmits highly specific hardware and backup state data, even when simply scrolling a business page.

*   **Discovery:** A node called `xfb_backup` contains a `virtual_devices` array.
*   **What it tracks:** It logs the exact hardware model (e.g., `Apple iPhone XS`, `Realme RMX3871`, `Xiaomi Redmi Note 11S`), the `device_type` (`GOOGLE_ONE_AUTO_BACKUP`, `KEYCHAIN`, `BLOCK_STORE`), and the exact `creation_time` of that device registration on Facebook's servers.
*   **Implication for Scraping:** Facebook is deeply aware of the hardware footprint of the logged-in session. When using Puppeteer, ensuring consistent stealth profiles is critical, as Facebook can read the underlying device/backup keys tied to the session.

## 2. Hidden Media Sets (`MediaUploadedByUserMediaSet`)
When analyzing how photos are structured on the page, we found they are not just disjointed nodes.

*   **Discovery:** Photos are frequently tied to a parent `MediaUploadedByUserMediaSet` object.
*   **The ID:** We extracted a specific Base64 ID for the page's primary media set: `bWVkaWFzZXQ6cGIuNjE1NzY4Mzk4Njc4MDUuLTIyMDc1MjAwMDA=`.
*   **Implication for Scraping:** If a user wants to download *all* photos from a page, they do not need to scroll the timeline endlessly. Instead, they can construct a targeted GraphQL query requesting edges from this specific `MediaSet` ID, which will return the entire photo history instantly.

## 3. Dynamic UI Configurations (`reaction_display_config`)
Facebook's GraphQL responses dictate exactly *how* the UI should render data, rather than just returning the data itself.

*   **Reaction Display Strategy:** Instead of returning `{"likes": 42}`, the feed returns `reaction_display_config`. This object tells the React frontend whether to show a summary string (`reaction_string_without_viewer`), or whether to hide the count entirely and just show icons (`reaction_display_strategy`).
*   **Inline Surveys (`inline_survey_config`):** We found 55 instances where Facebook pre-loaded a hidden trigger for an inline survey. Based on user scroll speed (tracked via the `/ajax/bnzai` endpoint), Facebook will dynamically swap out a post for a survey if the user hits a specific `survey_id`.

## 4. The Analytics "Banzai" Endpoint (`/ajax/bnzai`)
While we focused heavily on GraphQL, we found Facebook constantly "phoning home" to non-GraphQL endpoints during a scroll session.
*   The most notable is `/ajax/bnzai`.
*   This endpoint receives continuous telemetry payloads (often tracking mouse hovers, scroll velocity, and viewport intersection events) to determine how long a user actually looked at a specific post's `encrypted_tracking` hash.

---
*Documented during the SM-Auto Exploration Phase.*