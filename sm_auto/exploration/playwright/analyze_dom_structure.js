const fs = require('fs');

const rawData = JSON.parse(fs.readFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', 'utf8'));

console.log("=== DOM STRUCTURE ANALYSIS ===");

const dom = rawData.dom;

console.log(`1. Basic Meta`);
console.log(`   - Title: ${dom.title}`);
console.log(`   - URL: ${dom.url}`);

console.log(`\n2. Meta Tags (Total: ${dom.metaTags.length})`);
const metaNames = new Set(dom.metaTags.map(m => m.name));
console.log(`   - Available Meta Fields:`, Array.from(metaNames).join(', '));
const desc = dom.metaTags.find(m => m.name === 'description' || m.name === 'og:description');
if (desc) console.log(`   - Description Snippet: ${desc.content.substring(0, 100)}...`);

console.log(`\n3. Text Nodes (Semantic Groupings)`);
Object.keys(dom.textNodes).forEach(tag => {
    const nodes = dom.textNodes[tag];
    console.log(`   - <${tag}>: ${nodes.length} elements`);
    if (tag === 'h1') console.log(`     Sample H1: ${nodes[0]}`);
    if (tag === 'h2') console.log(`     Sample H2: ${nodes.slice(0, 3).join(', ')}`);
});

console.log(`\n4. Links (Total: ${dom.links.length})`);
// Group links by pattern
const linkTypes = {
    internal_nav: 0,
    external: 0,
    contact_action: 0,
    user_profiles: 0
};

dom.links.forEach(l => {
    if (!l.href) return;
    if (l.href.includes('mailto:') || l.href.includes('tel:')) linkTypes.contact_action++;
    else if (l.href.startsWith('https://www.facebook.com/l.php')) linkTypes.external++;
    else if (l.href.includes('/profile.php') || l.href.match(/facebook\.com\/[^\/]+$/)) linkTypes.user_profiles++;
    else linkTypes.internal_nav++;
});
console.log(`   - Link Types:`, linkTypes);

console.log(`\n5. Images (Total: ${dom.images.length})`);
let imgWithAlt = 0;
let avatarCount = 0;
dom.images.forEach(img => {
    if (img.alt && img.alt.length > 0) imgWithAlt++;
    if (img.alt && img.alt.toLowerCase().includes('profile picture')) avatarCount++;
});
console.log(`   - Images with Alt Text (Accessibility/Context): ${imgWithAlt}`);
console.log(`   - Avatar/Profile Images Detected: ${avatarCount}`);

console.log(`\n6. Native Post HTML Blocks (Total: ${dom.posts ? dom.posts.length : 0})`);
if (dom.posts && dom.posts.length > 0) {
    console.log(`   - The DOM correctly isolates ${dom.posts.length} full post text blocks.`);
}

console.log(`\n7. ARIA Labeled Elements (Total: ${dom.ariaLabeledElements.length})`);
const roles = new Set(dom.ariaLabeledElements.map(el => el.role).filter(Boolean));
console.log(`   - Roles found:`, Array.from(roles).join(', '));
const buttons = dom.ariaLabeledElements.filter(el => el.role === 'button');
console.log(`   - Buttons with ARIA: ${buttons.length}`);
const dialogs = dom.ariaLabeledElements.filter(el => el.role === 'dialog');
console.log(`   - Dialogs/Modals with ARIA: ${dialogs.length}`);

// Sample ARIA to show what data is hidden here
const likeArias = dom.ariaLabeledElements.filter(el => el.label && el.label.includes('Like:'));
console.log(`   - Sample Metric Data from ARIA: ${likeArias.length} "Like: [Count]" elements found.`);

console.log(`\n8. Schema.org JSON-LD (Total: ${dom.structuredData ? dom.structuredData.length : 0})`);
if (dom.structuredData && dom.structuredData.length > 0) {
    console.log(`   - Schema Types:`, dom.structuredData.map(s => s['@type']));
}