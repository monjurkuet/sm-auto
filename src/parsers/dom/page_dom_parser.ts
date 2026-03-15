import type { PageContactInfo } from '../../types/contracts';

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
      headings: Array.from(document.querySelectorAll('h1, h2')).map((el) => text(el) ?? '').filter(Boolean),
      spans: Array.from(document.querySelectorAll('span')).map((el) => text(el) ?? '').filter(Boolean),
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
    addresses: []
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
    addresses: [...new Set(info.addresses)]
  };
}

export function parseFollowerCount(snapshot: PageDomSnapshot): number | null {
  for (const span of snapshot.spans) {
    const match = span.match(/([\d,.]+)\s+followers/i);
    if (match) {
      return Number(match[1].replace(/,/g, ''));
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

  return snapshot.headings.find((heading) => !/^(about|intro|contact info|basic info|categories)$/i.test(heading)) ?? null;
}

export function parsePageName(snapshot: PageDomSnapshot): string | null {
  const heading = snapshot.headings.find((value) => {
    return !/^(notifications|new|earlier|marketplace|about|intro|contact info|basic info|categories|details|seller information|today's picks)$/i.test(value);
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
