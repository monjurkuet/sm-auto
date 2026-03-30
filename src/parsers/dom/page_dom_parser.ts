import type { PageContactInfo, SocialMediaLink } from '../../types/contracts';

export interface PageDomSnapshot {
  title: string;
  url: string;
  headings: string[];
  spans: string[];
  links: Array<{ href: string | null; text: string | null }>;
}

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
  const info: PageContactInfo = {
    phones: [],
    emails: [],
    websites: [],
    addresses: [],
    socialMedia: parseSocialMedia(snapshot)
  };

  const emailRegex = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/;
  const phoneRegex = /^\+?[\d\s-]{7,}$/;

  for (const link of snapshot.links) {
    if (!link.href) {
      continue;
    }
    if (link.href.startsWith('mailto:')) {
      info.emails.push(link.href.replace(/^mailto:/, ''));
    } else if (link.href.startsWith('tel:')) {
      info.phones.push(link.href.replace(/^tel:/, ''));
    } else if (/^https?:\/\//.test(link.href) && !/facebook\.com|fb\.com/.test(link.href)) {
      info.websites.push(link.href);
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
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (path) {
      return path;
    }
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function parseSocialMedia(snapshot: PageDomSnapshot): SocialMediaLink[] {
  const socialMedia: SocialMediaLink[] = [];
  const seen = new Set<string>();

  for (const link of snapshot.links) {
    if (!link.href) continue;

    let platform: SocialMediaLink['platform'] | null = null;

    if (link.href.includes('instagram.com')) platform = 'instagram';
    else if (link.href.includes('tiktok.com')) platform = 'tiktok';
    else if (link.href.includes('tumblr.com')) platform = 'tumblr';
    else if (link.href.includes('pinterest.com')) platform = 'pinterest';
    else if (link.href.includes('youtube.com')) platform = 'youtube';
    else if (link.href.includes('x.com') || link.href.includes('twitter.com')) platform = 'x';

    if (platform && !seen.has(platform)) {
      const handle = extractHandleFromUrl(link.href);
      socialMedia.push({ platform, handle, url: link.href });
      seen.add(platform);
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

export function parseLocation(snapshot: PageDomSnapshot): string | null {
  // Look for location label and value in About page
  for (let index = 0; index < snapshot.spans.length; index += 1) {
    const current = snapshot.spans[index] ?? '';
    // Match "location" label followed by actual location
    if (/^location$/i.test(current)) {
      const next = snapshot.spans[index + 1] ?? '';
      // Skip if next is empty or is a UI label
      if (next && !/^(address|map|directions|edit|save|cancel)$/i.test(next)) {
        // Only accept if it looks like a location (contains city name or country)
        if (
          /^(dhaka|chittagong|chattogram|bangladesh|bangladesh|BD|banani|gulshan|dhanmondi|uttara)/i.test(next) ||
          /Bangladesh/i.test(next)
        ) {
          return next;
        }
      }
    }
  }

  // Alternative: look for Dhaka, Bangladesh patterns
  for (const span of snapshot.spans) {
    if (/^(dhaka|chittagong|bangladesh)$/i.test(span) || /Bangladesh,?\s*Bangladesh/i.test(span)) {
      return span;
    }
    // Match "Dhaka, Bangladesh" format
    const match = span.match(/^([A-Za-z\s]+),\s*(Bangladesh)$/);
    if (match) {
      return span;
    }
  }

  return null;
}

export function parseCategory(snapshot: PageDomSnapshot): string | null {
  for (let index = 0; index < snapshot.spans.length; index += 1) {
    if (/^categories$/i.test(snapshot.spans[index] ?? '')) {
      const next = snapshot.spans[index + 1] ?? '';
      if (next && !/^(contact info|basic info|about)$/i.test(next)) {
        return next;
      }
    }
  }

  return (
    snapshot.headings.find((heading) => !/^(about|intro|contact info|basic info|categories)$/i.test(heading)) ?? null
  );
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
