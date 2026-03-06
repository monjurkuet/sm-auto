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
        
        const pageDetails = {
            intro: [],
            transparency: [],
            category: null,
            rating: null,
            creation_date: null
        };

        // 1. Visit the actual About -> Transparency tab and click the specific buttons
        console.log(`Navigating to Transparency...`);
        await page.goto('https://www.facebook.com/ryanscomputersbanani/about_profile_transparency', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        
        // Let's get the raw HTML of the main layout to parse offline if needed
        const transparencyHtml = await page.content();
        fs.writeFileSync('/root/codebase/sm-auto/sm_auto/exploration/raw_transparency.html', transparencyHtml);
        
        const transparencyData = await page.evaluate(() => {
            // Find specific markers for Page Creation
            const texts = Array.from(document.querySelectorAll('span')).map(s => s.innerText);
            const creationNode = texts.find(t => t.includes('Page created - '));
            return {
                all_text: texts.filter(t => t && t.trim().length > 3),
                creation_date: creationNode
            };
        });
        
        pageDetails.transparency = transparencyData.all_text;
        pageDetails.creation_date = transparencyData.creation_date;
        console.log("Found Transparency Data:", pageDetails.creation_date);

        // 2. Visit About -> Details (Category and Contact)
        console.log(`Navigating to Details...`);
        await page.goto('https://www.facebook.com/ryanscomputersbanani/about_contact_and_basic_info', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        
        const detailsData = await page.evaluate(() => {
            const texts = Array.from(document.querySelectorAll('span[dir="auto"], div[dir="auto"]')).map(s => s.innerText);
            return texts.filter(t => t && t.trim().length > 2);
        });
        pageDetails.intro = detailsData;

        fs.writeFileSync('/root/codebase/sm-auto/sm_auto/exploration/deep_page_data_v2.json', JSON.stringify(pageDetails, null, 2));
        console.log('Successfully saved deep page data to deep_page_data_v2.json');
        
        await page.close();
        browser.disconnect();
        
    } catch (err) {
        console.error('Error during scraping:', err);
    }
})();
