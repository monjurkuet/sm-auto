const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const http = require('http');
const fs = require('fs');
const path = require('path');

// Ensure node-fetch is available for plugin page scraping
let fetch;
try {
    fetch = require('node-fetch');
} catch (e) {
    console.error("node-fetch not found. Please install with: bun add node-fetch");
    process.exit(1);
}

// --- Helper to get debugger URL ---
async function getDebuggerUrl() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json/version', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data).webSocketDebuggerUrl));
        }).on('error', reject);
    });
}

// --- Main Scraper Function ---
async function scrapeFacebookPage(pageUrl, outputDir, maxScrolls = 15) {
    const outputFilePath = path.join(outputDir, 'final_page_catalog.json');
    const rawDataFilePath = path.join(outputDir, 'fb_comprehensive_data.json');
    const deepPageDataFilePath = path.join(outputDir, 'deep_page_data_v2.json');

    let browser;
    let pageIdMatch;
    let fbIdentifier;
    let robustFollowers = "Unknown"; // Initialize with default
    try {
        const wsUrl = await getDebuggerUrl();
        console.log(`[SCRAPER] Connecting to browser... ${wsUrl}`);
        browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
        
        const page = await browser.newPage();
        
        const extractedRawData = {
            dom: {},
            graphql: [],
            other_api_calls: []
        };

        // --- GraphQL Interception ---
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/api/graphql/') || url.includes('/graphql/')) {
                try {
                    const text = await response.text();
                    const payloads = text.split('\n').filter(line => line.trim().length > 0);
                    
                    const parsedPayloads = payloads.map(payload => {
                        try { return JSON.parse(payload); } catch(e) { return { raw_text: payload, parse_error: true }; }
                    });

                    let requestPostData = null;
                    try {
                        const req = response.request();
                        if (req.method() === 'POST') {
                            const postDataStr = req.postData();
                            if (postDataStr) {
                                const params = new URLSearchParams(postDataStr);
                                requestPostData = Object.fromEntries(params.entries());
                                if (requestPostData.variables) {
                                    try { requestPostData.variables = JSON.parse(requestPostData.variables); } catch(e){}
                                }
                            }
                        }
                    } catch(e) {}

                    extractedRawData.graphql.push({
                        url: url,
                        status: response.status(),
                        request_payload: requestPostData,
                        responses: parsedPayloads,
                        timestamp: new Date().toISOString()
                    });
                } catch (e) {}
            } else if (url.includes('/api/') || url.includes('ajax')) {
                extractedRawData.other_api_calls.push({
                    url: url,
                    method: response.request().method(),
                    status: response.status()
                });
            }
        });

        // --- Navigate to Main Page & Scroll ---
        console.log(`[SCRAPER] Navigating to main page: ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 90000 });
        
        console.log(`[SCRAPER] Scrolling ${maxScrolls} times to trigger lazy loading...`);
        for (let i = 0; i < maxScrolls; i++) {
            await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 2000));
            console.log(`[SCRAPER] Scroll iteration ${i+1}/${maxScrolls}...`);
        }
        await new Promise(r => setTimeout(r, 5000)); // Final settle

        // --- Extract DOM data from Main Page ---
        console.log(`[SCRAPER] Extracting DOM data from main page...`);
        extractedRawData.dom = await page.evaluate(() => {
            const getText = (el) => el ? el.innerText.trim() : null;
            const getAttr = (el, attr) => el ? el.getAttribute(attr) : null;

            const metaTags = Array.from(document.querySelectorAll('meta')).map(meta => ({
                name: meta.getAttribute('name') || meta.getAttribute('property'),
                content: meta.getAttribute('content')
            })).filter(m => m.name && m.content);

            const textNodes = {};
            ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span'].forEach(tag => {
                textNodes[tag] = Array.from(document.querySelectorAll(tag))
                    .map(getText)
                    .filter(t => t && t.length > 0);
            });

            const links = Array.from(document.querySelectorAll('a')).map(a => ({
                text: getText(a),
                href: getAttr(a, 'href'),
                ariaLabel: getAttr(a, 'aria-label')
            })).filter(l => l.href || l.text);

            const images = Array.from(document.querySelectorAll('img')).map(img => ({
                src: getAttr(img, 'src'),
                alt: getAttr(img, 'alt'),
                width: getAttr(img, 'width'),
                height: getAttr(img, 'height')
            })).filter(img => img.src);

            const posts = Array.from(document.querySelectorAll('div[data-ad-preview="message"]')).map(el => ({
                text: getText(el),
                html: el.innerHTML
            }));

            const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                .map(script => { try { return JSON.parse(script.innerText); } catch(e) { return script.innerText; } });

            const ariaLabeledElements = Array.from(document.querySelectorAll('[aria-label]')).map(el => ({
                label: getAttr(el, 'aria-label'),
                role: getAttr(el, 'role'),
                tag: el.tagName
            }));

            return {
                title: document.title,
                url: window.location.href,
                metaTags,
                textNodes,
                links,
                images,
                posts,
                structuredData,
                ariaLabeledElements
            };
        });

        fs.writeFileSync(rawDataFilePath, JSON.stringify(extractedRawData, null, 2));
        console.log(`[SCRAPER] Raw comprehensive data saved to ${rawDataFilePath}`);

        // --- Scrape Deep Page Data (About & Transparency) ---
        const pageDetails = { intro: [], transparency: [], creation_date: null };

        // Visit About -> Transparency tab
        console.log(`[SCRAPER] Navigating to About -> Transparency...`);
        await page.goto(`${pageUrl}/about_profile_transparency`, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000)); // Let it render
        
        const transparencyData = await page.evaluate(() => {
            const texts = Array.from(document.querySelectorAll('span')).map(s => s.innerText);
            const creationNode = texts.find(t => t.includes('Page created - '));
            return {
                all_text: texts.filter(t => t && t.trim().length > 3),
                creation_date: creationNode
            };
        });
        pageDetails.transparency = transparencyData.all_text;
        pageDetails.creation_date = transparencyData.creation_date;

        // Visit About -> Details (Category and Contact)
        console.log(`[SCRAPER] Navigating to About -> Details...`);
        await page.goto(`${pageUrl}/about_contact_and_basic_info`, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000)); // Let it render
        
        const detailsData = await page.evaluate(() => {
            const texts = Array.from(document.querySelectorAll('span[dir="auto"], div[dir="auto"]')).map(s => s.innerText);
            return texts.filter(t => t && t.trim().length > 2);
        });
        pageDetails.intro = detailsData;

        fs.writeFileSync(deepPageDataFilePath, JSON.stringify(pageDetails, null, 2));
        console.log(`[SCRAPER] Deep page data (About/Transparency) saved to ${deepPageDataFilePath}`);

        // --- Get Follower Count from Plugin Page (Robust Method) ---
        // --- Initialize Catalog Object Early ---
        const catalog = {
            metadata: {
                page_id: null,
                name: extractedRawData.dom.textNodes.h1 && extractedRawData.dom.textNodes.h1.length > 0 ? extractedRawData.dom.textNodes.h1[0] : extractedRawData.dom.title,
                url: extractedRawData.dom.url,
                category: null,
                followers: robustFollowers,
                creation_date: pageDetails.creation_date,
                transparency_history: pageDetails.transparency,
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
        
        // Populate Category from deepPageData.intro
        const possibleCategory = pageDetails.intro.find(t => t.includes('Store') || t.includes('Company') || t.includes('Brand'));
        if (possibleCategory) catalog.metadata.category = possibleCategory;

        // --- Extract Contact Info from Deep Page Data ---
        const allAboutText = [...pageDetails.intro, ...pageDetails.transparency];
        allAboutText.forEach(text => {
            const phoneMatch = text.match(/(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?(\d{3}[\s-]?\d{4})/);
            if (phoneMatch && phoneMatch[0].length > 7) {
                catalog.metadata.contact_info.phones.push(phoneMatch[0].trim());
            }
            const emailMatch = text.match(/[\w\.-]+@[\w\.-]+\.\w{2,4}/);
            if (emailMatch) {
                catalog.metadata.contact_info.emails.push(emailMatch[0].trim());
            }
            const websiteMatch = text.match(/(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9\-\.]+\.(com|org|net|bd)[\/\w\-\.]*)/);
            if (websiteMatch && websiteMatch[0].length > 5 && !websiteMatch[0].includes('@')) {
                catalog.metadata.contact_info.websites.push(websiteMatch[0].trim());
            }
            if (text.includes("Dhaka, Bangladesh")) {
                 catalog.metadata.contact_info.address.push(text.trim());
            }
        });
        catalog.metadata.contact_info.phones = [...new Set(catalog.metadata.contact_info.phones)];
        catalog.metadata.contact_info.emails = [...new Set(catalog.metadata.contact_info.emails)];
        catalog.metadata.contact_info.websites = [...new Set(catalog.metadata.contact_info.websites)];
        catalog.metadata.contact_info.address = [...new Set(catalog.metadata.contact_info.address)];
        
        // Process ARIA for post metrics mapping
        const postMetricsMap = new Map();
        let currentPostIndexForMetrics = 0;
        extractedRawData.dom.ariaLabeledElements.forEach(el => {
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
            if (commentMatch && currentPostIndexForMetrics > 0) {
                const targetPost = currentPostIndexForMetrics - 1;
                if (!postMetricsMap.has(targetPost)) postMetricsMap.set(targetPost, { likes: "Unknown", top_commenters: [] });
                postMetricsMap.get(targetPost).top_commenters.push(commentMatch[1]);
            }
        });

        // Process GraphQL to build the Posts array
        let postIndex = 0;
        const processedPostIds = new Set();
        function traverseGraphqlForPosts(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (obj.__typename === 'Story' || obj.__isFeedUnit === 'Story') {
                if (!obj.id || processedPostIds.has(obj.id)) return;
                processedPostIds.add(obj.id);
                const postEntry = {
                    internal_id: obj.id,
                    post_id: obj.post_id || null,
                    url: obj.url || null,
                    creation_timestamp: obj.creation_time || null,
            text: obj.message && obj.message.text ? obj.message.text : obj.comet_sections?.message_container?.story?.message?.text || null,
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

        // Hashtag extraction (from message ranges and text)
        if (obj.message && obj.message.ranges && Array.isArray(obj.message.ranges)) {
            obj.message.ranges.forEach(range => {
                if (range.entity && range.entity.__typename === 'Hashtag' && range.entity.name) {
                    postEntry.hashtags.push(range.entity.name);
                }
            });
        }
        if (postEntry.text) {
            const textHashtags = postEntry.text.match(/#(\w+)/g);
            if (textHashtags) {
                textHashtags.forEach(tag => postEntry.hashtags.push(tag.substring(1)));
            }
        }

                if (obj.actors && obj.actors.length > 0) {
                    postEntry.author = { id: obj.actors[0].id, name: obj.actors[0].name };
                    catalog.metadata.page_id = obj.actors[0].id;
                } else if (obj.feedback && obj.feedback.owning_profile) {
                    postEntry.author = { id: obj.feedback.owning_profile.id, name: obj.feedback.owning_profile.name };
                    catalog.metadata.page_id = obj.feedback.owning_profile.id;
                }
                function findDeepPostData(subObj) {
                    if (!subObj || typeof subObj !== 'object') return;
                    if (subObj.__typename === 'Photo' && subObj.photo_image) {
                        postEntry.media.photos.push({ id: subObj.id, url: subObj.photo_image.uri, width: subObj.viewer_image?.width, height: subObj.viewer_image?.height });
                    } else if (subObj.__typename === 'Video' && subObj.id) {
                        const isReel = (subObj.original_height > subObj.original_width) || !!subObj.is_reel;
                        // Prioritize better quality/direct URLs
                        const videoUrl = subObj.browser_native_hd_url || subObj.playable_url || subObj.fallback_url || null;
                        postEntry.media.videos.push({ id: subObj.id, url: videoUrl, dash_manifest: !!subObj.dash_manifest, duration_sec: subObj.length_in_second, is_reel: isReel });
                    }
                    if (subObj.url && typeof subObj.url === 'string' && subObj.url.includes('l.facebook.com/l.php')) {
                        try { const u = new URL(subObj.url); const realUrl = u.searchParams.get('u'); if (realUrl) postEntry.external_links.push(realUrl); } catch(e){}
                    }
                    if (subObj.entity) {
                        if (subObj.entity.__typename === 'Hashtag') { postEntry.hashtags.push(subObj.entity.name); }
                        else if (subObj.entity.__typename === 'Group') { postEntry.mentioned_groups.push({ id: subObj.entity.id, url: subObj.entity.url || subObj.entity.profile_url }); }
                    }
                    if (subObj.creation_time && !postEntry.creation_timestamp) { postEntry.creation_timestamp = subObj.creation_time; }
                    if (subObj.__typename === 'CometFeedUFIContainer_feedback' && subObj.top_reactions) {
                        postEntry.metrics.reaction_types = subObj.top_reactions.edges?.map(e => e.node?.localized_name).filter(Boolean);
                    }
                    Object.values(subObj).forEach(findDeepPostData);
                }
                findDeepPostData(obj);
                postEntry.external_links = [...new Set(postEntry.external_links)];
                postEntry.hashtags = [...new Set(postEntry.hashtags)];
                postEntry.mentioned_groups = postEntry.mentioned_groups.filter((group, index, self) => index === self.findIndex(g => g.id === group.id));
                catalog.posts.push(postEntry);
                postIndex++;
            }
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
        extractedRawData.graphql.forEach(req => {
            if (req.request_payload && req.request_payload.fb_api_req_friendly_name === 'ProfileCometTimelineFeedRefetchQuery') {
                req.responses.forEach(res => {
                    if (!res.parse_error) traverseGraphqlForPosts(res);
                });
            }
        });

        // Final Deduplication for metadata.contact_info
        catalog.metadata.contact_info.emails = [...new Set(catalog.metadata.contact_info.emails)];
        catalog.metadata.contact_info.phones = [...new Set(catalog.metadata.contact_info.phones)];
        catalog.metadata.contact_info.websites = [...new Set(catalog.metadata.contact_info.websites)];
        catalog.metadata.contact_info.address = [...new Set(catalog.metadata.contact_info.address)];

        console.log(`[SCRAPER] Catalog Summary: Page: ${catalog.metadata.name}, Posts: ${catalog.posts.length}`);
        fs.writeFileSync(outputFilePath, JSON.stringify(catalog, null, 2));
        console.log(`[SCRAPER] Final structured catalog saved to ${outputFilePath}`);

    } catch (error) {
        console.error(`[SCRAPER ERROR] ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            await browser.disconnect();
        }
    }
}

// --- CLI Usage ---
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: bun run facebook_page_scraper.js <facebook_page_url> <output_directory> [max_scrolls]');
    console.log('Example: bun run facebook_page_scraper.js https://www.facebook.com/ryanscomputersbanani ./output');
    process.exit(1);
}

const pageUrl = args[0];
const outputDirectory = args[1];
const scrolls = parseInt(args[2] || '15', 10);

(async () => {
    try {
        await scrapeFacebookPage(pageUrl, outputDirectory, scrolls);
        console.log('[SCRAPER] Operation completed successfully.');
    } catch (e) {
        console.error(`[SCRAPER] Failed to complete operation: ${e.message}`);
        process.exit(1);
    }
})();