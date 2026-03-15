import type { MarketplaceSellerResult } from '../types/contracts';

export function normalizeMarketplaceSeller(result: MarketplaceSellerResult): MarketplaceSellerResult {
  return {
    ...result,
    listings: result.listings.filter((listing, index, all) => {
      return index === all.findIndex((candidate) => candidate.id === listing.id);
    }),
    scrapedAt: new Date().toISOString()
  };
}
