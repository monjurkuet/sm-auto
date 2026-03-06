const fs = require('fs');
const rawData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', 'utf8'));

console.log("Extracting internal telemetry and tracking IDs from Posts...\n");

function findTracking(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;
    
    if (obj.__typename === 'Story' || obj.__isFeedUnit === 'Story') {
        if (obj.id) {
            console.log(`\nPost ID: ${obj.id}`);
            if (obj.post_id) console.log(`Raw Post ID: ${obj.post_id}`);
            
            // Look for ad / tracking nodes
            if (obj.sponsored_data) {
                console.log("THIS IS A SPONSORED POST (AD)!");
                console.log(`Ad ID: ${obj.sponsored_data.ad_id}`);
                console.log(`Client Token: ${obj.sponsored_data.client_token}`);
            }
            
            if (obj.encrypted_tracking) {
                console.log(`Encrypted Tracking Token: ${obj.encrypted_tracking.substring(0, 30)}...`);
            }
            
            if (obj.trackingdata && obj.trackingdata.ei) {
                console.log(`Tracking Data (EI): ${obj.trackingdata.ei}`);
            }
            
            if (obj.cix_screen) {
                console.log(`CIX Screen context (Client tracking): Present`);
            }
        }
    }
    
    Object.values(obj).forEach(child => findTracking(child, depth + 1));
}

let count = 0;
rawData.graphql.forEach(req => {
    if (req.request_payload && req.request_payload.fb_api_req_friendly_name === 'ProfileCometTimelineFeedRefetchQuery') {
        if (count > 0) return; // just do the first response chunk to keep output clean
        count++;
        req.responses.forEach(res => {
            if (!res.parse_error) findTracking(res);
        });
    }
});
