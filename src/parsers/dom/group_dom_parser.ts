import type { Page } from 'puppeteer-core';

export interface GroupDomSnapshot {
  title: string;
  url: string;
  headings: string[];
  spans: string[];
  links: Array<{ href: string; text: string }>;
  metaTags: Array<{ name: string; content: string }>;
}

const GENERIC_HEADING = /^(notifications|new|earlier|marketplace|about|groups|discover|feed)$/i;

function parseNumber(value: string): number {
  const cleaned = value.replace(/,/g, '').toUpperCase();
  if (cleaned.endsWith('K')) {
    return Math.round(parseFloat(cleaned) * 1000);
  }
  if (cleaned.endsWith('M')) {
    return Math.round(parseFloat(cleaned) * 1000000);
  }
  return parseInt(cleaned, 10) || 0;
}

export async function snapshotGroupDom(page: Page): Promise<GroupDomSnapshot> {
  return page.evaluate(() => {
    const text = (element: Element | null): string => element?.textContent?.trim() ?? '';
    return {
      title: document.title,
      url: document.location.href,
      headings: Array.from(document.querySelectorAll('h1, h2'))
        .map((el) => text(el))
        .filter(Boolean),
      spans: Array.from(document.querySelectorAll('span'))
        .map((el) => text(el))
        .filter(Boolean),
      links: Array.from(document.querySelectorAll('a')).map((anchor) => ({
        href: anchor.getAttribute('href') ?? '',
        text: text(anchor)
      })),
      metaTags: Array.from(document.querySelectorAll('meta[name], meta[property]')).map((el) => ({
        name: el.getAttribute('name') ?? el.getAttribute('property') ?? '',
        content: el.getAttribute('content') ?? ''
      }))
    };
  });
}

export function parseGroupName(snapshot: GroupDomSnapshot): string | null {
  const heading = snapshot.headings.find((value) => !GENERIC_HEADING.test(value));
  if (heading) {
    return heading;
  }

  // Fallback: extract from page title (remove " | Facebook" suffix)
  const title = snapshot.title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*\|\s*Facebook.*$/i, '')
    .trim();
  if (title && !GENERIC_HEADING.test(title)) {
    return title;
  }

  return null;
}

export function parseGroupMemberCount(snapshot: GroupDomSnapshot): number | null {
  // Check spans for member count patterns like "1.2K members", "12,345 members"
  for (const span of snapshot.spans) {
    // Match "X members", "XK members", "XM members" with optional separators
    const match = span.match(/^([\d,.]+[KM]?)\s+members?$/i);
    if (match?.[1]) {
      return parseNumber(match[1]);
    }
    // Match combined patterns like "1.2K members · 5 posts/day"
    const combinedMatch = span.match(/([\d,.]+[KM]?)\s+members?\s*[·•]/i);
    if (combinedMatch?.[1]) {
      return parseNumber(combinedMatch[1]);
    }
  }

  // Check og:description meta tag which often contains member count
  for (const meta of snapshot.metaTags) {
    if (meta.name === 'og:description' && meta.content) {
      const metaMatch = meta.content.match(/([\d,.]+[KM]?)\s+members?/i);
      if (metaMatch?.[1]) {
        return parseNumber(metaMatch[1]);
      }
    }
  }

  return null;
}

export function parseGroupPrivacyType(snapshot: GroupDomSnapshot): string | null {
  for (const span of snapshot.spans) {
    if (/^public\s+group$/i.test(span)) return 'Public';
    if (/^private\s+group$/i.test(span)) return 'Private';
    if (/^secret\s+group$/i.test(span)) return 'Secret';
  }
  return null;
}

export function parseGroupDescription(snapshot: GroupDomSnapshot): string | null {
  // First try og:description meta tag
  for (const meta of snapshot.metaTags) {
    if (meta.name === 'og:description' && meta.content) {
      return meta.content.trim();
    }
  }

  // Fallback: look for a longer descriptive span (likely the group description)
  for (const span of snapshot.spans) {
    // Skip short spans, member counts, privacy labels, and generic UI text
    if (span.length < 30) continue;
    if (/^\d+[\s,]*members?/i.test(span)) continue;
    if (/^(public|private|secret)\s+group$/i.test(span)) continue;
    if (/^(about|intro|details|members|posts)$/i.test(span)) continue;
    // Looks like a description: 30-500 chars, contains sentence-like content
    if (/^.{30,500}$/.test(span) && /[.!?]/.test(span)) {
      return span;
    }
  }

  return null;
}

export function parseGroupVanitySlug(snapshot: GroupDomSnapshot): string | null {
  try {
    const urlObj = new URL(snapshot.url);
    const path = urlObj.pathname;
    // Match /groups/{slug}/ or /groups/{slug}
    const match = path.match(/^\/groups\/([^/]+?)(?:\/)?$/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // URL parsing failed, try regex on raw URL
    const match = snapshot.url.match(/\/groups\/([^/]+?)(?:\/|$)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}
