# Facebook Page Tracking - Implementation Plan

## Overview

Create a Facebook Page tracking feature that:
1. Reads new page URLs from CSV
2. Updates existing pages from database (no CSV needed)
3. Stores data in MongoDB with two collections

---

## Usage Modes

### Mode 1: Add New Pages (from CSV)

```bash
# CSV format (single column)
echo "https://www.facebook.com/cvrng" > pages.csv

# Run - adds new pages to database
sm-auto run facebook-page --csv pages.csv --profile "Personal"
```

### Mode 2: Update Existing Pages (from DB)

```bash
# Update all pages in database
sm-auto run facebook-page --update --profile "Personal"

# Update only pages not checked in X hours
sm-auto run facebook-page --update --stale-hours 24 --profile "Personal"

# Update specific page by URL
sm-auto run facebook-page --update-url "https://www.facebook.com/cvrng" --profile "Personal"

# Update specific page by page_id
sm-auto run facebook-page --update-id "100063979652930" --profile "Personal"
```

---

## CLI Options

```bash
sm-auto run facebook-page [OPTIONS]

# Input options (mutually exclusive)
--csv FILE                  # Import new pages from CSV
--update                   # Update existing pages from DB
--update-url URL           # Update specific page by URL
--update-id PAGE_ID        # Update specific page by page_id

# Filters
--stale-hours HOURS        # Only update pages not checked in X hours (default: 24)

# Standard options
--profile PROFILE          # Chrome profile (required)
--storage FORMAT           # json, mongodb, both (default: mongodb)
--headless                 # Run in headless mode
```

---

## Two Collections with page_id

### Collection 1: `facebook_pages`
```json
{
  "_id": "100063979652930",  // page_id
  "page_url": "https://www.facebook.com/cvrng",
  "username": "cvrng",
  "page_name": "Computer Vision BD | Rangpur",
  "description": "...",
  "email": "info@computervision.com.bd",
  "profile_image_url": "https://...",
  "first_seen": "2026-03-01T00:00:00Z",
  "last_checked": "2026-03-06T13:37:00Z"
}
```

### Collection 2: `facebook_page_metrics`
```json
{
  "_id": ObjectId("..."),
  "page_id": "100063979652930",
  "likes": "54,195",
  "followers": "54",
  "talking_about": "944",
  "recorded_at": "2026-03-06T13:37:00Z"
}
```

---

## Implementation

### Storage Layer - Query Methods

```python
class FacebookPageStorage:
    async def get_all_pages(self) -> List[dict]:
        """Get all tracked pages."""
        
    async def get_page_by_url(self, url: str) -> Optional[dict]:
        """Get page by URL."""
        
    async def get_page_by_id(self, page_id: str) -> Optional[dict]:
        """Get page by page_id."""
        
    async def get_stale_pages(self, hours: int = 24) -> List[dict]:
        """Get pages not checked in X hours."""
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        return await self.pages.find({
            "last_checked": {"$lt": cutoff}
        }).to_list()
```

### Main Script Logic

```python
async def main():
    if args.csv:
        # Mode 1: Import new pages from CSV
        urls = read_csv(args.csv)
        for url in urls:
            page_data = await extractor.extract(url)
            await storage.upsert_page(page_data)
            await storage.insert_metric(metric)
            
    elif args.update:
        # Mode 2: Update all existing pages
        pages = await storage.get_all_pages()
        for page in pages:
            await update_page(page["page_url"])
            
    elif args.update_url:
        # Update specific URL
        await update_page(args.update_url)
        
    elif args.update_id:
        # Get URL from page_id, then update
        page = await storage.get_page_by_id(args.update_id)
        await update_page(page["page_url"])
        
    elif args.stale_hours:
        # Update stale pages
        pages = await storage.get_stale_pages(args.stale_hours)
        for page in pages:
            await update_page(page["page_url"])
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `sm_auto/platforms/facebook/page/__init__.py` | Package init |
| `sm_auto/platforms/facebook/page/models.py` | FacebookPage, FacebookPageMetric |
| `sm_auto/platforms/facebook/page/extractor.py` | HTML extraction |
| `sm_auto/platforms/facebook/page/automation.py` | Page automation |

---

## Example Workflow

```bash
# 1. Add new pages from CSV
echo "https://facebook.com/page1" > new.csv
echo "https://facebook.com/page2" >> new.csv
sm-auto run facebook-page --csv new.csv --profile "Personal"

# 2. Next day - update all existing pages
sm-auto run facebook-page --update --profile "Personal"

# 3. Or just update stale ones
sm-auto run facebook-page --stale-hours 24 --profile "Personal"

# 4. Or update specific page
sm-auto run facebook-page --update-url "https://facebook.com/page1" --profile "Personal"
```
