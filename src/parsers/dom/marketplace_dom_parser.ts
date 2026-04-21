import type { MarketplaceListing } from '../../types/contracts';

function uniqueImages(
  images: Array<{ url: string | null; width?: number; height?: number }>
): Array<{ url: string | null; width?: number; height?: number }> {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (!image.url || seen.has(image.url)) {
      return false;
    }
    if (image.url.includes('static.xx.fbcdn.net')) {
      return false;
    }
    if ((image.width ?? 0) > 0 && (image.width ?? 0) < 300) {
      return false;
    }
    seen.add(image.url);
    return true;
  });
}

interface MarketplaceListingDomSnapshot {
  title: string | null;
  searchTexts: string[];
  descriptionTexts: string[];
  sellerHref: string | null;
  sellerName: string | null;
  images: Array<{ url: string | null; width?: number; height?: number }>;
}

const MARKETPLACE_PRICE_PATTERN = /^(BDT\s?[\d,]+|\$\s?[\d,]+|FREE)$/i;

function inferMarketplaceCurrency(formattedAmount: string | null): string | null {
  if (!formattedAmount) {
    return null;
  }

  if (formattedAmount.startsWith('$')) {
    return 'USD';
  }
  if (/^BDT/i.test(formattedAmount) || formattedAmount.includes('৳')) {
    return 'BDT';
  }

  return null;
}

