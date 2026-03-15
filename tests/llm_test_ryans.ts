import { ChromeClient } from '../src/browser/chrome_client';

const OLLAMA_URL = 'http://localhost:8082';
const MODEL = 'Qwen3.5-4B-UD-Q5_K_XL.gguf';

async function callLLM(prompt: string, timeoutSec = 90): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const response = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timeout);
  }
}

async function testPage(pageUrl: string) {
  const chrome = new ChromeClient(9222);
  const browser = await chrome.connect();
  
  try {
    const page = await browser.newPage();
    
    // Get main page
    console.log(`Fetching ${pageUrl}...`);
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Get spans
    const spans = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('span'))
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[];
    });
    
    console.log('Total spans:', spans.length);
    
    // Filter relevant
    const relevantSpans = spans.filter((s: string) => {
      return (
        /^\+?[\d\s\-().]{6,}$/.test(s) ||
        /Banani|Dhaka|Bangladesh/i.test(s) ||
        /Computer Store|Store|Shop/i.test(s) ||
        /followers/.test(s) ||
        s.length < 50
      );
    }).slice(0, 50);
    
    console.log('Relevant spans:', relevantSpans.length);
    
    // Prompt
    const prompt = `Extract Facebook page info. Return ONLY JSON:
{"name":"","category":"","followers":0,"phones":[""],"addresses":[""]}

Spans: ${JSON.stringify(relevantSpans)}
  
Return JSON only:`;

    console.log('Sending to LLM...');
    const result = await callLLM(prompt, 60);
    console.log('Result:', result);
    
    try {
      const parsed = JSON.parse(result);
      console.log('\n✅ Parsed:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('\n❌ Parse failed');
    }
    
  } finally {
    await chrome.disconnect();
  }
}

// Test with the new page
testPage('https://www.facebook.com/ryanscomputers');
