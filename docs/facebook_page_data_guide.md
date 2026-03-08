# Facebook Page Crawler - Data Guide

## 1. Data Points Stored

### FacebookPage Model (Page Metadata)

Stored in `facebook_pages` MongoDB collection:

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `page_id` | str | GraphQL/HTML | Unique Facebook page ID |
| `page_url` str | Input | Full Facebook URL |
| `username` | str | URL | Vanity URL (e.g., "applegadgetsltd") |
| `page_name` | str | HTML/JS DOM | Page display name |
| `description` | str | HTML | Page description |
| `email` | str | HTML/GraphQL | Contact email |
| `phone` | str | HTML/GraphQL | Contact phone |
| `website` | str | HTML | External website |
| `location` | str | HTML | City/country |
| `category` | str | HTML | Page category |
| `profile_image_url` | str | HTML/JS | Profile photo URL |
| `cover_image_url` | str | HTML/JS | Cover photo URL |
| `is_verified` | bool | HTML | Blue checkmark status |
| `page_created` | str | Transparency page | Page creation date |
| `first_seen` | datetime | Auto | When page was added |
| `last_checked` | datetime | Auto | Last update timestamp |

### FacebookPageMetric Model (Time-Series)

Stored in `facebook_page_metrics` MongoDB collection:

| Field | Type | Description |
|-------|------|-------------|
| `page_id` | str | Reference to page |
| `likes` | str | Like count (e.g., "1.2M") |
| `likes_numeric` | int | Parsed numeric value |
| `followers` | str | Follower count |
| `followers_numeric` | int | Parsed numeric value |
| `talking_about` | str | People talking about |
| `talking_about_numeric` | int | Parsed numeric value |
| `checkins` | str | Check-in count |
| `checkins_numeric` | int | Parsed numeric value |
| `recorded_at` | datetime | When metric was recorded |

## 2. MongoDB Storage

### Connection

```python
# From storage.py
uri: "mongodb://localhost:27017"  # Or MONGODB_URI env var
database: "sm_auto"
```

### Collections

```
sm_auto.facebook_pages       # Page metadata (one document per page)
sm_auto.facebook_page_metrics # Time-series metrics (many per page)
```

### Indexes

```javascript
// facebook_pages
{ "page_id": 1 }           // Unique - primary key
{ "page_url": 1 }           // For lookups
{ "username": 1 }           // For lookups
{ "last_checked": 1 }       // For sorting by update time
{ "first_seen": 1 }         // For sorting by creation time

// facebook_page_metrics  
{ "page_id": 1 }                        // For joining
{ "page_id": 1, "recorded_at": -1 }     // For time-series queries
{ "recorded_at": 1 }                    // For time-range queries
```

## 3. How to Crawl Data

### Prerequisites

1. Install dependencies:
```bash
uv pip install -e .
```

2. Set MongoDB connection in `.env`:
```bash
MONGODB_URI=mongodb://localhost:27017
```

3. Set up Chrome profile (for authenticated requests):
```bash
# Profile path from chrome://version
PROFILE_PATH="/root/.config/google-chrome/Default"
```

### Commands

#### Add Pages from CSV

Create `pages.csv`:
```csv
url,notes
https://www.facebook.com/applegadgetsltd,Tech store in BD
https://www.facebook.com/GoriberGadget,Budget gadgets
https://www.facebook.com/RyansComputersBanani,Electronics
```

Run:
```bash
uv run sm-auto run facebook-page --csv pages.csv --profile-path "$PROFILE_PATH"
```

#### Update All Pages

```bash
uv run sm-auto run facebook-page --update --profile-path "$PROFILE_PATH"
```

#### Update Specific Page

```bash
uv run sm-auto run facebook-page --url "https://www.facebook.com/applegadgetsltd" --profile-path "$PROFILE_PATH"
```

#### View Pages in Database

```bash
# Using mongosh
mongosh sm_auto --eval "db.facebook_pages.find({}, {page_name:1, followers:1, likes:1})"
```

### Configuration

In `sm_auto/config/default_config.yaml`:

```yaml
platforms:
  facebook:
    max_scrolls: 15           # Scroll pages for lazy loading
    wait_after_scroll: 2      # Seconds to wait after scroll
    timeout: 30               # Page load timeout
```

Override via CLI:
```bash
uv run sm-auto run facebook-page --update --max-scrolls 20 --profile-path "$PROFILE_PATH"
```

## 4. Extraction Priority

The system uses a multi-source extraction strategy:

```
┌─────────────────────────────────────────┐
│ 1. HTML Extraction                      │
│    - Meta tags (og:title, og:description)│
│    - JSON script tags                    │
│    - profile_social_context              │
└───────────────┬─────────────────────────┘
                ▼
┌─────────────────────────────────────────┐
│ 2. GraphQL Extraction                   │
│    - Contact info (email, phone)         │
│    - Page ID                            │
│    (Note: No followers/likes in GraphQL) │
└───────────────┬─────────────────────────┘
                ▼
┌─────────────────────────────────────────┐
│ 3. ARIA Labels Extraction               │
│    - aria-label attributes               │
└───────────────┬─────────────────────────┘
                ▼
┌─────────────────────────────────────────┐
│ 4. JavaScript DOM Extraction            │
│    - Query DOM elements                 │
│    - Extract from text nodes             │
│    - Fallback: URL → username           │
└─────────────────────────────────────────┘
```

**Priority Logic:** Each source only fills in EMPTY fields - no overwriting of existing data.

## 5. Data Sources by Field

| Field | Primary Source | Fallback |
|-------|---------------|----------|
| page_id | GraphQL | HTML (delegate_page) |
| page_name | HTML (og:title) | JS DOM |
| followers | HTML (profile_social_context) | JS DOM |
| likes | HTML (profile_social_context) | JS DOM |
| category | HTML | JS DOM |
| location | HTML | JS DOM |
| email | GraphQL | HTML |
| phone | GraphQL | HTML |
| website | HTML | GraphQL |
| profile_image | JS DOM | HTML |
| cover_image | JS DOM | HTML |

## 6. Current Limitations

1. **No likes for User profiles**: Only Facebook Pages show "likes" - User profiles only show "followers"
2. **GraphQL doesn't contain page metrics**: Followers/likes come from HTML/DOM, not GraphQL
3. **Contact info not always available**: Only captured when GraphQL returns profile_tile_sections data

## 7. Example MongoDB Documents

```javascript
// facebook_pages
{
  "_id": ObjectId("..."),
  "page_id": "100063979652930",
  "page_url": "https://www.facebook.com/applegadgetsltd",
  "username": "applegadgetsltd",
  "page_name": "Apple Gadgets Bangladesh",
  "category": "Electronics",
  "location": "Dhaka, Bangladesh",
  "likes": "1.2M",
  "followers": "1.2M",
  "email": "contact@applegadgetsbd.com",
  "phone": "+8801...",
  "is_verified": false,
  "first_seen": ISODate("2026-03-01T00:00:00Z"),
  "last_checked": ISODate("2026-03-07T12:00:00Z")
}

// facebook_page_metrics
{
  "_id": ObjectId("..."),
  "page_id": "100063979652930",
  "likes": "1.2M",
  "likes_numeric": 1200000,
  "followers": "1.2M",
  "followers_numeric": 1200000,
  "talking_about": "15000",
  "talking_about_numeric": 15000,
  "recorded_at": ISODate("2026-03-07T12:00:00Z")
}
```
