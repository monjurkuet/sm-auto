const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', 'utf8'));

console.log("=== EXPLORING SHORT-FORM VIDEO (REELS) ===");

const reels = [];
const liveBroadcasts = [];

function findVideoFormats(obj, path = '', postContext = null) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.__typename === 'Story' || obj.__isFeedUnit === 'Story') {
        postContext = obj;
    }

    if (obj.__typename === 'Video') {
        // Facebook often distinguishes Reels by their aspect ratio (vertical) or explicit flags
        const isVertical = obj.original_height > obj.original_width;
        
        // Sometimes it's nested under a Shorts object
        if (path.includes('Shorts') || path.includes('Reel') || isVertical) {
             reels.push({
                 id: obj.id,
                 url: postContext ? postContext.url : null,
                 width: obj.original_width,
                 height: obj.original_height,
                 duration: obj.length_in_second
             });
        }
    }

    if (obj.__typename === 'VideoBroadcast' || obj.is_live_streaming) {
        liveBroadcasts.push({
             id: obj.id,
             status: obj.broadcast_status
        });
    }
    
    // Look for explicit Short-form typenames found in earlier exploration
    if (obj.__typename === 'FbShortsVideoAttachmentStyleInfo') {
        reels.push({
             type: 'Explicit Shorts Style',
             path: path
        });
    }

    Object.entries(obj).forEach(([key, child]) => {
        findVideoFormats(child, `${path}.${key}`, postContext);
    });
}

rawData.graphql.forEach(req => {
    req.responses.forEach(res => {
        if (!res.parse_error) findVideoFormats(res);
    });
});

console.log(`\nFound ${reels.length} Reels/Shorts artifacts.`);
if (reels.length > 0) console.log(reels.slice(0, 3));

console.log(`\nFound ${liveBroadcasts.length} Live Broadcasts.`);
if (liveBroadcasts.length > 0) console.log(liveBroadcasts);
