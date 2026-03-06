const fs = require('fs');

const RAW_DATA_PATH = '/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json';
const OUTPUT_CATALOG = '/root/codebase/sm-auto/sm_auto/exploration/final_page_catalog.json';

// Also load the deep stealth data we extracted earlier
let stealthData = { intro: [], transparency: [], creation_date: null };
try {
    stealthData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/deep_page_data_v2.json', 'utf8'));
} catch (e) {
    console.log("Could not load stealth data. Continuing without it.");
}

console.log("Loading massive raw dataset to build FULL Final Page Catalog...");
const rawData = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));

const catalog = {
    metadata: {
        page_id: null,
        name: rawData.dom.title,
        url: rawData.dom.url,
        category: null,
        followers: null,
        creation_date: stealthData.creation_date,
        transparency_history: stealthData.transparency,
        contact_info: {
            address: [],
            phones: [],
            emails: [],
            websites: []
        },
        scraped_at: new Date().toISOString()
    },
    posts: []
};

// 1. Fill in Metadata from DOM
const spans = rawData.dom.textNodes.span || [];
const followerSpan = spans.find(text => typeof text === 'string' && (text.includes('followers') || text.includes('likes')));
if (followerSpan) {
    catalog.metadata.followers = followerSpan;
}

const header1 = rawData.dom.textNodes.h1 || [];
if (header1.length > 0) {
    catalog.metadata.name = header1[0];
}

// Try to grab Category from h2s or stealth data
const header2 = rawData.dom.textNodes.h2 || [];
// Usually categories are standalone like "Computer Store"
const possibleCategory = stealthData.intro.find(t => t.includes('Store') || t.includes('Company'));
if (possibleCategory) catalog.metadata.category = possibleCategory;

// 2. Extract specific metrics from ARIA labels (DOM)
const postMetricsMap = new Map();
let currentPostIndexForMetrics = 0;

rawData.dom.ariaLabeledElements.forEach(el => {
    if (!el || !el.label) return;
    const label = el.label;
    
    const likeMatch = label.match(/Like: ([\d\.KMB]+) people/);
    const reactionMatch = label.match(/^([\d\.KMB]+) reactions;/);
    const commentMatch = label.match(/Comment by (.*?) a (.*?) ago/);
    
    if (likeMatch || reactionMatch) {
        const countStr = (likeMatch ? likeMatch[1] : reactionMatch[1]);
        if (!postMetricsMap.has(currentPostIndexForMetrics)) {
             postMetricsMap.set(currentPostIndexForMetrics, { likes: countStr, top_commenters: [] });
        } else {
             postMetricsMap.get(currentPostIndexForMetrics).likes = countStr;
        }
        currentPostIndexForMetrics++; 
    }
    
    // Attempt to map comment ARIA labels to the *previous* post since they usually follow the like button
    if (commentMatch && currentPostIndexForMetrics > 0) {
        const targetPost = currentPostIndexForMetrics - 1;
        if (!postMetricsMap.has(targetPost)) postMetricsMap.set(targetPost, { likes: "Unknown", top_commenters: [] });
        postMetricsMap.get(targetPost).top_commenters.push(commentMatch[1]);
    }
});

// 3. Process GraphQL to build the Posts array
let postIndex = 0;
const processedPostIds = new Set();

