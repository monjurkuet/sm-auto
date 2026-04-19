import type { GraphQLFragment, MarketplaceListing, MarketplaceSellerResult } from '../../types/contracts';
import { asRecord, deepVisit, getNumber, getString } from './shared_graphql_utils';

function inferCurrency(formattedAmount: string | null): string | null {
  if (!formattedAmount) {
    return null;
  }

  const codeMatch = formattedAmount.match(/(^|[^\p{L}])([A-Z]{3})(?=[\d\s.,]|$)/u);
  if (codeMatch) {
    return codeMatch[2];
  }

  if (formattedAmount.includes('৳')) return 'BDT';
  if (formattedAmount.includes('$')) return 'USD';
  if (formattedAmount.includes('₹')) return 'INR';
  if (formattedAmount.includes('€')) return 'EUR';
  if (formattedAmount.includes('£')) return 'GBP';

  return null;
}

function resolveAvailability(node: Record<string, unknown>): string {
  if (node.is_sold === true) {
    return 'sold';
  }
  if (node.is_pending === true) {
    return 'pending';
  }
  if (node.is_live === false) {
    return 'unavailable';
  }
  return 'available';
}

function extractPrice(node: Record<string, unknown>): MarketplaceListing['price'] {
  const priceNode = asRecord(node.listing_price) ?? asRecord(node.formatted_price) ?? {};
  const formatted =
    getString(priceNode.formatted_amount) ??
    getString(priceNode.formatted_amount_zeros_stripped) ??
    getString(priceNode.text);

  return {
    amount: getNumber(priceNode.amount),
    currency: getString(priceNode.currency_code) ?? getString(priceNode.currency) ?? inferCurrency(formatted),
    formatted
  };
}

function extractLocation(node: Record<string, unknown>): MarketplaceListing['location'] {
  const locationNode = asRecord(node.location) ?? {};
  const reverseGeocode = asRecord(locationNode.reverse_geocode) ?? {};
  const cityPage = asRecord(reverseGeocode.city_page) ?? {};
  const itemLocation = asRecord(node.item_location) ?? {};

  return {
    city: getString(reverseGeocode.city) ?? getString(itemLocation.city_text),
    fullLocation:
      getString(cityPage.display_name) ??
      getString(node.location_text) ??
      getString(itemLocation.city_text) ??
      getString(reverseGeocode.city),
    coordinates: locationNode.coordinates ?? itemLocation.coordinates ?? undefined
  };
}

function extractImages(node: Record<string, unknown>): MarketplaceListing['images'] {
  const images: MarketplaceListing['images'] = [];
  const primaryImage = asRecord(asRecord(node.primary_listing_photo)?.image);
  if (primaryImage) {
    images.push({
      url: getString(primaryImage.uri),
      width: getNumber(primaryImage.width) ?? undefined,
      height: getNumber(primaryImage.height) ?? undefined
    });
  }

  const listingPhotos = Array.isArray(node.listing_photos) ? node.listing_photos : [];
  for (const photo of listingPhotos) {
    const image = asRecord(asRecord(photo)?.image);
    if (!image) {
      continue;
    }
    images.push({
      url: getString(image.uri),
      width: getNumber(image.width) ?? undefined,
      height: getNumber(image.height) ?? undefined
    });
  }

  const media = Array.isArray(node.media) ? node.media : [];
  for (const entry of media) {
    const image = asRecord(asRecord(entry)?.image);
    if (!image) {
      continue;
    }
    images.push({
      url: getString(image.uri) ?? getString(asRecord(entry)?.uri),
      width: getNumber(image.width) ?? undefined,
      height: getNumber(image.height) ?? undefined
    });
  }

  return images.filter((entry, index, all) => {
    return Boolean(entry.url) && index === all.findIndex((candidate) => candidate.url === entry.url);
  });
}

function extractSeller(node: Record<string, unknown>): MarketplaceListing['seller'] {
  const sellerNode =
    asRecord(node.marketplace_listing_seller) ??
    asRecord(node.seller) ??
    asRecord(asRecord(node.product_item)?.marketplace_listing_seller) ??
    {};

  return {
    id: getString(sellerNode.id) ?? getString(sellerNode.user_id),
    name: getString(sellerNode.name)
  };
}

