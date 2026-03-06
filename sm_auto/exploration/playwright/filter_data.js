const fs = require('fs');

const INPUT_FILE = '/tmp/fb_comprehensive_data.json';
const OUTPUT_DIR = '/root/codebase/sm-auto/sm_auto/exploration';
const OUTPUT_JSON = `${OUTPUT_DIR}/filtered_facebook_data.json`;
const OUTPUT_REPORT = `${OUTPUT_DIR}/analysis_report.md`;

console.log(`Reading massive dataset from ${INPUT_FILE}...`);
const rawData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

const filteredData = {
    profile: {
        title: rawData.dom.title,
        url: rawData.dom.url,
        meta_description: null,
        followers_info: [],
        address: [],
        contact_links: []
    },
    posts: [],
    media: {
        high_res_photos: [],
        videos: []
    },
    seo_schema: []
};

// 1. Extract Meta Description
const metaDesc = rawData.dom.metaTags.find(m => m.name === 'description' || m.name === 'og:description');
if (metaDesc) {
    filteredData.profile.meta_description = metaDesc.content;
}

// 2. Extract SEO Schema Data
if (rawData.dom.structuredData && rawData.dom.structuredData.length > 0) {
    filteredData.seo_schema = rawData.dom.structuredData;
}

// 3. Extract Follower Info from Spans (DOM)
const spans = rawData.dom.textNodes.span || [];
const followerSpans = spans.filter(text => typeof text === 'string' && (text.includes('followers') || text.includes('likes')));
filteredData.profile.followers_info = [...new Set(followerSpans)];

// 4. Extract Contact and Address Info from Links (DOM)
const links = rawData.dom.links || [];
filteredData.profile.contact_links = links.filter(l => 
    l.href && (l.href.includes('mailto:') || l.href.includes('tel:') || l.href.includes('whatsapp') || l.href.includes('messenger'))
);
filteredData.profile.address = links.filter(l => l.href && l.href.includes('maps')).map(l => l.text).filter(Boolean);
// Also search for anything looking like an address in text nodes
if (filteredData.profile.address.length === 0) {
    const pTags = rawData.dom.textNodes.p || [];
    // Just grab anything that looks reasonably like an address or phone number (simple heuristic)
    // We already know from earlier exploration that address is in a link
}

// 5. Extract DOM Posts
if (rawData.dom.posts) {
    filteredData.posts = rawData.dom.posts.map(p => ({
        source: 'DOM',
        text: p.text
    }));
}

// 6. Deep Dive into GraphQL for High-Res Media and Detailed Posts
let totalGraphqlChunks = 0;
rawData.graphql.forEach(req => {
    req.responses.forEach(res => {
        totalGraphqlChunks++;
        
        // Let's traverse the JSON tree to find specific types of nodes
        const traverse = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            
            // Look for Photos
            if (obj.__typename === 'Photo' && obj.photo_image && obj.photo_image.uri) {
                filteredData.media.high_res_photos.push({
                    id: obj.id,
                    url: obj.photo_image.uri,
                    width: obj.viewer_image ? obj.viewer_image.width : null,
                    height: obj.viewer_image ? obj.viewer_image.height : null
                });
            }
            
            // Look for Videos
            if (obj.__typename === 'Video' && obj.id) {
                filteredData.media.videos.push({
                    id: obj.id,
                    duration_sec: obj.length_in_second,
                    width: obj.original_width || obj.width,
                    height: obj.original_height || obj.height,
                    url: obj.playable_url || null
                });
            }

            // Look for Post content in timeline units
            if (obj.__typename === 'Story' && obj.message && obj.message.text) {
                // To avoid duplicates with DOM, we flag it as GraphQL
                filteredData.posts.push({
                    source: 'GraphQL',
                    id: obj.id,
                    text: obj.message.text,
                    url: obj.url || null
                });
            }

            // Look for profile contact info in directory nodes
            if (obj.profile_tile_section_type === 'CONTACT_INFO' && obj.profile_tile_views) {
                 // Deeply nested, we can stringify and regex search or recursively find text
                 const contactTexts = JSON.stringify(obj).match(/"text":"([^"]+)"/g);
                 if (contactTexts) {
                     const cleanTexts = contactTexts.map(t => t.replace(/"text":"/, '').replace(/"$/, ''));
                     cleanTexts.forEach(t => {
                         if (!filteredData.profile.address.includes(t) && t !== 'Contact info') {
                             filteredData.profile.address.push(t);
                         }
                     });
                 }
            }

            // Recursively search children
            Object.values(obj).forEach(traverse);
        };
        
        if (!res.parse_error) {
            traverse(res);
        }
    });
});

// Deduplicate high res photos
const uniquePhotos = [];
const seenPhotoUrls = new Set();
filteredData.media.high_res_photos.forEach(p => {
    if (!seenPhotoUrls.has(p.url)) {
        seenPhotoUrls.add(p.url);
        uniquePhotos.push(p);
    }
});
filteredData.media.high_res_photos = uniquePhotos;

// Deduplicate videos
const uniqueVideos = [];
const seenVideoIds = new Set();
filteredData.media.videos.forEach(v => {
    if (!seenVideoIds.has(v.id)) {
        seenVideoIds.add(v.id);
        uniqueVideos.push(v);
    }
});
filteredData.media.videos = uniqueVideos;

// Deduplicate Profile Address/Contact
filteredData.profile.address = [...new Set(filteredData.profile.address)];

console.log(`Filtering complete!`);
console.log(`- Found ${filteredData.posts.length} posts`);
console.log(`- Found ${filteredData.media.high_res_photos.length} high-res photos`);
console.log(`- Found ${filteredData.media.videos.length} videos`);

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(filteredData, null, 2));
console.log(`Filtered data saved to ${OUTPUT_JSON}`);

// Generate Analysis Report
const report = `# Facebook Data Extraction Analysis

## 1. Profile Overview
- **Page Title:** ${filteredData.profile.title}
- **URL:** ${filteredData.profile.url}
- **Description:** ${filteredData.profile.meta_description || 'N/A'}
- **Followers Info:** ${filteredData.profile.followers_info.join(' | ') || 'N/A'}

## 2. Contact & Location Information
The following contact details and location strings were found in the DOM and GraphQL payloads:
- ${filteredData.profile.address.join('\n- ')}

## 3. Extracted Content
- **Total Posts Extracted:** ${filteredData.posts.length} (From DOM: ${filteredData.posts.filter(p => p.source === 'DOM').length}, From GraphQL: ${filteredData.posts.filter(p => p.source === 'GraphQL').length})
- **Total High-Resolution Photos:** ${filteredData.media.high_res_photos.length}
- **Total Videos:** ${filteredData.media.videos.length}

### Sample Posts:
${filteredData.posts.slice(0, 3).map((p, i) => `**Post ${i+1} (${p.source}):**\n> ${p.text.substring(0, 200)}...`).join('\n\n')}

## 4. SEO & Schema Data
- Discovered ${filteredData.seo_schema.length} JSON-LD schemas embedded in the page, which developers use for search engine indexing.

## Methodology Note
By combining DOM parsing and GraphQL interception, we successfully extracted high-resolution assets that are otherwise scaled down or hidden in the standard DOM, alongside accurate textual representations of the posts.
`;

fs.writeFileSync(OUTPUT_REPORT, report);
console.log(`Analysis report saved to ${OUTPUT_REPORT}`);
