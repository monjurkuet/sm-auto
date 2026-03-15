import type { MarketplaceListing, MarketplaceListingResult } from '../types/contracts';

export function normalizeMarketplaceListing(url: string, listing: MarketplaceListing): MarketplaceListingResult {
  return {
    ...listing,
    url,
    scrapedAt: new Date().toISOString()
  };
}
