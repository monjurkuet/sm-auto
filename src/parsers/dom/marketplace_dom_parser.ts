import type { MarketplaceListing } from '../../types/contracts';

function uniqueImages(images: Array<{ url: string | null; width?: number; height?: number }>): Array<{ url: string | null; width?: number; height?: number }> {
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

export async function parseMarketplaceListingFromDom(page: import('puppeteer-core').Page, listingId: string): Promise<MarketplaceListing> {
  const result = await page.evaluate((id) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const spans = Array.from(document.querySelectorAll('span'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const detailHeading =
      headings.find((value) => !/^(Notifications|New|Earlier|Marketplace|Details|Seller information|Today's picks)$/i.test(value)) ?? null;
    const documentTitle = document.title
      .replace(/^\(\d+\)\s*/, '')
      .replace(/^Marketplace\s+[–-]\s*/i, '')
      .replace(/\s*\|\s*Facebook.*$/i, '')
      .trim();
    const title = detailHeading || documentTitle || null;
    const titleIndex = title ? spans.findIndex((value) => value === title) : -1;
    const searchWindow = titleIndex >= 0 ? spans.slice(titleIndex, titleIndex + 8) : spans.slice(0, 20);
    const priceText = searchWindow.find((value) => /^(BDT[\d,]+|\$[\d,]+|BDT0|FREE)$/i.test(value)) ?? null;
    const listedInText = spans.find((value) => /^Listed .* in /i.test(value));
    const locationText = spans.find((value) => /, বাংলাদেশ|, Bangladesh|ঢাকা, বাংলাদেশ|Dhaka, Bangladesh/.test(value));
    const descriptionCandidates = spans.filter((value) => value.length > 80 && !/^Today's picks/i.test(value));
    const sellerLinks = Array.from(document.querySelectorAll('a[href*="/marketplace/profile/"]')) as HTMLAnchorElement[];
    const sellerLink =
      sellerLinks.find((link) => (link.textContent ?? '').trim() && !/seller details/i.test(link.textContent ?? '')) ??
      sellerLinks[0] ??
      null;

    return {
      id,
      title,
      description: descriptionCandidates.sort((left, right) => right.length - left.length)[0] ?? null,
      price: {
        amount: null,
        currency: priceText?.startsWith('$') ? 'USD' : priceText?.startsWith('BDT') ? 'BDT' : null,
        formatted: priceText
      },
      seller: {
        id: sellerLink?.href.match(/\/marketplace\/profile\/(\d+)/)?.[1] ?? sellerLink?.href.match(/id=(\d+)/)?.[1] ?? null,
        name: (sellerLink?.textContent ?? '').trim() || null
      },
      location: {
        city: locationText?.split(',')[0] ?? null,
        fullLocation: listedInText?.replace(/^Listed .* in /i, '') ?? locationText ?? null
      },
      images: Array.from(document.querySelectorAll('img')).slice(0, 20).map((img) => ({
        url: img.getAttribute('src'),
        width: img.naturalWidth || undefined,
        height: img.naturalHeight || undefined
      })),
      availability: null,
      categoryId: null,
      deliveryOptions: []
    };
  }, listingId);

  return {
    ...result,
    images: uniqueImages(result.images)
  };
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

export async function parseMarketplaceSellerFromDom(
  page: import('puppeteer-core').Page,
  sellerId: string
): Promise<MarketplaceSellerDomProfile> {
  return page.evaluate((id) => {
    const spans = Array.from(document.querySelectorAll('span'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(Boolean);
    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const memberIndex = spans.findIndex((value) => /^Joined Facebook in /i.test(value));
    const name = memberIndex > 0 ? spans[memberIndex - 1] ?? null : null;
    const memberSince = memberIndex >= 0 ? spans[memberIndex] : null;
    const responsive = spans.find((value) => /responsive/i.test(value)) ?? null;
    const sellerContext = memberIndex >= 0 ? spans.slice(Math.max(0, memberIndex - 12), memberIndex + 6) : spans.slice(0, 20);
    const ratingText = sellerContext.find((value) => /^\d+(\.\d+)?\s+\(\d+\)$/.test(value)) ?? null;
    const reviewCountMatch = ratingText?.match(/\((\d+)\)/) ?? spans.join(' ').match(/\((\d+)\)/);
    const ratingMatch = ratingText?.match(/^(\d+(?:\.\d+)?)/);
    const location = [...sellerContext].reverse().find((value) => /,\s*(Bangladesh|বাংলাদেশ)$/i.test(value)) ?? null;
    const listingLinks = links.filter((link) => link.href.includes('/marketplace/item/'));

    const listings: MarketplaceListing[] = listingLinks.slice(0, 20).map((link) => {
      const value = (link.textContent ?? '').trim();
      const spanTexts = Array.from(link.querySelectorAll('span'))
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean)
        .filter((entry, index, all) => all.indexOf(entry) === index);
      const normalizedValue = value.replace(/^Just listed/i, '').trim();
      const priceText =
        spanTexts.find((entry) => /^(BDT[\d,]+|\$[\d,]+|FREE)$/i.test(entry)) ??
        normalizedValue.match(/^(BDT[\d,]+|\$[\d,]+|FREE)/i)?.[1] ??
        null;
      const priceMatch = priceText?.match(/^(BDT[\d,]+|\$[\d,]+|FREE)$/i) ?? null;
      const idMatch = link.href.match(/\/marketplace\/item\/(\d+)/);
      const locationText =
        spanTexts.find((entry) => /,\s*(Bangladesh|বাংলাদেশ)$/i.test(entry)) ??
        null;
      const title =
        spanTexts.find((entry) => entry !== priceText && entry !== locationText && !/^Just listed$/i.test(entry)) ??
        normalizedValue
          .replace(/^Just listed/i, '')
          .replace(/^(BDT[\d,]+|\$[\d,]+|FREE)/i, '')
          .replace(/([A-Za-z\u0980-\u09FF .'-]+,\s*(?:Bangladesh|বাংলাদেশ))$/i, '')
          .trim();
      return {
        id: idMatch?.[1] ?? null,
        title: title || null,
        description: null,
        price: {
          amount: null,
          currency: priceMatch?.[1]?.startsWith('$') ? 'USD' : priceMatch?.[1] ? 'BDT' : null,
          formatted: priceMatch?.[1] ?? priceText
        },
        seller: {
          id,
          name
        },
        location: {
          city: locationText?.split(',')[0]?.trim() ?? null,
          fullLocation: locationText
        },
        images: [],
        availability: null,
        categoryId: null,
        deliveryOptions: []
      };
    });

    return {
      seller: {
        id,
        name,
        about: responsive,
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        reviewCount: reviewCountMatch ? Number(reviewCountMatch[1]) : null,
        location,
        memberSince
      },
      listings
    };
  }, sellerId);
}
