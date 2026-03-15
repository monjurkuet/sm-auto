import fs from 'node:fs';

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

async function test() {
  // Read saved data
  const snapshot = JSON.parse(fs.readFileSync('output/smoke/page_info/artifacts/page-info/main_snapshot.json', 'utf8'));
  
  // Filter to relevant spans only
  const relevantSpans = snapshot.spans.filter((s: string) => {
    return (
      /^\+?[\d\s\-().]{6,}$/.test(s) ||
      /Banani|Dhaka|Bangladesh/i.test(s) ||
      /Computer Store|Store|Shop/i.test(s) ||
      /followers/.test(s) ||
      s.length < 50
    );
  }).slice(0, 50);
  
  console.log('Relevant spans:', relevantSpans.length);
  
  // Short focused prompt
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
}

test();