function normalizeListing(node: Record<string, unknown>): MarketplaceListing {
  return {
    id: getString(node.id),
    title: getString(node.marketplace_listing_title) ?? getString(node.base_marketplace_listing_title),
    description:
      getString(node.description) ??
      getString(asRecord(node.redacted_description)?.text) ??
      getString(node.custom_title) ??
      getString(node.marketplace_listing_title) ??
      getString(node.base_marketplace_listing_title),
    price: extractPrice(node),
    seller: extractSeller(node),
    location: extractLocation(node),
    images: extractImages(node),
    availability: resolveAvailability(node),
    categoryId: getString(node.marketplace_listing_category_id),
    deliveryOptions: Array.isArray(node.delivery_types)
      ? node.delivery_types.filter((value): value is string => typeof value === 'string')
      : []
  };
}

function scoreListing(listing: MarketplaceListing): number {
  let score = 0;
  if (listing.title) score += 6;
  if (listing.description) score += 2;
  if (listing.price.formatted) score += 4;
  if (listing.price.amount !== null) score += 3;
  if (listing.price.currency) score += 2;
  if (listing.seller.id || listing.seller.name) score += 4;
  if (listing.location.fullLocation) score += 3;
  if (listing.location.city) score += 1;
  if (listing.categoryId) score += 1;
  score += listing.images.length * 2;
  score += listing.deliveryOptions.length;
  return score;
}

function addScoredListing(
  listings: Map<string, MarketplaceListing>,
  node: Record<string, unknown>,
  force = false
): void {
  if (!force && node.__typename !== 'GroupCommerceProductItem') {
    return;
  }

  const listing = normalizeListing(node);
  if (!listing.id) {
    return;
  }

  const existing = listings.get(listing.id);
  const existingScore = existing ? scoreListing(existing) : -1;
  const candidateScore = scoreListing(listing);
  if (candidateScore >= existingScore) {
    listings.set(listing.id, listing);
  }
}

function isMarketplaceSearchScopedPayload(fragment: GraphQLFragment, payload: unknown): boolean {
  if (fragment.request.friendlyName && /MarketplaceSearch/i.test(fragment.request.friendlyName)) {
    return true;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  const root = asRecord(payload) ?? {};
  const path = Array.isArray(root.path) ? root.path : [];
  return path.some((segment) => segment === 'marketplace_search');
}

function normalizeSellerNode(
  node: Record<string, unknown>,
  fallbackSellerId: string
): MarketplaceSellerResult['seller'] {
  const ratingNode = asRecord(node.rating) ?? {};
  const ratingStats = asRecord(asRecord(node.marketplace_ratings_stats_by_role_v2)?.seller_stats) ?? {};
  const ratingCombined = asRecord(asRecord(node.marketplace_ratings_stats_by_role_v2)?.seller_buyer_combined) ?? {};
  const locationNode = asRecord(node.location) ?? {};
  const rawRating =
    getNumber(ratingNode.average_rating) ??
    getNumber(ratingStats.five_star_ratings_average) ??
    getNumber(ratingCombined.five_star_ratings_average);
  const rawReviewCount =
    getNumber(ratingNode.review_count) ??
    getNumber(ratingStats.five_star_total_rating_count_by_role) ??
    getNumber(ratingCombined.five_star_total_rating_count_by_role);

  return {
    id: getString(node.id) ?? getString(node.user_id) ?? fallbackSellerId,
    name: getString(node.name),
    about: getString(node.about),
    rating: rawRating && rawRating > 0 ? rawRating : null,
    reviewCount: rawReviewCount && rawReviewCount > 0 ? rawReviewCount : null,
    location: getString(locationNode.name),
    memberSince: getString(node.created_time) ?? getNumber(node.created_time) ?? getNumber(node.join_time)
  };
}

function scoreSellerProfile(seller: MarketplaceSellerResult['seller']): number {
  let score = 0;
  if (seller.name) score += 3;
  if (seller.about) score += 1;
  if (seller.rating !== null) score += 2;
  if (seller.reviewCount !== null) score += 2;
  if (seller.location) score += 1;
  if (seller.memberSince !== null) score += 1;
  return score;
}

function mergeSellerProfile(
  current: MarketplaceSellerResult['seller'],
  candidate: MarketplaceSellerResult['seller']
): MarketplaceSellerResult['seller'] {
  return scoreSellerProfile(candidate) >= scoreSellerProfile(current) ? candidate : current;
}

export function parseMarketplaceSearchFragments(fragments: GraphQLFragment[]): MarketplaceListing[] {
  const listings = new Map<string, MarketplaceListing>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      const root = asRecord(payload) ?? {};
      const edgeContainer = asRecord(asRecord(asRecord(root.data)?.marketplace_search)?.feed_units);
      const edgeList = Array.isArray(edgeContainer?.edges) ? edgeContainer.edges : [];
      let structuredPayloadHit = false;

      for (const edge of edgeList) {
        const listingNode = asRecord(asRecord(asRecord(edge)?.node)?.listing);
        if (listingNode) {
          structuredPayloadHit = true;
          addScoredListing(listings, listingNode);
        }
      }

      const path = Array.isArray(root.path) ? root.path : [];
      if (path[0] === 'marketplace_search' && path[1] === 'feed_units') {
        const streamListing = asRecord(asRecord(asRecord(root.data)?.node)?.listing);
        if (streamListing) {
          structuredPayloadHit = true;
          addScoredListing(listings, streamListing);
        }
      }

      if (!structuredPayloadHit && isMarketplaceSearchScopedPayload(fragment, payload)) {
        deepVisit(payload, (node) => {
          addScoredListing(listings, node);
        });
      }
    }
  }

  return [...listings.values()];
}

