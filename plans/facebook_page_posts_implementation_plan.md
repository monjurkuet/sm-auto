# Facebook Page Posts Collection - COMPLETE Data Discovery

## All Available Data Points from GraphQL

Based on deep exploration of the captured GraphQL responses, here is EVERY data point available for collection:

---

## 1. Post Core Identifiers

| Field | Path | Type | Example |
|-------|------|------|---------|
| `post_id` | `node.post_id` | string | "1334845018681780" |
| `node_id` | `node.id` (base64) | string | "UzpfSTEwMDA2..." |
| `feedback_id` | `node.feedback.id` | string | "ZmVlZGJhY2s6MTMz..." |
| `page_id` | `node.feedback.owning_profile.id` | string | "100064688828733" |
| `page_name` | `node.feedback.owning_profile.name` | string | "Ryans Computers Ltd." |

---

## 2. Post Content

| Field | Path | Type | Example |
|-------|------|------|---------|
| `text` | `node.comet_sections.content.story.message.message.text` | string | Full post text |
| `text_raw` | `node.comet_sections.content.story.message_container.story.message.text` | string | Alternative text path |
| `is_text_only` | `node.comet_sections.content.story.message.is_text_only_story` | boolean | true/false |

### Text Metadata (Embedded in message.ranges)
| Field | Path | Description |
|-------|------|-------------|
| `mentions` | `message.ranges[].entity.__typename: "User"` | @mentions with name, id, url |
| `hashtags` | `message.ranges[].entity.__typename: "Hashtag"` | Hashtags with url |
| `links` | `message.ranges[].entity.__typename: "ExternalUrl"` | External links with original URL |
| `urls` | Extract from text | All URLs in post |

---

## 3. Timestamps

| Field | Path | Type | Example |
|-------|------|------|---------|
| `created_at_timestamp` | `node.comet_sections.content.story.creation_time` | int | 1772794865 |
| `created_at` | Convert from timestamp | datetime | 2024-11-04T00:00:00Z |

---

## 4. Engagement Metrics (REACTIONS - Full Breakdown!)

| Field | Path | Type | Example |
|-------|------|------|---------|
| `reaction_count` | `comet_ufi_summary_and_actions_renderer.feedback.reaction_count.count` | int | 9 |
| `reactions` | `top_reactions.edges` | dict | {"Like": 8, "Love": 1} |

### Reaction Breakdown Structure:
```json
"top_reactions": {
  "edges": [
    {
      "node": {
        "id": "1635855486666999",      // Reaction type ID
        "localized_name": "Like"       // Reaction name
      },
      "reaction_count": 8
    },
    {
      "node": {
        "id": "1678524932434102",
        "localized_name": "Love"
      },
      "reaction_count": 1
    }
  ]
}
```

**Reaction Types Found:**
- Like
- Love  
- HaHa
- Wow
- Sad
- Angry
- Care
- (more based on Facebook updates)

---

## 5. Engagement Metrics (SHARES)

| Field | Path | Type | Example |
|-------|------|------|---------|
| `share_count` | `comet_ufi_summary_and_actions_renderer.feedback.share_count.count` | int | 2 |
| `i18n_share_count` | `comet_ufi_summary_and_actions_renderer.feedback.i18n_share_count` | string | "2" |

---

## 6. Engagement Metrics (COMMENTS)

| Field | Path | Type | Example |
|-------|------|------|---------|
| `comment_count` | `comments_count_summary_renderer.feedback.comment_rendering_instance.comments.total_count` | int | 0 |

---

## 7. Media/Attachments

### For Videos:
| Field | Path | Type | Example |
|-------|------|------|---------|
| `media_type` | `attachments[].media.__typename` | string | "Video" |
| `media_id` | `attachments[].media.id` | string | "1812722560116242" |
| `video_url` | `attachments[].media.url` | string | "https://facebook.com/reel/..." |
| `video_permalink` | `attachments[].media.permalink_url` | string | Permalink |
| `thumbnail_url` | `attachments[].media.preferred_thumbnail.image.uri` | string | Thumbnail URL |
| `video_duration_sec` | `attachments[].media.length_in_second` | int | 48 |
| `video_height` | `attachments[].media.height` | int | 1080 |
| `video_width` | `attachments[].media.width` | int | 1920 |
| `is_live` | `attachments[].media.is_live_streaming` | boolean | false |
| `is_looping` | `attachments[].media.is_looping` | boolean | false |

### Video Quality URLs:
| Field | Path | Description |
|-------|------|-------------|
| `progressive_urls` | `videoDeliveryResponseResult.progressive_urls[]` | Direct video URLs with quality |
| `dash_manifest_urls` | `videoDeliveryResponseResult.dash_manifest_urls[]` | DASH streaming manifest |

### For Images:
| Field | Path | Type | Example |
|-------|------|------|---------|
| `media_type` | `attachments[].media.__typename` | string | "Image" |
| `media_id` | `attachments[].media.id` | string | "123456789" |
| `image_url` | `attachments[].media.preferred_thumbnail.image.uri` | string | Full image URL |

---

## 8. Post Type Classification

