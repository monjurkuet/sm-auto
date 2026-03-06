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
        
        const pageData = {
            about_details: {},
            transparency: {}
        };

        // 1. Visit the About / Contact Info page directly
        const aboutUrl = 'https://www.facebook.com/ryanscomputersbanani/about_contact_and_basic_info';
        console.log(`Navigating directly to About Page: ${aboutUrl}`);
        
        await page.goto(aboutUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Let it render
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('Extracting About data...');
        pageData.about_details = await page.evaluate(() => {
            const data = {
                raw_text_blocks: [],
                links: []
            };
            
            // Extract all text chunks in the main container
            const mainContainer = document.querySelector('[role="main"]');
            if (mainContainer) {
                 const elements = mainContainer.querySelectorAll('span[dir="auto"], div[dir="auto"]');
                 elements.forEach(el => {
                     const text = el.innerText.trim();
                     if (text && text.length > 2 && !data.raw_text_blocks.includes(text)) {
                         data.raw_text_blocks.push(text);
                     }
                 });
                 
                 const links = mainContainer.querySelectorAll('a');
                 links.forEach(l => {
                     if (l.innerText && l.href) {
                         data.links.push({ text: l.innerText, href: l.href });
                     }
                 });
            }
            return data;
        });

        // 2. Visit the Page Transparency tab
        const transparencyUrl = 'https://www.facebook.com/ryanscomputersbanani/about_profile_transparency';
        console.log(`Navigating directly to Transparency Page: ${transparencyUrl}`);
        
        await page.goto(transparencyUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        
        pageData.transparency = await page.evaluate(() => {
            const data = { raw_text_blocks: [] };
            const mainContainer = document.querySelector('[role="main"]');
            if (mainContainer) {
                 const elements = mainContainer.querySelectorAll('span[dir="auto"], div[dir="auto"]');
                 elements.forEach(el => {
                     const text = el.innerText.trim();
                     if (text && text.length > 3 && !data.raw_text_blocks.includes(text)) {
                         data.raw_text_blocks.push(text);
                     }
                 });
            }
            return data;
        });

        fs.writeFileSync('/root/codebase/sm-auto/sm_auto/exploration/deep_page_data.json', JSON.stringify(pageData, null, 2));
        console.log('Successfully saved deep page data to deep_page_data.json');
        
        await page.close();
        browser.disconnect();
        
    } catch (err) {
        console.error('Error during scraping:', err);
    }
})();
