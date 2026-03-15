export function buildMarketplaceSearchUrl(query: string, location: string): string {
  return `https://www.facebook.com/marketplace/${encodeURIComponent(location.toLowerCase())}/search?query=${encodeURIComponent(query)}`;
}

export function buildMarketplaceListingUrl(listingId: string): string {
  return `https://www.facebook.com/marketplace/item/${listingId}/`;
}

export function buildMarketplaceSellerUrl(sellerId: string): string {
  return `https://www.facebook.com/marketplace/profile/${sellerId}/`;
}
