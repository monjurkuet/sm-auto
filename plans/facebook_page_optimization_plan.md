# Facebook Page Module Optimization Plan

## Executive Summary

This plan outlines comprehensive improvements for the Facebook page module by learning from the reference playwright implementation. The key optimization areas are: **hybrid data extraction**, **network interception**, **multi-page navigation**, and **code quality improvements**.

---

## Current Implementation Analysis

### Files in Scope
- `sm_auto/platforms/facebook/page/automation.py` - Main automation logic
- `sm_auto/platforms/facebook/page/extractor.py` - HTML extraction
- `sm_auto/platforms/facebook/page/models.py` - Data models
- `sm_auto/platforms/facebook/page/storage.py` - MongoDB storage

### Key Issues Identified

| Issue | Current State | Reference Best Practice |
|-------|---------------|----------------------|
| Data Source | HTML only + basic JS DOM | Hybrid: GraphQL + DOM + ARIA |
| Network Capture | Not utilized | Full GraphQL interception |
| Multi-Page | Single page only | About/Transparency + About/Details |
| Debug Output | Unconditional | Configurable flag |
| Delays | Hardcoded `asyncio.sleep` | Using delay utilities |
| ARIA Metrics | Not implemented | aria-label based extraction |
| Scroll Strategy | Fixed 3 scrolls | Configurable maxScrolls parameter |

---

## Detailed Improvement Plan

### Phase 1: Architecture Improvements

#### 1.1 Integrate Network Interception Service
**Priority: HIGH** ✅ DONE

The reference implementation demonstrates that Facebook data is primarily delivered via GraphQL. Added CaptureService integration following the marketplace pattern.

**Actions Completed:**
- ✅ Enable GraphQL interception in `FacebookPagePlatform.initialize()`
- ✅ Register a parser callback for `graphql` pattern
- ✅ Extract page data from intercepted GraphQL responses
- ✅ Merge GraphQL data with HTML extraction (GraphQL takes precedence)

#### 1.2 Implement Multi-Page Navigation
**Priority: HIGH** ✅ DONE

Reference navigates to:
1. Main page → Timeline/Posts
2. `/about_profile_transparency` → Page creation date, history
3. `/about_contact_and_basic_info` → Contact info, category, location

**Actions Completed:**
- ✅ Add `navigate_to_transparency()` method
- ✅ Add `navigate_to_details()` method  
- ✅ Create `extract_deep_page_data()` orchestrator
- ✅ Implement data merging from multiple pages

---

### Phase 2: Extraction Optimizations

#### 2.1 Implement ARIA-Based Metric Extraction
**Priority: HIGH** ✅ DONE

Reference uses aria-labels as the "absolute source of truth" for metrics.

**Actions Completed:**
- ✅ Add ARIA extraction to `extractor.py`
- ✅ Extract from `aria-label` attributes like `"Like: 41 people"`
- ✅ Use `role="button"` and `role="link"` selectors
- ✅ Prioritize ARIA data over regex patterns

#### 2.2 Add GraphQL Response Parser
**Priority: HIGH** ✅ DONE

Parse the intercepted GraphQL responses to extract:
- Page metadata (name, category, verified status)
- Follower/like counts (when available directly)
- Profile/cover image URLs
- Contact information

**Actions Completed:**
- ✅ Create `_parse_graphql_response()` method in automation.py
- ✅ Handle ProfileCometTimelineFeedRefetchQuery responses
- ✅ Extract from Story objects (posts)
- ✅ Extract from comet_sections.feedback object

---

### Phase 3: Code Quality Improvements

#### 3.1 Use Delay Utilities Consistently
**Priority: MEDIUM** ✅ DONE

Replace hardcoded `asyncio.sleep()` with existing delay utilities.

**Actions Completed:**
- ✅ Audit all `asyncio.sleep()` calls in automation.py
- ✅ Replace with appropriate delay utility (page_delay, action_delay, micro_delay)
- ✅ Add delay configuration to FacebookPageConfig

