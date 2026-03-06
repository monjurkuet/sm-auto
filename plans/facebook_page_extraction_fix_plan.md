# Facebook Page Extraction Fix Plan

## Problem Statement

The command `uv run sm-auto run facebook-page --update --profile-path "/root/.config/google-chrome/Default"` is not extracting all available data from Facebook pages.

## Analysis Summary

### Root Causes Identified

1. **Missing twitter:description parsing for metrics**
   - The extractor parses `og:description` and `meta name="description"` for likes/followers/talking_about
   - But NOT `twitter:description` which often contains the metrics in newer Facebook pages
   - Example from debug_LivewireBD.html:
     ```html
     <meta name="twitter:description" content="Livewire, Dhaka. 1,032,867 likes · 14,496 talking about this. ...">
     ```

2. **JavaScript DOM extraction selectors are outdated**
   - Current selectors in automation.py (lines 291-373) use old Facebook class names
   - Facebook uses dynamically generated classes like `x9f619`, `x1n2onr6`, etc.
   - These selectors need to be updated or use more generic approaches

3. **JSON script tags not fully utilized**
   - There are `<script type="application/json" data-content-len="...">` tags with page data
   - Current extractor only looks for specific patterns like `"pageID":"(\d+)"` and `"category":"([^"]+)"`
   - More comprehensive JSON parsing could extract: location, website, phone, cover image, etc.

4. **Missing field extraction**
   - Email, phone, location not extracted from HTML/DOM
   - Cover image URL not extracted
   - Website from contact info section not extracted

## Implementation Plan

### Step 1: Fix twitter:description parsing (extractor.py)

Add parsing of twitter:description for likes/followers/talking_about metrics:
```python
# After extracting twitter:description, parse for metrics
twitter_desc_match = re.search(r'<meta name="twitter:description" content="([^"]+)"', html)
if twitter_desc_match:
    twitter_desc = twitter_desc_match.group(1)
    # Extract metrics from twitter description
    # Pattern: "Page Name, Location. 1,032,867 likes · 14,496 talking about this."
    likes_match = re.search(r'([\d,.]+[KMB]?)\s*likes', twitter_desc, re.IGNORECASE)
    if likes_match and not result.likes:
        result.likes = likes_match.group(1)
        result.likes_numeric = self.parse_numeric(likes_match.group(1))
    # ... similar for followers and talking_about
```

### Step 2: Improve JSON script tag extraction (extractor.py)

Parse the large JSON data in script tags more comprehensively:
- Look for structured data in `__bbox.require- Extract: page` or similar
_id, page_name, likes, followers, category, location, website, phone, cover_image

### Step 3: Update JavaScript DOM extraction (automation.py)

Improve selectors to work with current Facebook:
- Use more generic selectors (aria-labels, data-testid)
- Look for metrics in specific DOM locations
- Add fallback selectors for different Facebook layouts

### Step 4: Add additional field extraction

Add extraction for:
- Cover image from og:image with "cover" or "cover" in URL
- Website from structured data or contact section
- Phone from contact info
- Location from various sources

## Files to Modify

1. `sm_auto/platforms/facebook/page/extractor.py` - Main extraction logic
2. `sm_auto/platforms/facebook/page/automation.py` - JavaScript DOM extraction

## Testing

1. Run extraction on debug HTML files to verify fixes
2. Run `uv run sm-auto run facebook-page --update --profile-path "/root/.config/google-chrome/Default"` 
3. Check extracted data completeness

## Success Criteria

- All available metadata from HTML should be extracted
- Likes, followers, talking_about should be extracted from twitter:description when og:description doesn't have them
- Additional fields (location, category, phone, website, cover image) should be populated when available
- DOM extraction should work as fallback when HTML extraction is incomplete
