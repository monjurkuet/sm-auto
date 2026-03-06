const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');

async function getDebuggerUrl() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json/version', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data).webSocketDebuggerUrl));
        }).on('error', reject);
    });
}

(async () => {
    try {
        const wsUrl = await getDebuggerUrl();
        console.log('Connecting to browser...', wsUrl);
        const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
        
        const page = await browser.newPage();
        
        const extractedData = {
            dom: {},
            graphql: [],
            other_api_calls: []
        };

        // Intercept network requests
        page.on('response', async (response) => {
            const url = response.url();
            
            // We want to capture absolutely everything from GraphQL
            if (url.includes('/api/graphql/') || url.includes('/graphql/')) {
                try {
                    const text = await response.text();
                    
                    // Facebook often sends batched/streaming JSON separated by newlines
                    const payloads = text.split('\n').filter(line => line.trim().length > 0);
                    
                    const parsedPayloads = payloads.map(payload => {
                        try {
                            return JSON.parse(payload);
                        } catch(e) {
                            return { raw_text: payload, parse_error: true };
                        }
                    });

                    // Capture request data as well to understand what was asked
                    let requestPostData = null;
                    try {
                        const req = response.request();
                        if (req.method() === 'POST') {
                            const postDataStr = req.postData();
                            if (postDataStr) {
                                // Try to parse URL-encoded form data into a neat object
                                const params = new URLSearchParams(postDataStr);
                                requestPostData = Object.fromEntries(params.entries());
                                // Try to parse nested JSON strings if present (like variables)
                                if (requestPostData.variables) {
                                    try { requestPostData.variables = JSON.parse(requestPostData.variables); } catch(e){}
                                }
                            }
                        }
                    } catch(e) {}

                    extractedData.graphql.push({
                        url: url,
                        status: response.status(),
                        request_payload: requestPostData,
                        responses: parsedPayloads,
                        timestamp: new Date().toISOString()
                    });
                    
                    console.log(`Captured GraphQL response (${parsedPayloads.length} fragments)`);
                } catch (e) {
                    console.log(`Failed to read GraphQL response body: ${e.message}`);
                }
            } else if (url.includes('/api/') || url.includes('ajax')) {
                // Capture other potential API calls just in case
                try {
                    extractedData.other_api_calls.push({
                        url: url,
                        method: response.request().method(),
                        status: response.status()
                    });
                } catch(e) {}
            }
        });

        console.log('Navigating to page...');
        await page.goto('https://www.facebook.com/ryanscomputersbanani', { waitUntil: 'networkidle2', timeout: 90000 });
        
        console.log('Scrolling deeply to trigger lazy loading and load historical data...');
        // Scroll 10 times with a 2-second delay between each to ensure network requests trigger and finish
        for (let i = 0; i < 15; i++) {
            await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 2000));
            console.log(`Scroll iteration ${i+1}/15...`);
        }

        // Wait a bit more for final requests to settle
        await new Promise(r => setTimeout(r, 5000));

        console.log('Extracting ALL visible DOM data...');
        extractedData.dom = await page.evaluate(() => {
            
            // Helper to get text cleanly
            const getText = (el) => el ? el.innerText.trim() : null;
            const getAttr = (el, attr) => el ? el.getAttribute(attr) : null;

            // 1. Meta tags & Head data
            const metaTags = Array.from(document.querySelectorAll('meta')).map(meta => ({
                name: meta.getAttribute('name') || meta.getAttribute('property'),
                content: meta.getAttribute('content')
            })).filter(m => m.name && m.content);

            // 2. All text elements grouped by tag
            const textNodes = {};
            ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span'].forEach(tag => {
                textNodes[tag] = Array.from(document.querySelectorAll(tag))
                    .map(getText)
                    .filter(t => t && t.length > 0);
            });

            // 3. All Links with their text and href
            const links = Array.from(document.querySelectorAll('a')).map(a => ({
                text: getText(a),
                href: getAttr(a, 'href'),
                ariaLabel: getAttr(a, 'aria-label')
            })).filter(l => l.href || l.text);

            // 4. All Images
            const images = Array.from(document.querySelectorAll('img')).map(img => ({
                src: getAttr(img, 'src'),
                alt: getAttr(img, 'alt'),
                width: getAttr(img, 'width'),
                height: getAttr(img, 'height')
            })).filter(img => img.src);

            // 5. Explicitly target Facebook Post structures (data-ad-preview="message")
            const posts = Array.from(document.querySelectorAll('div[data-ad-preview="message"]')).map(el => ({
                text: getText(el),
                html: el.innerHTML
            }));

            // 6. Any schema.org JSON-LD data blocks
            const structuredData = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                .map(script => {
                    try { return JSON.parse(script.innerText); } 
                    catch(e) { return script.innerText; }
                });

            // 7. ARIA Labels (often contain hidden descriptive data for screen readers)
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

        console.log(`Writing comprehensive dataset to disk...`);
        fs.writeFileSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json', JSON.stringify(extractedData, null, 2));
        
        console.log(`Successfully saved all data! File size: ${fs.statSync('/root/codebase/sm-auto/sm_auto/exploration/fb_comprehensive_data.json').size / 1024 / 1024} MB`);
        
        await page.close();
        browser.disconnect();
        
    } catch (err) {
        console.error('Error during scraping:', err);
    }
})();
