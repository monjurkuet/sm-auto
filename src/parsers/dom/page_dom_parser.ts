import type { PageContactInfo, SocialMediaLink } from '../../types/contracts';

export interface PageDomSnapshot {
  title: string;
  url: string;
  headings: string[];
  spans: string[];
  links: Array<{ href: string | null; text: string | null }>;
}

const LOCATION_CONTROL_LABEL = /^(address|map|directions|edit|save|cancel|see all|see more)$/i;
const LOCATION_STATUS_LABEL = /^(open now|closed now|hours|temporarily closed)$/i;
const GENERIC_UI_LABEL = /^(about|intro|contact info|basic info|details|categories|location)$/i;

function cleanFacebookTitle(title: string): string {
  return title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*\|\s*Facebook.*$/i, '')
    .trim();
}

export async function snapshotPageDom(page: import('puppeteer-core').Page): Promise<PageDomSnapshot> {
  return page.evaluate(() => {
    const text = (element: Element | null): string | null => element?.textContent?.trim() ?? null;
    return {
      title: document.title,
      url: window.location.href,
      headings: Array.from(document.querySelectorAll('h1, h2'))
        .map((el) => text(el) ?? '')
        .filter(Boolean),
      spans: Array.from(document.querySelectorAll('span'))
        .map((el) => text(el) ?? '')
        .filter(Boolean),
      links: Array.from(document.querySelectorAll('a')).map((anchor) => ({
        href: anchor.getAttribute('href'),
        text: text(anchor)
      }))
    };
  });
}

export function parseContactInfoFromDom(snapshot: PageDomSnapshot): PageContactInfo {
  const socialMedia = parseSocialMedia(snapshot);
  const socialUrls = new Set(socialMedia.map((link) => link.url));
  const info: PageContactInfo = {
    phones: [],
    emails: [],
    websites: [],
    addresses: [],
    socialMedia
  };

  const emailRegex = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/;
  const phoneRegex = /^\+?[\d\s-]{7,}$/;

  for (const link of snapshot.links) {
    if (!link.href) {
      continue;
    }
    const normalizedHref = resolveOutboundUrl(link.href);
    if (link.href.startsWith('mailto:')) {
      info.emails.push(link.href.replace(/^mailto:/, ''));
    } else if (link.href.startsWith('tel:')) {
      info.phones.push(link.href.replace(/^tel:/, ''));
    } else if (
      /^https?:\/\//.test(normalizedHref) &&
      !/facebook\.com|fb\.com/.test(normalizedHref) &&
      !socialUrls.has(normalizedHref)
    ) {
      info.websites.push(normalizedHref);
    }
  }

  // Improved phone extraction - handle patterns like "Phone\n09609-016810"
  const fullText = snapshot.spans.join('\n');
  const phoneMatch = fullText.match(/Phone[\s\n]+([\d-+]+)/);
  if (phoneMatch) {
    info.phones.push(phoneMatch[1]);
  }

  for (let index = 0; index < snapshot.spans.length; index += 1) {
    const current = snapshot.spans[index] ?? '';
    const previous = snapshot.spans[index - 1] ?? '';

    if (/^address$/i.test(current) && previous && !/^address$/i.test(previous)) {
      info.addresses.push(previous);
    }

    if (/^(mobile|phone|call)$/i.test(current) && phoneRegex.test(previous)) {
      info.phones.push(previous);
    }

    if (emailRegex.test(current)) {
      const match = current.match(emailRegex);
      if (match) {
        info.emails.push(match[0]);
      }
    }
  }

  return {
    phones: [...new Set(info.phones)],
    emails: [...new Set(info.emails)],
    websites: [...new Set(info.websites)],
    addresses: [...new Set(info.addresses)],
    socialMedia: info.socialMedia
  };
}

export function parseFollowerCount(snapshot: PageDomSnapshot): number | null {
  for (const span of snapshot.spans) {
    // Match patterns like "394K followers • 115 following" (combined format)
    const combinedMatch = span.match(/([\d,.]+[KM]?)\s+followers?\s*[•·]\s*[\d,.]+[KM]?\s+following/i);
    if (combinedMatch) {
      return parseNumber(combinedMatch[1]);
    }
    // Match standalone patterns like "394K followers" or "247 followers"
    const match = span.match(/^([\d,.]+[KM]?)\s+followers$/i);
    if (match) {
      return parseNumber(match[1]);
    }
  }
  return null;
}

