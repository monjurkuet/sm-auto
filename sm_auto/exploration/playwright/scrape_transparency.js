const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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
        const transparencyGraphQL = [];

        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/api/graphql/')) {
                try {
                    const req = response.request();
                    let queryName = "Unknown";
                    
                    if (req.method() === 'POST') {
                        const postData = req.postData();
                        if (postData) {
                             const params = new URLSearchParams(postData);
                             queryName = params.get('fb_api_req_friendly_name') || "Unknown";
                        }
                    }

                    // We specifically want queries related to Profile/Page About
                    if (queryName.includes('Profile') || queryName.includes('Transparency') || queryName.includes('About')) {
                        const text = await response.text();
                        transparencyGraphQL.push({
                            query: queryName,
                            response: text.substring(0, 10000) // First 10k chars to avoid giant memory usage
                        });
                    }
                } catch (e) {}
            }
        });

        console.log(`Navigating to Transparency...`);
        // Navigate to the main page first, then click "About" to trigger the SPA (Single Page Application) load correctly
        await page.goto('https://www.facebook.com/ryanscomputersbanani', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000));
        
        // Find and click the About tab
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('a[role="tab"]'));
            const aboutTab = tabs.find(t => t.innerText.includes('About'));
            if (aboutTab) aboutTab.click();
        });
        console.log("Clicked About tab...");
        await new Promise(r => setTimeout(r, 3000));

        // Find and click Transparency in the sidebar
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const transLink = links.find(l => l.innerText.includes('Page transparency'));
            if (transLink) transLink.click();
        });
        console.log("Clicked Page Transparency...");
        await new Promise(r => setTimeout(r, 4000));

        // Click the "See all" button inside the transparency box to open the modal
        await page.evaluate(() => {
             // Look for a span that says "See all" inside the main column
             const spans = Array.from(document.querySelectorAll('span[dir="auto"]'));
             const seeAll = spans.find(s => s.innerText === 'See all');
             if (seeAll) seeAll.click();
        });
        console.log("Clicked See All Transparency modal...");
        await new Promise(r => setTimeout(r, 4000));
        
        // Dump the modal content just in case
        const modalText = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            return dialog ? dialog.innerText : "No dialog found";
        });
        console.log("\nModal Content:\n", modalText);

        fs.writeFileSync('/root/codebase/sm-auto/sm_auto/exploration/transparency_graphql.json', JSON.stringify(transparencyGraphQL, null, 2));
        
        await page.close();
        browser.disconnect();
        
    } catch (err) {
        console.error('Error during scraping:', err);
    }
})();
