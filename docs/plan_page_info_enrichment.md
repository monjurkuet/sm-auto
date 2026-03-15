# Plan: Enrich Page Info with DOM-based Extraction

## Current State Analysis

### What We're Currently Collecting (`PageInfoResult` in `contracts.ts`)

| Field | Source | Status |
|-------|--------|--------|
| `pageId` | Route definitions | ✅ Working |
| `url` | Page URL | ✅ Working |
| `name` | DOM headings/title | ✅ Working |
| `category` | DOM spans | ⚠️ Partial |
| `followers` | DOM spans | ⚠️ Need K parsing |
| `contact.phones` | DOM spans + links | ⚠️ Need improvement |
| `contact.emails` | DOM spans + links | ⚠️ Need improvement |
| `contact.websites` | DOM links | ⚠️ Need improvement |
| `contact.addresses` | DOM spans | ⚠️ Need improvement |
| `transparency.creationDate` | Page | ✅ Working |
| `transparency.history` | Page | ✅ Working |

### What's Missing (NEW from research)

| Field | Source | Priority |
|-------|--------|----------|
| `following` | DOM spans | High |
| `socialMedia` | Anchor tags | High |
| `bio` | DOM spans | Medium |
| `location` | DOM spans | Medium |

---

## Implementation Plan

### Phase 1: Update Type Definitions

**File:** `src/types/contracts.ts`

Add new fields to `PageInfoResult` and `PageContactInfo`:

```typescript
export interface SocialMediaLink {
  platform: 'instagram' | 'tiktok' | 'tumblr' | 'pinterest' | 'youtube' | 'x';
  handle: string;
  url: string;
}

export interface PageContactInfo {
  phones: string[];
  emails: string[];
  websites: string[];
  addresses: string[];
  socialMedia: SocialMediaLink[];  // NEW
}

export interface PageInfoResult {
  pageId: string | null;
  url: string;
  name: string | null;
  category: string | null;
  followers: number | null;
  following: number | null;  // NEW
  bio: string | null;  // NEW
  location: string | null;  // NEW
  contact: PageContactInfo;
  // ... existing fields
}
```

### Phase 2: Update DOM Parser

**File:** `src/parsers/dom/page_dom_parser.ts`

#### 2.1 Add Social Media Extraction

```typescript
export function parseSocialMedia(snapshot: PageDomSnapshot): SocialMediaLink[] {
  const socialMedia: SocialMediaLink[] = [];
  const seen = new Set<string>();

  for (const link of snapshot.links) {
    if (!link.href) continue;
    
    let platform: SocialMediaLink['platform'] | null = null;
    
    if (link.href.includes('instagram.com')) platform = 'instagram';
    else if (link.href.includes('tiktok.com')) platform = 'tiktok';
    else if (link.href.includes('tumblr.com')) platform = 'tumblr';
    else if (link.href.includes('pinterest.com')) platform = 'pinterest';
    else if (link.href.includes('youtube.com')) platform = 'youtube';
    else if (link.href.includes('x.com') || link.href.includes('twitter.com')) platform = 'x';
    
    if (platform && !seen.has(platform)) {
      // Extract handle from URL
      const handle = extractHandleFromUrl(link.href);
      socialMedia.push({ platform, handle, url: link.href });
      seen.add(platform);
    }
  }
  
  return socialMedia;
}
```

#### 2.2 Improve Phone Extraction

```typescript
// Current: /^\+?[\d\s-]{7,}$/
// Improved: Match patterns like "Phone\n09609-016810"
const phoneMatch = fullText.match(/Phone[\s\n]+([\d\-\+]+)/);
```

#### 2.3 Add Following Count Extraction

```typescript
export function parseFollowingCount(snapshot: PageDomSnapshot): number | null {
  for (const span of snapshot.spans) {
    const match = span.match(/([\d.KM]+)\s+following/i);
    if (match) {
      return parseNumber(match[1]);
    }
  }
  return null;
}
```

#### 2.4 Add Bio Extraction

```typescript
export function parseBio(snapshot: PageDomSnapshot): string | null {
  for (const span of snapshot.spans) {
    if (span.includes("Bangladesh's leading nationwide computer retail chain")) {
      return span;
    }
  }
  return null;
}
```

### Phase 3: Update Extractor

**File:** `src/extractors/page_info_extractor.ts`

1. Navigate to `/directory_contact_info` page
2. Extract social media from that page
3. Combine with main page data

### Phase 4: Update Normalizer

**File:** `src/normalizers/page_normalizer.ts`

Add new fields to normalization:

```typescript
export function normalizePageInfo(input: PageInfoInput): PageInfoResult {
  return {
    // ... existing
    following: input.following ?? null,
    bio: input.bio ?? null,
    location: input.location ?? null,
    contact: {
      ...input.contact,
      socialMedia: input.contact.socialMedia ?? []
    }
  };
}
```

---

## Priority Order

1. **High Priority**: Social Media extraction (new data point)
2. **High Priority**: Following count (missing metric)
3. **Medium Priority**: Better phone/email extraction
4. **Medium Priority**: Bio and location extraction

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/types/contracts.ts` | Add new type definitions |
| `src/parsers/dom/page_dom_parser.ts` | Add extraction functions |
| `src/extractors/page_info_extractor.ts` | Update to navigate and collect |
| `src/normalizers/page_normalizer.ts` | Update normalization |

---

## Test Coverage

After implementation, verify with:

1. **Profile test**: `ryanscomputers`
2. **Page test**: `ryanscomputersbanani`  
3. **Edge cases**: Pages with incomplete info