function parseMarketplacePriceAmount(formattedAmount: string | null): number | null {
  if (!formattedAmount || /^FREE$/i.test(formattedAmount)) {
    return null;
  }

  const numericPortion = formattedAmount.match(/([\d,.]+)/)?.[1] ?? null;
  if (!numericPortion) {
    return null;
  }

  const parsed = Number(numericPortion.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMarketplaceListingLocationText(
  searchTexts: string[],
  title: string | null,
  priceText: string | null
): string | null {
  const listedInText = searchTexts.find((value) => /^Listed .* in /i.test(value));
  if (listedInText) {
    return listedInText.replace(/^Listed .* in /i, '').trim() || null;
  }

  const priceIndex = priceText ? searchTexts.findIndex((value) => value === priceText) : -1;
  const searchTail = priceIndex >= 0 ? searchTexts.slice(priceIndex + 1) : searchTexts;
  const locationCandidates = searchTail.filter(
    (value) =>
      value !== title &&
      value !== priceText &&
      !/^(Send|Message|Save|Share|Sponsored|Details|Seller information|Today's picks|a day ago|today|yesterday)$/i.test(
        value
      )
  );

  return (
    locationCandidates.find((value) => /,\s*(Bangladesh|বাংলাদেশ)$/i.test(value)) ??
    locationCandidates.find((value) => /^[A-Za-z\u0980-\u09FF][A-Za-z\u0980-\u09FF .,'-]{1,80}$/u.test(value)) ??
    null
  );
}

function selectMarketplaceListingDescription(
  descriptionTexts: string[],
  title: string | null,
  priceText: string | null,
  locationText: string | null
): string | null {
  const candidates = uniqueText(descriptionTexts)
    .filter(
      (value) =>
        value.length > 40 &&
        value !== title &&
        value !== priceText &&
        value !== locationText &&
        !/^Today's picks/i.test(value) &&
        !/^Listed .* in /i.test(value)
    )
    .sort((left, right) => right.length - left.length);

  return candidates[0] ?? null;
}

export function normalizeMarketplaceListingDomSnapshot(
  listingId: string,
  snapshot: MarketplaceListingDomSnapshot
): MarketplaceListing {
  const title = snapshot.title?.trim() || null;
  const searchTexts = uniqueText(snapshot.searchTexts.map((value) => value.trim()).filter(Boolean));
  const priceText = extractMarketplacePriceText(searchTexts, searchTexts.join(' '));
  const fullLocation = extractMarketplaceListingLocationText(searchTexts, title, priceText);

  return {
    id: listingId,
    title,
    description: selectMarketplaceListingDescription(snapshot.descriptionTexts, title, priceText, fullLocation),
    price: {
      amount: parseMarketplacePriceAmount(priceText),
      currency: inferMarketplaceCurrency(priceText),
      formatted: priceText
    },
    seller: {
      id:
        snapshot.sellerHref?.match(/\/marketplace\/profile\/(\d+)/)?.[1] ??
        snapshot.sellerHref?.match(/id=(\d+)/)?.[1] ??
        null,
      name: snapshot.sellerName?.trim() || null
    },
    location: {
      city: fullLocation?.split(',')[0]?.trim() ?? null,
      fullLocation
    },
    images: uniqueImages(snapshot.images),
    availability: null,
    categoryId: null,
    deliveryOptions: []
  };
}

export async function parseMarketplaceListingFromDom(
  page: import('puppeteer-core').Page,
  listingId: string
): Promise<MarketplaceListing> {
  const snapshot = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const spans = Array.from(document.querySelectorAll('span'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const detailHeading =
      headings.find(
        (value) => !/^(Notifications|New|Earlier|Marketplace|Details|Seller information|Today's picks)$/i.test(value)
      ) ?? null;
    const documentTitle = document.title
      .replace(/^\(\d+\)\s*/, '')
      .replace(/^Marketplace\s+[–-]\s*/i, '')
      .replace(/\s*\|\s*Facebook.*$/i, '')
      .trim();
    const title = detailHeading || documentTitle || null;
    const titleIndex = title ? spans.findIndex((value) => value === title) : -1;
    const searchWindow = titleIndex >= 0 ? spans.slice(titleIndex, titleIndex + 8) : spans.slice(0, 20);
    const listedInText = spans.find((value) => /^Listed .* in /i.test(value));
    const locationText = spans.find((value) => /, বাংলাদেশ|, Bangladesh|ঢাকা, বাংলাদেশ|Dhaka, Bangladesh/.test(value));
    const descriptionCandidates = spans.filter((value) => value.length > 80 && !/^Today's picks/i.test(value));
    const sellerLinks = Array.from(
      document.querySelectorAll('a[href*="/marketplace/profile/"]')
    ) as HTMLAnchorElement[];
    const sellerLink =
      sellerLinks.find((link) => (link.textContent ?? '').trim() && !/seller details/i.test(link.textContent ?? '')) ??
      sellerLinks[0] ??
      null;

    return {
      title,
      searchTexts: [
        ...searchWindow,
        ...spans.filter((value) => value === listedInText || value === locationText)
      ].filter(Boolean),
      descriptionTexts: descriptionCandidates,
      sellerHref: sellerLink?.getAttribute('href') ?? null,
      sellerName: (sellerLink?.textContent ?? '').trim() || null,
      images: Array.from(document.querySelectorAll('img'))
        .slice(0, 20)
        .map((img) => ({
          url: img.getAttribute('src'),
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined
        }))
    };
  });

  return normalizeMarketplaceListingDomSnapshot(listingId, snapshot);
}

export interface MarketplaceSellerDomProfile {
  seller: {
    id: string | null;
    name: string | null;
    about: string | null;
    rating: number | null;
    reviewCount: number | null;
    location: string | null;
    memberSince: string | number | null;
  };
  listings: MarketplaceListing[];
}

interface MarketplaceSellerListingCard {
  href: string | null;
  text: string | null;
  spanTexts: string[];
}

function uniqueText(values: string[]): string[] {
  return values.filter((entry, index, all) => all.indexOf(entry) === index);
}

function extractMarketplaceItemId(href: string | null): string | null {
  if (!href) {
    return null;
  }

  return href.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
}

function extractMarketplaceLinkRef(href: string | null): string | null {
  if (!href) {
    return null;
  }

  try {
    return new URL(href, 'https://www.facebook.com').searchParams.get('ref');
  } catch {
    return href.match(/[?&]ref=([^&]+)/)?.[1] ?? null;
  }
}

function extractMarketplacePriceText(texts: string[], fallbackText: string): string | null {
  return (
    texts.find((entry) => MARKETPLACE_PRICE_PATTERN.test(entry)) ??
    fallbackText.match(/(BDT\s?[\d,]+|\$\s?[\d,]+|FREE)/i)?.[1] ??
    null
  );
}

export function extractMarketplaceSellerLocationText(values: string[], sellerName: string | null): string | null {
  return (
    [...values].reverse().find((value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === sellerName) {
        return false;
      }

      if (
        /^Joined Facebook in /i.test(trimmed) ||
        /responsive|seller details|message|send|save|share|today's picks|marketplace/i.test(trimmed) ||
        /^\d+(\.\d+)?\s+\(\d+\)$/.test(trimmed) ||
        /\breviews?\b/i.test(trimmed) ||
        MARKETPLACE_PRICE_PATTERN.test(trimmed)
      ) {
        return false;
      }

      if (!/\p{L}/u.test(trimmed)) {
        return false;
      }

      if (trimmed.includes(',')) {
        return true;
      }

      return /^[\p{L}\s.'-]{2,60}$/u.test(trimmed) && trimmed.split(/\s+/).length <= 4;
    }) ?? null
  );
}

function normalizeMarketplaceSellerListingCard(
  card: MarketplaceSellerListingCard,
  sellerId: string,
  sellerName: string | null
): MarketplaceListing | null {
  const listingId = extractMarketplaceItemId(card.href);
  if (!listingId) {
    return null;
  }

  const normalizedText = (card.text ?? '').trim().replace(/\s+/g, ' ');
  const normalizedSpans = uniqueText(card.spanTexts.map((entry) => entry.trim()).filter(Boolean));
  const priceText = extractMarketplacePriceText(normalizedSpans, normalizedText);
  const visibleTexts = normalizedSpans.filter((entry) => entry !== priceText && !/^Just listed$/i.test(entry));
  const title =
    visibleTexts[0] ??
    (normalizedText
      .replace(/^Just listed/i, '')
      .replace(/(BDT\s?[\d,]+|\$\s?[\d,]+|FREE)/i, '')
      .trim() ||
      null);
  const fullLocation = visibleTexts.length > 1 ? (visibleTexts[visibleTexts.length - 1] ?? null) : null;

  return {
    id: listingId,
    title,
    description: null,
    price: {
      amount: null,
      currency: priceText?.startsWith('$') ? 'USD' : priceText ? 'BDT' : null,
      formatted: priceText
    },
    seller: {
      id: sellerId,
      name: sellerName
    },
    location: {
      city: fullLocation?.split(',')[0]?.trim() ?? null,
      fullLocation
    },
    images: [],
    availability: null,
    categoryId: null,
    deliveryOptions: []
  };
}

function scoreMarketplaceSellerListing(listing: MarketplaceListing, href: string | null): number {
  let score = 0;
  if (extractMarketplaceLinkRef(href) === 'marketplace_profile') score += 10;
  if (listing.title) score += 3;
  if (listing.location.fullLocation) score += 2;
  if (listing.price.formatted) score += 1;
  return score;
}

export function normalizeMarketplaceSellerListingCards(
  cards: MarketplaceSellerListingCard[],
  sellerId: string,
  sellerName: string | null
): MarketplaceListing[] {
  const normalizedCards = cards
    .map((card) => ({
      href: card.href,
      ref: extractMarketplaceLinkRef(card.href),
      listing: normalizeMarketplaceSellerListingCard(card, sellerId, sellerName)
    }))
    .filter((entry): entry is { href: string | null; ref: string | null; listing: MarketplaceListing } =>
      Boolean(entry.listing)
    );

  const preferredCards = normalizedCards.some((entry) => entry.ref === 'marketplace_profile')
    ? normalizedCards.filter((entry) => entry.ref === 'marketplace_profile')
    : normalizedCards;

  const listings = new Map<string, { listing: MarketplaceListing; score: number }>();
  for (const entry of preferredCards) {
    const listingId = entry.listing.id;
    if (!listingId) {
      continue;
    }

    const score = scoreMarketplaceSellerListing(entry.listing, entry.href);
    const current = listings.get(listingId);
    if (!current || score >= current.score) {
      listings.set(listingId, { listing: entry.listing, score });
    }
  }

  return [...listings.values()].map((entry) => entry.listing);
}

export async function parseMarketplaceSellerFromDom(
  page: import('puppeteer-core').Page,
  sellerId: string
): Promise<MarketplaceSellerDomProfile> {
  const result = await page.evaluate((id) => {
    const spans = Array.from(document.querySelectorAll('span'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const memberIndex = spans.findIndex((value) => /^Joined Facebook in /i.test(value));
    const name = memberIndex > 0 ? (spans[memberIndex - 1] ?? null) : null;
    const memberSince = memberIndex >= 0 ? spans[memberIndex] : null;
    const responsive = spans.find((value) => /responsive/i.test(value)) ?? null;
    const sellerContext =
      memberIndex >= 0 ? spans.slice(Math.max(0, memberIndex - 12), memberIndex + 6) : spans.slice(0, 20);
    const ratingText = sellerContext.find((value) => /^\d+(\.\d+)?\s+\(\d+\)$/.test(value)) ?? null;
    const reviewCountMatch = ratingText?.match(/\((\d+)\)/) ?? spans.join(' ').match(/\((\d+)\)/);
    const ratingMatch = ratingText?.match(/^(\d+(?:\.\d+)?)/);
    const listingLinks = links.filter((link) => link.href.includes('/marketplace/item/')).slice(0, 40);

    return {
      seller: {
        id,
        name,
        about: responsive,
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        reviewCount: reviewCountMatch ? Number(reviewCountMatch[1]) : null,
        memberSince
      },
      sellerContext,
      listingCards: listingLinks.map((link) => ({
        href: link.getAttribute('href'),
        text: (link.textContent ?? '').trim().replace(/\s+/g, ' '),
        spanTexts: Array.from(link.querySelectorAll('span'))
          .map((element) => element.textContent?.trim() ?? '')
          .filter(Boolean)
      }))
    };
  }, sellerId);

  return {
    seller: {
      ...result.seller,
      location: extractMarketplaceSellerLocationText(result.sellerContext, result.seller.name)
    },
    listings: normalizeMarketplaceSellerListingCards(result.listingCards, sellerId, result.seller.name)
  };
}