function extractHandleFromUrl(url: string): string {
  try {
    const urlObj = new URL(resolveOutboundUrl(url));
    const path = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (path) {
      return path;
    }
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function resolveOutboundUrl(url: string): string {
  let resolvedUrl = url;

  try {
    const parsed = new URL(url);
    if ((parsed.hostname === 'l.facebook.com' || parsed.hostname === 'lm.facebook.com') && parsed.pathname === '/l.php') {
      resolvedUrl = parsed.searchParams.get('u') ?? url;
    }
  } catch {
    return url;
  }

  try {
    const parsedResolvedUrl = new URL(resolvedUrl);
    parsedResolvedUrl.searchParams.delete('fbclid');
    return parsedResolvedUrl.toString();
  } catch {
    return resolvedUrl;
  }
}

function detectSocialPlatform(url: string): SocialMediaLink['platform'] | null {
  const normalized = resolveOutboundUrl(url);
  if (normalized.includes('instagram.com')) return 'instagram';
  if (normalized.includes('tiktok.com')) return 'tiktok';
  if (normalized.includes('tumblr.com')) return 'tumblr';
  if (normalized.includes('pinterest.com')) return 'pinterest';
  if (normalized.includes('youtube.com')) return 'youtube';
  if (normalized.includes('x.com') || normalized.includes('twitter.com')) return 'x';
  return null;
}

export function parseSocialMedia(snapshot: PageDomSnapshot): SocialMediaLink[] {
  const socialMedia: SocialMediaLink[] = [];
  const seen = new Set<string>();

  for (const link of snapshot.links) {
    if (!link.href) {
      continue;
    }

    const platform = detectSocialPlatform(link.href);

    if (platform) {
      const normalizedUrl = resolveOutboundUrl(link.href);
      const key = `${platform}:${normalizedUrl}`;
      if (seen.has(key)) {
        continue;
      }
      const handle = extractHandleFromUrl(normalizedUrl);
      socialMedia.push({ platform, handle, url: normalizedUrl });
      seen.add(key);
    }
  }

  return socialMedia;
}

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

export function parseFollowingCount(snapshot: PageDomSnapshot): number | null {
  for (const span of snapshot.spans) {
    // Match patterns like "394K followers • 115 following" (combined format)
    const combinedMatch = span.match(/([\d,.]+[KM]?)\s+followers?\s*[•·]\s*([\d,.]+[KM]?)\s+following/i);
    if (combinedMatch) {
      return parseNumber(combinedMatch[2]);
    }
    // Match standalone patterns like "115 following"
    const match = span.match(/^([\d,.]+[KM]?)\s+following$/i);
    if (match) {
      return parseNumber(match[1]);
    }
  }
  return null;
}

export function parseBio(snapshot: PageDomSnapshot): string | null {
  // Look for longer descriptive text that looks like a bio
  // Bio text is typically a complete sentence about the business/person
  const bioPatterns = [
    // Business description pattern
    /^[A-Z][^.]+leading[^.]+\bchain\b[^.]+\./i,
    /^[A-Z][^.]+\bComputers?\b[^.]+largest[^.]+\./i,
    // General longer text
    /^.{50,300}$/
  ];

  for (const span of snapshot.spans) {
    // Skip common non-bio spans
    if (/^(followers|following|likes|people|talking about|www\.|http)/i.test(span)) continue;
    if (/^\d+[\s,]*(followers|following|likes|people)/i.test(span)) continue;
    if (/^\d+K$/.test(span)) continue;

    // Skip transparency UI messages
    if (span.includes('The number of followers includes')) continue;
    if (span.includes("You'll see names")) continue;

    // Test against patterns
    for (const pattern of bioPatterns) {
      if (pattern.test(span)) {
        return span;
      }
    }
  }
  return null;
}

function looksLikeLocationValue(value: string): boolean {
  if (!value || LOCATION_CONTROL_LABEL.test(value) || LOCATION_STATUS_LABEL.test(value) || GENERIC_UI_LABEL.test(value)) {
    return false;
  }

  if (/https?:\/\/|www\.|@/i.test(value)) {
    return false;
  }

  if (/followers?\b|following\b/i.test(value) || /^\d+[\s,]*(likes|people|reviews?)\b/i.test(value)) {
    return false;
  }

  if (!/\p{L}/u.test(value)) {
    return false;
  }

  const separatorCount = (value.match(/\s[·•]\s/g) ?? []).length;
  const wordCount = value.trim().split(/\s+/).length;
  const narrativeWordCount = (
    value.match(/\b(with|for|your|our|their|offers?|help|find|ideal|solution|leading|largest|available|upgrade|browse|support|connected)\b/gi) ?? []
  ).length;

  if (/[.!?]/.test(value) && separatorCount === 0) {
    return false;
  }

  if (wordCount > 14 && separatorCount === 0 && !/\d+\s+\p{L}/u.test(value)) {
    return false;
  }

  if (narrativeWordCount >= 2 && separatorCount === 0) {
    return false;
  }

  return value.includes(',') || value.includes('·') || /\d+\s+\p{L}/u.test(value);
}

function normalizeLocationValue(value: string): string {
  return value.split(' · ')[0]?.trim() ?? value.trim();
}

function scoreLocationCandidate(value: string): number {
  const separatorCount = (value.match(/\s[·•]\s/g) ?? []).length;
  const commaCount = (value.match(/,/g) ?? []).length;
  const wordCount = value.trim().split(/\s+/).length;

  let score = separatorCount * 5 + Math.min(commaCount, 4);

  if (/\d+\s+\p{L}/u.test(value)) {
    score += 2;
  }

  if (wordCount <= 8) {
    score += 1;
  }

  return score;
}

export function parseLocation(snapshot: PageDomSnapshot): string | null {
  for (let index = 0; index < snapshot.spans.length; index += 1) {
    const current = snapshot.spans[index] ?? '';
    if (/^location$/i.test(current)) {
      for (let candidateIndex = index + 1; candidateIndex < snapshot.spans.length; candidateIndex += 1) {
        const candidate = snapshot.spans[candidateIndex] ?? '';
        if (!candidate) {
          continue;
        }
        if (looksLikeLocationValue(candidate)) {
          return normalizeLocationValue(candidate);
        }
        if (GENERIC_UI_LABEL.test(candidate)) {
          break;
        }
      }
    }
  }

  let bestCandidate: string | null = null;
  let bestScore = -1;

  for (const span of snapshot.spans) {
    if (looksLikeLocationValue(span)) {
      const normalized = normalizeLocationValue(span);
      const score = scoreLocationCandidate(normalized);
      if (score > bestScore) {
        bestCandidate = normalized;
        bestScore = score;
      }
    }
  }

  return bestCandidate;
}

export function parseCategory(snapshot: PageDomSnapshot): string | null {
  for (const span of snapshot.spans) {
    const pageCategoryMatch = span.match(/^Page\s*[·•]\s*(.+)$/i);
    if (pageCategoryMatch?.[1]) {
      return pageCategoryMatch[1].trim();
    }
  }

  for (let index = 0; index < snapshot.spans.length; index += 1) {
    if (/^categories$/i.test(snapshot.spans[index] ?? '')) {
      const next = snapshot.spans[index + 1] ?? '';
      if (next && !/^(contact info|basic info|about)$/i.test(next)) {
        return next;
      }
    }
  }

  return null;
}

export function parsePageName(snapshot: PageDomSnapshot): string | null {
  const heading = snapshot.headings.find((value) => {
    return !/^(notifications|new|earlier|marketplace|about|intro|contact info|basic info|categories|details|seller information|today's picks)$/i.test(
      value
    );
  });

  if (heading) {
    return heading;
  }

  const title = cleanFacebookTitle(snapshot.title);
  if (title && !/^(notifications|facebook)$/i.test(title)) {
    return title;
  }

  return null;
}

export function parseLabeledValue(snapshot: PageDomSnapshot, labelPattern: RegExp): string | null {
  for (let index = 1; index < snapshot.spans.length; index += 1) {
    if (labelPattern.test(snapshot.spans[index] ?? '')) {
      return snapshot.spans[index - 1] ?? null;
    }
  }

  return null;
}

export function parseCreationDate(snapshot: PageDomSnapshot): string | null {
  const labeledValue =
    parseLabeledValue(snapshot, /^page created$/i) ??
    parseLabeledValue(snapshot, /^created$/i) ??
    parseLabeledValue(snapshot, /^creation date$/i);

  if (labeledValue) {
    return labeledValue;
  }

  for (const span of snapshot.spans) {
    const inlineMatch = span.match(/^(?:page created|created|creation date)\s*[:-]?\s*(.+)$/i);
    if (inlineMatch?.[1]) {
      return inlineMatch[1].trim();
    }
  }

  return null;
}