| Field | Path | Description |
|-------|------|-------------|
| `post_type` | Derived from `__typename` + attachments | "video", "image", "text", "link" |
| `is_reel` | Check URL contains "/reel/" | boolean |
| `is_live` | Check `is_live_streaming` | boolean |
| `is_story_civic` | `node.is_story_civic` | Civic/story flag |

---

## 9. Additional Metadata

| Field | Path | Type | Example |
|-------|------|------|---------|
| `cache_id` | `node.cache_id` | string | "-5552488915991291059" |
| `can_viewer_comment` | `feedback.can_viewer_comment` | boolean | true |
| `viewer_actor` | `feedback.viewer_actor.name` | string | Viewer's name (if logged in) |

---

## 10. Tracking Data (JSON in tracking field)

The `tracking` field is a JSON string containing:
```json
{
  "qid": "-7300373132656983077",
  "mf_story_key": "1334845018681780",
  "top_level_post_id": "1334845018681780",
  "content_owner_id_new": "100064688828733",
  "page_id": "169051239824791",
  "story_location": 4,
  "story_attachment_style": "video_inline",
  "video_id": "1812722560116242",
  "sty": 22,
  "ent_attachement_type": "VideoAttachment",
  "app_id": "2392950137",
  "publish_time": 1772794865,
  "story_name": "EntStatusCreationStory"
}
```

---

## Complete Data Model

Here's the full model with ALL fields:

```python
class FacebookPost(BaseModel):
    # === Core Identifiers ===
    post_id: str                                    # Unique post ID
    node_id: str                                   # Base64 encoded node ID
    feedback_id: str                               # Feedback ID
    page_id: str                                   # Parent page ID
    page_name: str                                 # Page display name
    
    # === URLs ===
    post_url: Optional[str]                        # Permalink to post
    page_url: Optional[str]                        # Page URL
    
    # === Content ===
    text: Optional[str]                            # Full post text
    text_preview: Optional[str]                   # First N characters
    is_text_only: bool                            # True if no attachments
    
    # === Content Metadata ===
    mentions: Optional[List[Dict]]                  # @mentions [{name, id, url}]
    hashtags: Optional[List[str]]                   # List of hashtags
    external_links: Optional[List[Dict]]           # External links [{url, display_url}]
    
    # === Timestamps ===
    created_at_timestamp: int                      # Unix timestamp
    created_at: datetime                          # Converted datetime
    
    # === Engagement: Reactions ===
    reaction_count: int                            # Total reactions
    reactions: Optional[Dict[str, int]]            # {"Like": 8, "Love": 1}
    
    # Reaction breakdown (detailed)
    reactions_like: Optional[int] = 0
    reactions_love: Optional[int] = 0
    reactions_haha: Optional[int] = 0
    reactions_wow: Optional[int] = 0
    reactions_sad: Optional[int] = 0
    reactions_angry: Optional[int] = 0
    reactions_care: Optional[int] = 0
    
    # === Engagement: Comments ===
    comment_count: int                             # Total comments
    
    # === Engagement: Shares ===
    share_count: int                              # Total shares
    
    # === Media ===
    media_type: Optional[str]                      # "video", "image", "link"
    media_ids: Optional[List[str]]                 # Media IDs
    media_urls: Optional[List[str]]                 # Media URLs
    thumbnail_urls: Optional[List[str]]             # Thumbnail URLs
    
    # Video specific
    video_duration_sec: Optional[int]              # Video length
    video_height: Optional[int]                    # Video height
    video_width: Optional[int]                     # Video width
    is_live: bool                                  # Is live stream
    is_reel: bool                                  # Is reel/short
    
    # === Post Classification ===
    post_type: Optional[str]                        # "video_inline", "photo", "link", "text"
    can_comment: bool                              # Can viewer comment
    
    # === Metadata ===
    is_sponsored: Optional[bool]                   # Is sponsored content
    recorded_at: datetime                          # When scraped
```

---

## Data Availability Summary

| Data Point | Available | Notes |
|------------|-----------|-------|
| Post ID | ✅ Yes | Direct field |
| Page ID | ✅ Yes | From feedback |
| Post URL | ✅ Yes | From story.url |
| Post Text | ✅ Yes | Full text with entities |
| @Mentions | ✅ Yes | Extracted from ranges |
| Hashtags | ✅ Yes | Extracted from ranges |
| External Links | ✅ Yes | With original URLs |
| Creation Time | ✅ Yes | Unix timestamp |
| Reaction Count | ✅ Yes | Total |
| Reaction Breakdown | ✅ Yes | Like, Love, HaHa, etc. |
| Comment Count | ✅ Yes | Total count |
| Share Count | ✅ Yes | Total shares |
| Media URLs | ✅ Yes | Images and videos |
| Video Details | ✅ Yes | Duration, dimensions |
| Thumbnail URLs | ✅ Yes | Preview images |

---

## What Requires Separate Queries

| Data Point | Requires | Notes |
|------------|----------|-------|
| Individual commenters | Separate GraphQL | FeedbackReactorsQuery |
| Reaction details | Separate GraphQL | For full reaction list |
| Post views | Separate GraphQL | View count query |

---

## Recommendation

This is everything available in the timeline feed. You can tell me which fields you want to include or exclude, and I'll implement accordingly.
