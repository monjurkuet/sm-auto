const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', 'utf8'));

console.log("Deep Dive: Analyzing the structure of a Single Post (Story) in GraphQL...");

let storyFound = false;

function deepKeyAnalyzer(obj, path = '', typeKeys = {}) {
    if (!obj || typeof obj !== 'object') return typeKeys;
    
    Object.keys(obj).forEach(key => {
        const fullPath = path ? `${path}.${key}` : key;
        const valType = Array.isArray(obj[key]) ? 'array' : typeof obj[key];
        
        if (!typeKeys[fullPath]) {
            typeKeys[fullPath] = new Set();
        }
        typeKeys[fullPath].add(valType);
        
        // If it's an object/array, go deeper, but stop at a reasonable depth to avoid infinite loops on circular refs
        if (valType === 'object' && obj[key] !== null) {
            deepKeyAnalyzer(obj[key], fullPath, typeKeys);
        } else if (valType === 'array' && obj[key].length > 0) {
            // Analyze the first element of the array as a representative
            deepKeyAnalyzer(obj[key][0], `${fullPath}[]`, typeKeys);
        }
    });
    
    return typeKeys;
}

const allStoryKeys = {};

// Find the first rich story to analyze
rawData.graphql.forEach(req => {
    if (req.request_payload && req.request_payload.fb_api_req_friendly_name === 'ProfileCometTimelineFeedRefetchQuery') {
        req.responses.forEach(res => {
            if (res.parse_error) return;
            
            // Traverse to find the first story node
            const traverse = (node) => {
                if (!node || typeof node !== 'object') return;
                
                if ((node.__typename === 'Story' || node.__isFeedUnit === 'Story') && node.id) {
                    if (!storyFound) {
                        console.log(`\nFound a representative Story object. ID: ${node.id}`);
                        const keys = deepKeyAnalyzer(node);
                        
                        // Let's print out the top level keys first
                        console.log("\n--- Top Level Fields of a Post ---");
                        Object.keys(node).forEach(k => {
                            const valType = Array.isArray(node[k]) ? `Array(${node[k].length})` : typeof node[k];
                            console.log(`${k}: ${valType}`);
                        });
                        
                        // Look for specific rich data points
                        console.log("\n--- Searching for Hidden Gold in this Post ---");
                        if (node.comet_sections) {
                            console.log("Found 'comet_sections' - This is where Facebook hides the UI rendering data.");
                            console.log("Keys inside comet_sections:", Object.keys(node.comet_sections).join(', '));
                            
                            if (node.comet_sections.context_layout) console.log(" -> context_layout usually holds timestamp and author rendering data.");
                            if (node.comet_sections.message_container) console.log(" -> message_container holds the text.");
                            if (node.comet_sections.feedback) console.log(" -> feedback holds the interactions (likes/comments/shares).");
                        }
                        
                        if (node.attachments && node.attachments.length > 0) {
                            console.log(`\nFound ${node.attachments.length} attachment(s). First attachment type:`, node.attachments[0].media?.__typename);
                            if (node.attachments[0].styles) {
                                console.log("Attachment Styles (Determines how it looks):", node.attachments[0].styles.__typename);
                            }
                        }
                        
                        // Extract tracking data
                        if (node.tracking) console.log("\nFound 'tracking' string. Length:", node.tracking.length);
                        if (node.encrypted_tracking) console.log("Found 'encrypted_tracking' string.");

                        storyFound = true;
                    }
                }
                
                Object.values(node).forEach(traverse);
            };
            
            traverse(res);
        });
    }
});