export function parseMarketplaceSellerInventoryFragments(fragments: GraphQLFragment[]): MarketplaceListing[] {
  const listings = new Map<string, MarketplaceListing>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      const root = asRecord(payload) ?? {};
      const profileNode = asRecord(asRecord(root.data)?.profile);
      const listingSets = asRecord(profileNode?.marketplace_listing_sets);
      const edges = Array.isArray(listingSets?.edges) ? listingSets.edges : [];

      for (const edge of edges) {
        const canonicalListing = asRecord(asRecord(asRecord(edge)?.node)?.canonical_listing);
        if (canonicalListing) {
          addScoredListing(listings, canonicalListing);
        }
      }

      const path = Array.isArray(root.path) ? root.path : [];
      if (path[0] === 'profile' && path[1] === 'marketplace_listing_sets') {
        const streamListing = asRecord(asRecord(asRecord(root.data)?.node)?.canonical_listing);
        if (streamListing) {
          addScoredListing(listings, streamListing);
        }
      }
    }
  }

  return [...listings.values()];
}

export function parseMarketplaceListingFragments(
  fragments: GraphQLFragment[],
  listingId?: string
): MarketplaceListing | null {
  const listings = new Map<string, MarketplaceListing>();

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      const root = asRecord(payload) ?? {};
      const listingNode = asRecord(asRecord(root.data)?.marketplace_listing_item);
      if (listingNode && (!listingId || getString(listingNode.id) === listingId)) {
        addScoredListing(listings, listingNode, true);
      }

      deepVisit(payload, (node) => {
        if (node.__typename !== 'GroupCommerceProductItem') {
          return;
        }
        if (listingId && getString(node.id) !== listingId) {
          return;
        }
        addScoredListing(listings, node);
      });
    }
  }

  if (listingId) {
    return listings.get(listingId) ?? null;
  }

  return [...listings.values()].sort((left, right) => scoreListing(right) - scoreListing(left))[0] ?? null;
}

export function parseMarketplaceSellerFragments(
  fragments: GraphQLFragment[],
  sellerId: string
): MarketplaceSellerResult {
  let seller: MarketplaceSellerResult['seller'] = {
    id: sellerId,
    name: null,
    about: null,
    rating: null,
    reviewCount: null,
    location: null,
    memberSince: null
  };

  for (const fragment of fragments) {
    for (const payload of fragment.fragments) {
      const root = asRecord(payload) ?? {};
      const profileNode = asRecord(asRecord(root.data)?.profile);
      const sellerNode =
        asRecord(asRecord(root.data)?.marketplace_seller_profile) ??
        (getString(profileNode?.id) === sellerId ? profileNode : null);
      if (sellerNode) {
        seller = mergeSellerProfile(seller, normalizeSellerNode(sellerNode, sellerId));
      }

      deepVisit(payload, (node) => {
        const nodeId = getString(node.id) ?? getString(node.user_id);
        if (nodeId !== sellerId) {
          return;
        }
        seller = mergeSellerProfile(seller, normalizeSellerNode(node, sellerId));
      });
    }
  }

  return {
    sellerId,
    seller,
    listings: parseMarketplaceSellerInventoryFragments(fragments),
    scrapedAt: new Date().toISOString()
  };
}
