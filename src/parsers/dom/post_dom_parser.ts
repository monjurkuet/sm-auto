export interface PostMetricSnapshot {
  messageText: string | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
}

function normalizeMessageText(value: string | null): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function metricCompleteness(snapshot: PostMetricSnapshot): number {
  let score = 0;
  if (snapshot.reactions !== null) score += 1;
  if (snapshot.comments !== null) score += 1;
  if (snapshot.shares !== null) score += 1;
  return score;
}

export function mergePostMetricSnapshots(snapshots: PostMetricSnapshot[]): PostMetricSnapshot[] {
  const merged = new Map<string, PostMetricSnapshot>();

  for (const snapshot of snapshots) {
    const key = normalizeMessageText(snapshot.messageText);
    if (!key) {
      continue;
    }

    const existing = merged.get(key);
    if (!existing || metricCompleteness(snapshot) >= metricCompleteness(existing)) {
      merged.set(key, snapshot);
    }
  }

  return [...merged.values()];
}

export async function snapshotPostMetrics(page: import('puppeteer-core').Page): Promise<PostMetricSnapshot[]> {
  return page.evaluate(() => {
    const parseNumber = (label: string): number | null => {
      const match = label.match(/([\d,.]+)/);
      return match ? Number(match[1].replace(/,/g, '')) : null;
    };

    const sumReactionLabels = (labels: string[]): number | null => {
      const values = labels
        .filter((label) => /(Like|Love|Care|Haha|Wow|Sad|Angry):\s*[\d,.]+\s+people/i.test(label))
        .map((label) => parseNumber(label))
        .filter((value): value is number => value !== null);

      if (values.length > 0) {
        return values.reduce((sum, value) => sum + value, 0);
      }

      const aggregate = labels.find((label) => /([\d,.]+)\s+reactions?/i.test(label) || /See who reacted to this/i.test(label));
      return aggregate ? parseNumber(aggregate) : null;
    };

    const parseMetric = (labels: string[], regex: RegExp): number | null => {
      const label = labels.find((entry) => regex.test(entry));
      return label ? parseNumber(label) : null;
    };

    const messageNodes = Array.from(document.querySelectorAll('div[data-ad-preview="message"]'));

    return messageNodes.map((messageNode) => {
      let container: Element | null = messageNode;
      for (let depth = 0; depth < 6 && container; depth += 1) {
        const labels = Array.from(container.querySelectorAll('[aria-label]'))
          .map((element) => element.getAttribute('aria-label') ?? '')
          .filter(Boolean);
        if (labels.some((label) => /Actions for this post|See who reacted to this|Leave a comment/i.test(label))) {
          const messageText = messageNode.textContent?.trim() ?? null;
          return {
            messageText,
            reactions: sumReactionLabels(labels),
            comments: parseMetric(labels, /([\d,.]+)\s+comments?/i),
            shares: parseMetric(labels, /([\d,.]+)\s+shares?/i)
          };
        }
        container = container.parentElement;
      }

      return {
        messageText: messageNode.textContent?.trim() ?? null,
        reactions: null,
        comments: null,
        shares: null
      };
    });
  });
}
