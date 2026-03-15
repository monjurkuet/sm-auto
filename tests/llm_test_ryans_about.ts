import { ChromeClient } from '../src/browser/chrome_client';
import { writeFileSync } from 'fs';

interface LLMResponse {
  name: string;
  category: string;
  followers: number;
  phones: string[];
  addresses: string[];
}

async function scrapeWithLLM(pageUrl: string): Promise<LLMResponse> {
  const chrome = new ChromeClient(9222);
  const browser = await chrome.connect();
  
  try {
    const page = await browser.newPage();
    
    console.log(`Fetching ${pageUrl}...`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Navigate to About page
    const aboutUrl = pageUrl.replace(/\/$/, '') + '/about';
    console.log(`Fetching About page: ${aboutUrl}...`);
    await page.goto(aboutUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for page to load
    await new Promise(r => setTimeout(r, 2000));
    
    // Click on "Contact info" to expand it
    console.log('Clicking Contact info...');
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        if (link.textContent?.includes('Contact info')) {
          (link as HTMLElement).click();
          return;
        }
      }
    });
    
    // Wait for content to load
    await new Promise(r => setTimeout(r, 2000));
    
    // Get all spans for LLM
    const spans = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('span, div, a'))
        .map(el => el.textContent?.trim())
        .filter(Boolean)
        .filter(t => t.length > 1 && t.length < 500) as string[];
    });
    
    console.log(`Got ${spans.length} spans`);
    
    // Save spans for debugging
    writeFileSync('tests/debug_spans_ryans_about.json', JSON.stringify(spans.slice(0, 200), null, 2));
    console.log('Saved spans to debug_spans_ryans_about.json');
    
    // Filter to relevant spans (those with key info)
    const relevantSpans = spans.filter(s => 
      /Ryans|Computer|followers|phone|mobile|email|website|address|location|Bangladesh|Dhaka|Rangpur/i.test(s)
    ).slice(0, 100);
    
    console.log(`Filtered to ${relevantSpans.length} relevant spans`);
    
    // Build prompt with context
    const prompt = `You are a data extraction system. Extract structured information from the following text extracted from a Facebook page.
    
Return a JSON object with these exact fields:
{
  "name": "The page name",
  "category": "The category/type (e.g., Computer Store, Electronics, etc.)",  
  "followers": number,
  "phones": ["list of phone numbers"],
  "addresses": ["list of addresses"]
}

Text to analyze:
${relevantSpans.join('\n')}

Respond ONLY with valid JSON, no other text.`;

    console.log('\n--- Sending to LLM ---');
    
    // Call Ollama
    const response = await fetch('http://localhost:8082/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:3b',
        prompt,
        stream: false,
        format: 'json'
      })
    });
    
    const result = await response.json() as { response?: string };
    console.log('LLM Response:', result.response);
    
    try {
      const parsed = JSON.parse(result.response || '{}') as LLMResponse;
      return parsed;
    } catch {
      return { name: '', category: '', followers: 0, phones: [], addresses: [] };
    }
    
  } finally {
    await chrome.disconnect();
  }
}

scrapeWithLLM('https://www.facebook.com/ryanscomputers').then(result => {
  console.log('\n=== Final Result ===');
  console.log(JSON.stringify(result, null, 2));
}).catch(console.error);
