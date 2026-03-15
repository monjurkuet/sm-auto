# DOM-based Page Info Extraction Research

## Summary

This document details findings from investigating Facebook page data extraction using DOM parsing instead of relying solely on GraphQL.

## Key Discovery: Multiple Data Sources

### 1. Main Profile Page (`/username`)
Basic page information is available on the main profile page:
- **pageId** - from embedded scripts (`userID` field)
- **userVanity** - from embedded scripts
- **name** - from page header
- **followers/following** - from profile stats (format: "394K followers • 115 following")
- **category** - from category badge
- **bio/description** - from intro section
- **location** - from details section (format varies: "Rangpur, Rangpur Division, Bangladesh + 8" or "41 Kamal Ataturk Avenue, Banani, Dhaka...")
- **website** - from links section

### 2. Contact Info Page (`/username/directory_contact_info`)
Detailed contact information requires navigating to this endpoint:
- **phone** - in "Phone" section (format: "09609-016810")
- **email** - in "Email" section (format: "info@ryans.com")
- **social media handles** - from anchor tags with platform URLs:
  - Instagram: `https://instagram.com/@handle`
  - TikTok: `https://tiktok.com/@handle`
  - Tumblr: `https://tumblr.com/handle`
  - Pinterest: `https://pinterest.com/handle`
  - YouTube: `https://youtube.com/@handle`
  - X (Twitter): `https://x.com/handle`

## Differences: Profiles vs Pages

### Profile (e.g., ryanscomputers)
```json
{
  "pageId": "100064688828733",
  "name": "Ryans Computers Ltd.",
  "followers": 394000,
  "following": 115,
  "category": "Computer Store",
  "bio": "Bangladesh's leading nationwide computer retail chain...",
  "location": "Rangpur, Rangpur Division, Bangladesh + 8",
  "website": "ryans.com",
  "phone": "09609-016810",
  "email": "info@ryans.com",
  "socialMedia": [
    {"platform": "instagram", "handle": "ryanscomputersltd"},
    {"platform": "tiktok", "handle": "ryanscomputerslimited"},
    {"platform": "tumblr", "handle": "ryanscomputers"},
    {"platform": "pinterest", "handle": "ryanscomputers"},
    {"platform": "youtube", "handle": "ryanscomputersltd"},
    {"platform": "x", "handle": "RyansComputers"}
  ]
}
```

### Page (e.g., ryanscomputersbanani)
```json
{
  "pageId": "61576839867805",
  "name": "Ryans Computers Ltd. (Banani)",
  "followers": 248,
  "location": "41 Kamal Ataturk Avenue, Banani, Dhaka, Bangladesh",
  "phone": "09638-009072"
}
```

## Extraction Patterns

### Phone Number Regex
Current regex doesn't match all phone formats. Better approach:
```typescript
// Match patterns like "09609-016810", "09638-009072"
const phoneMatch = allText.match(/Phone[\s\n]+([\d\-\+]+)/);
```

### Social Media Extraction
Social media handles are in `<a>` tags, not plain text:
```typescript
// Find all anchor tags with social media platforms
const anchors = document.querySelectorAll('a');
for (const anchor of anchors) {
  const href = anchor.href;
  if (href.includes('instagram.com')) { ... }
}
```

### Follower Count Parsing
```typescript
// Parse "394K followers • 115 following"
const match = text.match(/([\d.KM]+)\s*followers?\s*•?\s*([\d.KM]*)\s*following?/i);
// Returns: ["394K", "115"]
```

## Implementation Notes

1. **Two-page navigation required**: Main page + directory_contact_info page
2. **No LLM needed**: Simple DOM parsing works reliably
3. **Anchor tag parsing**: Social media requires parsing `<a>` tag hrefs
4. **Platform detection**: Check href for platform-specific domains
