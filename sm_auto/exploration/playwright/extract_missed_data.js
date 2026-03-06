const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', 'utf8'));

console.log("Hunting for missed, highly-specific, and deeply nested data points...");

const missedData = {
    external_links_in_posts: new Set(),
    hashtags: new Set(),
    exact_timestamps: [],
    video_view_counts: [],
    comment_snippets: [],
    story_types: new Set(),
    accessible_text_blocks: new Set()
};

const processedPostIds = new Set();

function deepSearchForMissed(obj, path = '', parentPostId = null) {
    if (!obj || typeof obj !== 'object') return;

    let currentPostId = parentPostId;

    // Track the current post ID context
    if (obj.__typename === 'Story' || obj.__isFeedUnit === 'Story') {
        currentPostId = obj.id;
        if (obj.story_type) missedData.story_types.add(obj.story_type);
        
        // Sometimes creation_time is buried, let's grab it whenever we see a story
        if (obj.creation_time) {
            missedData.exact_timestamps.push({ id: obj.id, timestamp: obj.creation_time });
        }
    }

    // 1. Hunt for External Links clicked via linkshim (Facebook's tracker)
    if (obj.url && typeof obj.url === 'string' && obj.url.includes('l.facebook.com/l.php')) {
        // Decode the actual URL
        try {
            const urlObj = new URL(obj.url);
            const actualUrl = urlObj.searchParams.get('u');
            if (actualUrl) missedData.external_links_in_posts.add(actualUrl);
        } catch(e) {}
    }

    // 2. Look for Message Ranges (Hashtags and Mentions embedded in text)
    if (obj.message && obj.message.ranges && Array.isArray(obj.message.ranges)) {
        obj.message.ranges.forEach(range => {
            if (range.entity && range.entity.__typename === 'Hashtag') {
                missedData.hashtags.add(range.entity.name);
            }
        });
    }

    // 3. Hunt for Video View Counts (Often separate from regular metrics)
    if (obj.__typename === 'Video' && obj.view_count !== undefined) {
         missedData.video_view_counts.push({
             video_id: obj.id,
             views: obj.view_count
         });
    }

    // 4. Hunt for Comment Snippets (Sometimes Facebook loads the top 1 or 2 comments directly in the feed)
    if (obj.__typename === 'Comment' || obj.comment_type) {
         if (obj.body && obj.body.text) {
             missedData.comment_snippets.push({
                 post_id: currentPostId,
                 author: obj.author ? obj.author.name : "Unknown",
                 text: obj.body.text,
                 timestamp: obj.created_time
             });
         }
    }

    // 5. Accessibility text blocks (Great for catching things the UI hides)
    if (obj.accessibility_caption && typeof obj.accessibility_caption === 'string') {
        missedData.accessible_text_blocks.add(obj.accessibility_caption);
    }

    Object.entries(obj).forEach(([key, child]) => {
        deepSearchForMissed(child, `${path}.${key}`, currentPostId);
    });
}

rawData.graphql.forEach(req => {
    req.responses.forEach(res => {
        if (!res.parse_error) deepSearchForMissed(res);
    });
});

console.log("\n=== Unveiling Missed Data ===");
console.log(`Extracted External Outbound Links (${missedData.external_links_in_posts.size}):`);
Array.from(missedData.external_links_in_posts).slice(0, 5).forEach(l => console.log(`  - ${l}`));

console.log(`\nExtracted Hashtags (${missedData.hashtags.size}):`);
console.log(Array.from(missedData.hashtags).join(', '));

console.log(`\nFound ${missedData.exact_timestamps.length} strict epoch timestamps for posts.`);

console.log(`\nFound ${missedData.video_view_counts.length} raw video view counts.`);
missedData.video_view_counts.slice(0, 3).forEach(v => console.log(`  - Video ${v.video_id}: ${v.views} views`));

console.log(`\nFound ${missedData.comment_snippets.length} comments embedded in the main feed.`);
missedData.comment_snippets.slice(0, 3).forEach(c => console.log(`  - ${c.author}: "${c.text}"`));

console.log(`\nFound ${missedData.accessible_text_blocks.size} hidden accessibility captions.`);
Array.from(missedData.accessible_text_blocks).slice(0, 3).forEach(c => console.log(`  - "${c}"`));

// Save to a file for review
fs.writeFileSync('/root/codebase/sm-auto/sm_auto/exploration/missed_data_report.json', JSON.stringify({
    links: Array.from(missedData.external_links_in_posts),
    hashtags: Array.from(missedData.hashtags),
    video_views: missedData.video_view_counts,
    comments: missedData.comment_snippets,
    accessibility_texts: Array.from(missedData.accessible_text_blocks)
}, null, 2));

console.log("\nSaved detailed missed data report to missed_data_report.json");
