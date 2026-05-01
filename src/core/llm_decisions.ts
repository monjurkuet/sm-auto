/**
 * LLM decision functions for the group monitoring orchestrator.
 * Uses the custom LLM endpoint for intelligent decisions about
 * group joining, post classification, and organic conversation detection.
 */

import type { LLMConfig } from './monitor_config';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

/** Call the LLM endpoint with OpenAI-compatible chat completions API. */
async function callLLM(config: LLMConfig, messages: LLMMessage[], model?: string): Promise<string> {
  const url = `${config.base_url}/chat/completions`;
  const body = {
    model: model ?? config.model,
    messages,
    max_tokens: 1024,
    temperature: 0.3,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LLM_API_KEY ?? 'sk-placeholder'}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/** Should we request to join this group? */
export async function llmDecideJoin(
  config: LLMConfig,
  groupInfo: { name: string; memberCount: number | null; privacyType: string | null; vitalityScore: number | null },
): Promise<{ shouldJoin: boolean; reason: string }> {
  const prompt = `You are evaluating Facebook groups for a Bangladesh-based crypto/trading monitoring system.
Group: "${groupInfo.name}"
Members: ${groupInfo.memberCount ?? 'unknown'}
Privacy: ${groupInfo.privacyType ?? 'unknown'}
Vitality score: ${groupInfo.vitalityScore ?? 'not yet scored'}/100

Should we request to join this group? Consider: relevance to crypto/trading/investment in Bangladesh, activity level, member count reasonableness, privacy implications.
Respond in JSON format: {"should_join": true/false, "reason": "brief explanation"}`;

  try {
    const response = await callLLM(config, [{ role: 'user', content: prompt }], config.strong_model);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { should_join?: boolean; reason?: string };
      return { shouldJoin: parsed.should_join ?? false, reason: parsed.reason ?? 'LLM parsing failed' };
    }
    // Fallback: check for yes/no in text
    const lower = response.toLowerCase();
    if (lower.includes('yes') && !lower.includes('no')) return { shouldJoin: true, reason: response.slice(0, 200) };
    return { shouldJoin: false, reason: response.slice(0, 200) };
  } catch (err) {
    return { shouldJoin: false, reason: `LLM call failed: ${(err as Error).message}` };
  }
}

/** Classify posts for training data curation. */
export async function llmClassifyPosts(
  config: LLMConfig,
  posts: Array<{ text: string | null; authorName: string | null; reactions: number | null; comments: number | null }>,
): Promise<Array<{ language: string; conversation_type: string; author_type: string; is_organic: boolean }>> {
  if (posts.length === 0) return [];

  const postsText = posts
    .map((p, i) => `[${i}] "${(p.text ?? '').slice(0, 150)}" by ${p.authorName ?? 'unknown'} (${p.reactions ?? 0}r/${p.comments ?? 0}c)`)
    .join('\n');

  const prompt = `Classify these Facebook group posts. For each, determine:
1. language: "bn" (Bangla/Bengali), "en" (English), "mixed" (both), "unknown"
2. conversation_type: one of: discussion, question, answer, promotion, spam, scam, announcement
3. author_type: one of: real, suspected_bot, business, verified
4. is_organic: true if genuine community interaction, false if manufactured/automated

Posts:
${postsText}

Return a JSON array with same number of entries. Each entry: {"language":"...", "conversation_type":"...", "author_type":"...", "is_organic":true/false}`;

  try {
    const response = await callLLM(config, [{ role: 'user', content: prompt }]);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{ language?: string; conversation_type?: string; author_type?: string; is_organic?: boolean }>;
      return parsed.map((p) => ({
        language: p.language ?? 'unknown',
        conversation_type: p.conversation_type ?? 'discussion',
        author_type: p.author_type ?? 'real',
        is_organic: p.is_organic ?? true,
      }));
    }
  } catch {
    // LLM failed — return defaults
  }

  return posts.map(() => ({ language: 'unknown', conversation_type: 'discussion', author_type: 'real', is_organic: true }));
}

/** Detect language of text — heuristic (no LLM needed). */
export function detectLanguage(text: string): 'bn' | 'en' | 'mixed' {
  if (!text) return 'en';
  // Bengali Unicode range: U+0980 to U+09FF
  const bengaliChars = (text.match(/[\u0980-\u09FF]/g) ?? []).length;
  const totalChars = text.replace(/\s/g, '').length || 1;
  const bengaliRatio = bengaliChars / totalChars;

  if (bengaliRatio > 0.3) return 'bn';
  if (bengaliRatio > 0.05) return 'mixed';
  return 'en';
}
