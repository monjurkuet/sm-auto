import type { PagePost } from '../types/contracts';
import type { PostMetricSnapshot } from '../parsers/dom/post_dom_parser';

function normalizeText(value: string | null): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function scoreMatch(post: PagePost, metric: PostMetricSnapshot): number {
  const postText = normalizeText(post.text);
  const metricText = normalizeText(metric.messageText);
  if (!postText || !metricText) {
    return 0;
  }

  if (postText === metricText) {
    return 1000;
  }

  const shortPost = postText.slice(0, 120);
  const shortMetric = metricText.slice(0, 120);

  if (shortPost && shortMetric && (shortPost.startsWith(shortMetric) || shortMetric.startsWith(shortPost))) {
    return 800;
  }

  let overlap = 0;
  for (const token of shortPost.split(' ')) {
    if (token.length > 4 && shortMetric.includes(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

export function normalizePosts(posts: PagePost[], domMetrics: PostMetricSnapshot[]): PagePost[] {
  const usedMetricIndexes = new Set<number>();

  return posts.map((post, index) => {
    let selectedIndex = -1;
    let bestScore = 0;

    for (let metricIndex = 0; metricIndex < domMetrics.length; metricIndex += 1) {
      if (usedMetricIndexes.has(metricIndex)) {
        continue;
      }

      const score = scoreMatch(post, domMetrics[metricIndex]);
      if (score > bestScore) {
        bestScore = score;
        selectedIndex = metricIndex;
      }
    }

    const metrics = selectedIndex >= 0 ? domMetrics[selectedIndex] : domMetrics[index];
    if (!metrics) {
      return post;
    }

    if (selectedIndex >= 0) {
      usedMetricIndexes.add(selectedIndex);
    }

    return {
      ...post,
      metrics: {
        reactions: metrics.reactions,
        comments: metrics.comments,
        shares: metrics.shares
      }
    };
  });
}
