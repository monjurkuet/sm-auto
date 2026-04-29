# Output Schemas

Outputs currently scaffolded:

- `page_info.json`
- `page_posts.json`
- `marketplace_search.json`
- `marketplace_listing.json`
- `marketplace_seller.json`
- `marketplace_listings_bulk.json`
- `marketplace_sellers_bulk.json`
- `group_info.json`
- `group_posts.json`
- `group_post_detail.json`

The schemas are defined in `src/types/contracts.ts` and versioned in `src/storage/schema_versions.ts`.

## GroupInfoResult

Output of `scrape_group_info.ts`. Written to `group_info.json`.

| Field | Type | Description |
|-------|------|-------------|
| `groupId` | `string \| null` | Facebook group ID |
| `url` | `string` | Group URL used for the scrape |
| `name` | `string \| null` | Group display name |
| `vanitySlug` | `string \| null` | Vanity URL slug |
| `privacyType` | `string \| null` | Privacy level (e.g. "Public", "Private") |
| `groupType` | `string \| null` | Group type classification |
| `memberCount` | `number \| null` | Total member count |
| `description` | `string \| null` | Group description / about text |
| `coverPhotoUrl` | `string \| null` | Cover photo image URL |
| `admins` | `GroupAdmin[]` | Array of admin/moderator objects |
| `admins[].id` | `string \| null` | Admin user ID |
| `admins[].name` | `string \| null` | Admin display name |
| `admins[].adminType` | `string \| null` | Role: "admin" or "moderator" |
| `rules` | `string[]` | Group rules |
| `tags` | `string[]` | Group topic tags |
| `scrapedAt` | `string` | ISO timestamp of extraction |
| `provenance` | `Record<string, DataProvenance>` | (optional) Per-field data source tracking |

## GroupPostsResult

Output of `scrape_group_posts.ts`. Written to `group_posts.json`.

| Field | Type | Description |
|-------|------|-------------|
| `groupId` | `string \| null` | Facebook group ID |
| `url` | `string` | Group URL used for the scrape |
| `posts` | `GroupPost[]` | Array of posts from the group feed |
| `posts[].id` | `string \| null` | Post ID |
| `posts[].postId` | `string \| null` | Post ID (alternate field) |
| `posts[].permalink` | `string \| null` | Permalink to the post |
| `posts[].createdAt` | `string \| null` | Post creation timestamp |
| `posts[].text` | `string \| null` | Post text content |
| `posts[].author.id` | `string \| null` | Author user ID |
| `posts[].author.name` | `string \| null` | Author display name |
| `posts[].media[].type` | `string \| null` | Media type (photo, video, etc.) |
| `posts[].media[].id` | `string \| null` | Media ID |
| `posts[].media[].url` | `string \| null` | Media URL |
| `posts[].media[].width` | `number` | (optional) Media width |
| `posts[].media[].height` | `number` | (optional) Media height |
| `posts[].metrics.reactions` | `number \| null` | Reaction count |
| `posts[].metrics.comments` | `number \| null` | Comment count |
| `posts[].metrics.shares` | `number \| null` | Share count |
| `posts[].isApproved` | `boolean \| null` | Whether post is admin-approved |
| `scrapedAt` | `string` | ISO timestamp of extraction |

## GroupPostDetailResult

Output of `scrape_group_post_detail.ts`. Written to `group_post_detail.json`.

| Field | Type | Description |
|-------|------|-------------|
| `postId` | `string \| null` | Post ID |
| `url` | `string` | Post URL used for the scrape |
| `groupId` | `string \| null` | Group ID the post belongs to |
| `post` | `GroupPost` | Full post object (same shape as `GroupPostsResult.posts[]`) |
| `comments` | `GroupPostComment[]` | Array of comments on the post |
| `comments[].id` | `string \| null` | Comment ID |
| `comments[].parentId` | `string \| null` | Parent comment ID (for threaded replies) |
| `comments[].author.id` | `string \| null` | Commenter user ID |
| `comments[].author.name` | `string \| null` | Commenter display name |
| `comments[].text` | `string \| null` | Comment text content |
| `comments[].createdAt` | `string \| null` | Comment creation timestamp |
| `comments[].metrics.reactions` | `number \| null` | Reaction count on comment |
| `comments[].metrics.replies` | `number \| null` | Reply count on comment |
| `totalCommentCount` | `number \| null` | Total comment count reported by Facebook |
| `scrapedAt` | `string` | ISO timestamp of extraction |
