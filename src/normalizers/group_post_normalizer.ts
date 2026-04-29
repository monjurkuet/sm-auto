import type { GroupPost } from '../types/contracts';
import type { PostMetricSnapshot } from '../parsers/dom/post_dom_parser';

function normalizeText(text: string | null): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // Simple overlap score: shared words / total unique words
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let shared = 0;
  for (const w of wordsA) {
    if (setB.has(w)) shared++;
  }
  const allWords = new Set(wordsA);
  for (const w of wordsB) allWords.add(w);
  const total = allWords.size;
  return total > 0 ? shared / total : 0;
}

export function normalizeGroupPosts(
  graphqlPosts: GroupPost[],
  domMetrics: PostMetricSnapshot[]
): GroupPost[] {
  if (!domMetrics.length) return graphqlPosts;

  return graphqlPosts.map(post => {
    const postText = normalizeText(post.text);
    if (!postText) return post;

    let bestMatch: PostMetricSnapshot | null = null;
    let bestScore = 0.5; // minimum threshold

    for (const metric of domMetrics) {
      const metricText = normalizeText(metric.messageText);
      const score = textSimilarity(postText, metricText);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = metric;
      }
    }

    if (!bestMatch) return post;

    return {
      ...post,
      metrics: {
        reactions: bestMatch.reactions ?? post.metrics.reactions,
        comments: bestMatch.comments ?? post.metrics.comments,
        shares: bestMatch.shares ?? post.metrics.shares,
      },
    };
  });
}