function traverseGraphqlForPosts(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.__typename === 'Story' || obj.__isFeedUnit === 'Story') {
        if (!obj.id || processedPostIds.has(obj.id)) return;
        
        processedPostIds.add(obj.id);
        
        const postEntry = {
            internal_id: obj.id,
            post_id: obj.post_id || null, // The clean integer ID
            url: obj.url || null,
            creation_timestamp: obj.creation_time || null,
            text: obj.message ? obj.message.text : null,
            hashtags: [],
            mentioned_groups: [],
            external_links: [],
            media: {
                photos: [],
                videos: []
            },
            metrics: postMetricsMap.get(postIndex) || { likes: "Unknown", top_commenters: [] },
            author: null,
            telemetry: {
                is_ad: !!obj.sponsored_data,
                tracking_id: obj.encrypted_tracking ? obj.encrypted_tracking.substring(0, 20) + "..." : null
            }
        };

        // Extract Author
        if (obj.actors && obj.actors.length > 0) {
            postEntry.author = { id: obj.actors[0].id, name: obj.actors[0].name };
            catalog.metadata.page_id = obj.actors[0].id;
        } else if (obj.feedback && obj.feedback.owning_profile) {
            postEntry.author = { id: obj.feedback.owning_profile.id, name: obj.feedback.owning_profile.name };
            catalog.metadata.page_id = obj.feedback.owning_profile.id;
        }

        // Sub-traverse for deeply nested Post features (Media, Links, Timestamps)
        function findDeepPostData(subObj) {
            if (!subObj || typeof subObj !== 'object') return;
            
            // Media extraction
            if (subObj.__typename === 'Photo' && subObj.photo_image) {
                postEntry.media.photos.push({
                    id: subObj.id,
                    url: subObj.photo_image.uri,
                    width: subObj.viewer_image?.width,
                    height: subObj.viewer_image?.height
                });
            } else if (subObj.__typename === 'Video' && subObj.id) {
                const isReel = (subObj.original_height > subObj.original_width) || !!subObj.is_reel;
                postEntry.media.videos.push({
                    id: subObj.id,
                    url: subObj.playable_url || null,
                    dash_manifest: !!subObj.dash_manifest,
                    duration_sec: subObj.length_in_second,
                    is_reel: isReel
                });
            }
            
            // External outbound links in text
            if (subObj.url && typeof subObj.url === 'string' && subObj.url.includes('l.facebook.com/l.php')) {
                try {
                    const u = new URL(subObj.url);
                    const realUrl = u.searchParams.get('u');
                    if (realUrl) postEntry.external_links.push(realUrl);
                } catch(e){}
            }

            // Mentions/Hashtags/Groups
            if (subObj.entity) {
                if (subObj.entity.__typename === 'Hashtag') {
                    postEntry.hashtags.push(subObj.entity.name);
                } else if (subObj.entity.__typename === 'Group') {
                    postEntry.mentioned_groups.push({
                        id: subObj.entity.id,
                        url: subObj.entity.url || subObj.entity.profile_url
                    });
                }
            }

            // Hidden creation timestamps inside layout
            if (subObj.creation_time && !postEntry.creation_timestamp) {
                postEntry.creation_timestamp = subObj.creation_time;
            }
            
            // Reaction Type Summaries
            if (subObj.__typename === 'CometFeedUFIContainer_feedback' && subObj.top_reactions) {
                postEntry.metrics.reaction_types = subObj.top_reactions.edges?.map(e => e.node?.localized_name).filter(Boolean);
            }

            Object.values(subObj).forEach(findDeepPostData);
        }
        findDeepPostData(obj);
        
        // Deduplicate links/hashtags
        postEntry.external_links = [...new Set(postEntry.external_links)];
        postEntry.hashtags = [...new Set(postEntry.hashtags)];

        catalog.posts.push(postEntry);
        postIndex++;
    }

    // Capture contact info globally
    if (obj.profile_tile_section_type === 'CONTACT_INFO' && obj.profile_tile_views) {
        const str = JSON.stringify(obj);
        const matches = str.match(/"text":"([^"]+)"/g) || [];
        matches.forEach(m => {
            const val = m.replace(/"text":"/, '').replace(/"$/, '');
            if (val.includes('@')) catalog.metadata.contact_info.emails.push(val);
            else if (val.match(/[\d\-\+]{8,}/)) catalog.metadata.contact_info.phones.push(val);
            else if (val.includes('http') || val.includes('.com') || val.includes('.bd')) catalog.metadata.contact_info.websites.push(val);
            else if (val.length > 10 && val !== 'Contact info') catalog.metadata.contact_info.address.push(val);
        });
    }

    Object.values(obj).forEach(traverseGraphqlForPosts);
}

rawData.graphql.forEach(req => {
    if (req.request_payload && req.request_payload.fb_api_req_friendly_name === 'ProfileCometTimelineFeedRefetchQuery') {
        req.responses.forEach(res => {
            if (!res.parse_error) traverseGraphqlForPosts(res);
        });
    }
});

// Final Deduplication
catalog.metadata.contact_info.emails = [...new Set(catalog.metadata.contact_info.emails)];
catalog.metadata.contact_info.phones = [...new Set(catalog.metadata.contact_info.phones)];
catalog.metadata.contact_info.websites = [...new Set(catalog.metadata.contact_info.websites)];
catalog.metadata.contact_info.address = [...new Set(catalog.metadata.contact_info.address)];

console.log("\n=== Final Catalog Generation Complete ===");
console.log(`Page: ${catalog.metadata.name} (ID: ${catalog.metadata.page_id})`);
console.log(`Category: ${catalog.metadata.category}`);
console.log(`Creation Info: ${catalog.metadata.creation_date}`);
console.log(`Total Posts Cataloged: ${catalog.posts.length}`);

fs.writeFileSync(OUTPUT_CATALOG, JSON.stringify(catalog, null, 2));
console.log(`\nSuccessfully saved the FULL structured Page Catalog to: ${OUTPUT_CATALOG}`);
