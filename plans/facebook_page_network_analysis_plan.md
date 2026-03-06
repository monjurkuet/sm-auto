# Facebook Page Network Analysis - COMPLETED

## Task Overview

Navigate to Facebook pages (e.g., `https://www.facebook.com/cvrng`) and extract page data.

---

## Method Used: HTML Source Parsing

Instead of network interception or JavaScript DOM injection (which Facebook blocks in headless mode), we used **HTML source parsing** - fetching the page source and extracting data from meta tags.

---

## Implementation

### 1. Browser Navigation

```python
import nodriver as uc

browser = await uc.start(headless=True, sandbox=False)
tab = await browser.get("https://www.facebook.com/cvrng")
page_source = await tab.get_content()
```

### 2. Data Extraction

Data is extracted from HTML meta tags (OpenGraph and Twitter cards):

| Meta Tag | Extracted Data |
|----------|---------------|
| `og:title` | Page name |
| `og:description` | Description, likes, talking about |
| `og:url` | Page URL |
| `og:image` | Profile image URL |
| `twitter:title` | Twitter card title |
| `twitter:description` | Twitter card description |

---

## Results

Successfully extracted data from **https://www.facebook.com/cvrng**:

```json
{
  "url": "https://www.facebook.com/cvrng",
  "page_name": "Computer Vision BD | Rangpur ",
  "likes": "54,195",
  "talking_about": "942",
  "description": "Computer Vision BD, Rangpur. 54,195 likes · 942 talking about this. computervision.com.bd is the Largest Computer Sales & Service Center in Rangpur and all over the Bangladesh . Laptop, Computer,...",
  "profile_image": "https://scontent.fdac207-1.fna.fbcdn.net/v/t39.30808-1/506920984_1169417345200910_3650143032786321098_n.jpg...",
  "extracted_at": "2026-03-06T13:24:51.318994"
}
```

### Extracted Data Summary

| Field | Value |
|-------|-------|
| **Page URL** | https://www.facebook.com/cvrng |
| **Page Name** | Computer Vision BD \| Rangpur |
| **Likes** | 54,195 |
| **Talking About** | 942 |
| **Description** | Computer Vision BD, Rangpur. 54,195 likes · 942 talking about this. computervision.com.bd is the Largest Computer Sales & Service Center in Rangpur... |
| **Profile Image** | Available (CDN URL) |

---

## Files Created

1. **`test_facebook_extraction.py`** - Main extraction script
2. **`parse_facebook_html.py`** - HTML parser
3. **`facebook_page_source.html`** - Raw HTML (1.7MB)
4. **`facebook_page_report.json`** - Structured JSON report

---

## Challenges Encountered

1. **JavaScript Blocking**: Facebook blocks JavaScript execution in headless browsers
2. **Headless Detection**: Facebook detects and blocks headless Chrome instances
3. **Solution**: Use HTML source parsing from meta tags - works reliably

---

## Alternative Approaches (for logged-in pages)

For pages requiring authentication:

1. **Use Chrome Profile**: Launch browser with authenticated Chrome profile
2. **Visible Browser**: Run in non-headless mode
3. **Network Interception**: Use CDP to capture GraphQL responses (requires authenticated session)

---

## Usage

```bash
# Run extraction
uv run python test_facebook_extraction.py

# Parse HTML to JSON
uv run python parse_facebook_html.py
```
