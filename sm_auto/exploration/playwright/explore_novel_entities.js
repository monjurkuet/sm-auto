const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', 'utf8'));

console.log("=== EXPLORING NOVEL ENTITIES: COMMERCE, EVENTS, GROUPS, ADS, COMMENTS ===");

const discoveries = {
    commerce: [],
    events: [],
    groups: [],
    ads_sponsored: [],
    comments: [],
    other_interesting: []
};

const keywords = ['product', 'price', 'currency', 'shop', 'cart', 'event', 'group', 'sponsor', 'ad_id', 'comment'];

function searchForNovelEntities(obj, path = '', depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 30) return;

    const typeName = obj.__typename ? obj.__typename.toLowerCase() : '';

    // 1. Commerce & Products
    if (typeName.includes('product') || typeName.includes('commerce') || obj.price || obj.formatted_price) {
        discoveries.commerce.push({ path, type: obj.__typename, keys: Object.keys(obj) });
    }

    // 2. Events
    if (typeName.includes('event')) {
        discoveries.events.push({ path, type: obj.__typename, keys: Object.keys(obj) });
    }

    // 3. Groups / Communities
    if (typeName.includes('group')) {
        discoveries.groups.push({ path, type: obj.__typename, keys: Object.keys(obj) });
    }

    // 4. Ads & Sponsored Content
    if (typeName.includes('sponsored') || obj.is_sponsored || obj.sponsored_data) {
        discoveries.ads_sponsored.push({ path, type: obj.__typename, data: obj.sponsored_data || 'Present' });
    }

    // 5. Comments & Replies
    if (typeName === 'comment' || typeName === 'top_level_comments') {
        discoveries.comments.push({ path, type: obj.__typename, keys: Object.keys(obj) });
    }

    // Broad string search for keywords
    Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'string') {
             const valLower = obj[key].toLowerCase();
             if (valLower.includes('add to cart') || valLower.includes('checkout') || valLower.includes('buy now')) {
                 discoveries.commerce.push({ path: `${path}.${key}`, value: obj[key] });
             }
        }
    });

    Object.entries(obj).forEach(([key, child]) => {
        searchForNovelEntities(child, `${path}.${key}`, depth + 1);
    });
}

rawData.graphql.forEach((req, i) => {
    req.responses.forEach((res, j) => {
        if (!res.parse_error) searchForNovelEntities(res, `graphql[${i}].responses[${j}]`);
    });
});

console.log(`\nFound ${discoveries.commerce.length} Commerce/Product related nodes.`);
if (discoveries.commerce.length > 0) console.log(discoveries.commerce.slice(0, 3));

console.log(`\nFound ${discoveries.events.length} Event related nodes.`);
console.log(`\nFound ${discoveries.groups.length} Group related nodes.`);
if (discoveries.groups.length > 0) console.log(discoveries.groups.slice(0, 2));

console.log(`\nFound ${discoveries.ads_sponsored.length} Sponsored/Ad related nodes.`);
if (discoveries.ads_sponsored.length > 0) console.log(discoveries.ads_sponsored.slice(0, 2));

console.log(`\nFound ${discoveries.comments.length} Comment related nodes.`);
if (discoveries.comments.length > 0) console.log(discoveries.comments.slice(0, 2));

EOF