#### 3.2 Add Debug Flag Control
**Priority: MEDIUM** ✅ DONE

Currently debug HTML files are saved unconditionally. Made configurable.

**Actions Completed:**
- ✅ Add `save_debug_html: bool = False` parameter to `FacebookPageConfig`
- ✅ Add environment variable support
- ✅ Wrap debug file writes in conditional

#### 3.3 Improve Scroll Strategy
**Priority: MEDIUM** ✅ DONE

Reference uses configurable `maxScrolls` parameter (default 15). Added configurable scroll count.

**Actions Completed:**
- ✅ Add `max_scrolls: int = 15` parameter to extraction methods
- ✅ Add scrolling pauses using delay utilities
- ✅ Implement scroll detection (stops at max_scrolls)

---

### Phase 4: New Features

#### 4.1 Add Transparency Data
**Priority: LOW** ✅ DONE

Extract page creation date from transparency page.

**Actions Completed:**
- ✅ Parse creation date from `/about_profile_transparency`
- ✅ Add `page_created` field to models
- ✅ Store in page document

#### 4.2 Add Deep Page Extraction
**Priority: LOW** ✅ DONE

Combined multi-page extraction method.

**Actions Completed:**
- ✅ Add `extract_deep_page_data()` method
- ✅ Orchestrates main page + transparency + details extraction
- ✅ Merges data from all sources

---

## Implementation Summary

### Files Modified

1. **`sm_auto/platforms/facebook/page/automation.py`**
   - Added CaptureService integration (start_capture, stop_capture, _process_capture_event)
   - Added navigate_to_transparency() and navigate_to_details()
   - Added extract_deep_page_data()
   - Added FacebookPageConfig with save_debug_html and max_scrolls
   - Replaced asyncio.sleep with delay utilities

2. **`sm_auto/platforms/facebook/page/extractor.py`**
   - Added extract_metrics_from_aria() method
   - Added extract_from_graphql() method
   - Added merge_extraction_results() method

3. **`sm_auto/platforms/facebook/page/models.py`**
   - Added page_created field to FacebookPage
   - Added page_created field to PageExtractionResult

### Key Changes

| Feature | Before | After |
|---------|--------|-------|
| Data Source | HTML only | Hybrid: GraphQL + ARIA + HTML |
| Network Capture | Not used | CaptureService with callback |
| Multi-Page | Single page | Transparency + Details pages |
| Debug Output | Always | Configurable flag |
| Delays | Hardcoded sleep | Delay utilities |
| Scrolls | Fixed 3 | Configurable max_scrolls |

---

## Usage

```python
# Create with network capture
automation = await create_page_automation(
    session_manager,
    storage=storage,
    capture_service=capture_service,  # Optional
    save_debug_html=False,
    max_scrolls=15,
)

# Extract with network capture (automatically started)
result = await automation.extract_page("https://facebook.com/page")

# Or deep extraction with multiple pages
result = await automation.extract_deep_page_data("https://facebook.com/page")
```

---

## Remaining Optional Tasks

| Item | Priority | Notes |
|------|----------|-------|
| Move inline JS to extractor.py | Low | Current JS in automation.py works; new ARIA/GraphQL methods added as alternative |
| Add post extraction | Low | Future enhancement to extract timeline posts |
| Move selectors to YAML | Low | Could move selectors to facebook_selectors.yaml like marketplace does |

---

## Success Metrics

After implementation, the module should:

1. ✅ Extract data from GraphQL responses (primary source)
2. ✅ Fall back to ARIA/DOM when GraphQL unavailable
3. ✅ Navigate to About/Transparency and About/Details pages
4. ✅ Use configurable debug flag (default off)
5. ✅ Use delay utilities consistently
6. ✅ Have configurable scroll count
7. ✅ Achieve higher data completeness than current implementation
