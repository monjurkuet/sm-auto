export interface ScraperRuntimeOptions {
  chromePort?: number;
  outputDir?: string;
  includeArtifacts?: boolean;
  persistDb?: boolean;
  timeoutMs?: number;
  maxScrolls?: number;
  scrollDelayMs?: number;
}

export interface RequestMetadata {
  friendlyName?: string;
  docId?: string;
  variables?: unknown;
  rawFields: Record<string, string>;
}

export interface GraphQLFragment {
  url: string;
  status: number;
  timestamp: string;
  request: RequestMetadata;
  fragments: unknown[];
}

export interface SocialMediaLink {
  platform: 'instagram' | 'tiktok' | 'tumblr' | 'pinterest' | 'youtube' | 'x';
  handle: string;
  url: string;
}

export interface PageContactInfo {
  phones: string[];
  emails: string[];
  websites: string[];
  addresses: string[];
  socialMedia: SocialMediaLink[];
}

export interface PageInfoResult {
  pageId: string | null;
  url: string;
  name: string | null;
  category: string | null;
  followers: number | null;
  following: number | null;
  bio: string | null;
  location: string | null;
  contact: PageContactInfo;
  transparency: {
    creationDate: string | null;
    history: string[];
  };
  scrapedAt: string;
}

export interface PagePost {
  id: string | null;
  postId: string | null;
  permalink: string | null;
  createdAt: number | null;
  text: string | null;
  hashtags: string[];
  mentions: string[];
  links: string[];
  media: Array<{
    type: 'photo' | 'video';
    id: string | null;
    url: string | null;
    width?: number;
    height?: number;
    durationSec?: number;
  }>;
  metrics: {
    reactions: number | null;
    comments: number | null;
    shares: number | null;
  };
  author: {
    id: string | null;
    name: string | null;
  };
}

export interface PagePostsResult {
  pageId: string | null;
  url: string;
  posts: PagePost[];
  scrapedAt: string;
}

export interface MarketplaceListing {
  id: string | null;
  title: string | null;
  description: string | null;
  price: {
    amount: number | null;
    currency: string | null;
    formatted: string | null;
  };
  seller: {
    id: string | null;
    name: string | null;
  };
  location: {
    city: string | null;
    fullLocation: string | null;
    coordinates?: unknown;
  };
  images: Array<{
    url: string | null;
    width?: number;
    height?: number;
  }>;
  availability: string | null;
  categoryId: string | null;
  deliveryOptions: string[];
}

export interface MarketplaceRouteLocationContext {
  radius: number | null;
  latitude: number | null;
  longitude: number | null;
  vanityPageId: string | null;
}

export interface MarketplaceOutputContext {
  routeName: string | null;
  routeLocation: MarketplaceRouteLocationContext | null;
  buyLocation: MarketplaceRouteLocationContext | null;
  queryNames: string[];
}

export interface MarketplaceSearchResult {
  query: string;
  location: string;
  searchUrl: string;
  searchContext?: {
    buyLocation: {
      radius: number | null;
      latitude: number | null;
      longitude: number | null;
      vanityPageId: string | null;
    } | null;
  };
  listings: MarketplaceListing[];
  scrapedAt: string;
}

export interface MarketplaceListingResult extends MarketplaceListing {
  url: string;
  context?: MarketplaceOutputContext & {
    targetId: string | null;
  };
  scrapedAt: string;
}

export interface MarketplaceSellerResult {
  sellerId: string;
  seller: {
    id: string | null;
    name: string | null;
    about: string | null;
    rating: number | null;
    reviewCount: number | null;
    location: string | null;
    memberSince: string | number | null;
  };
  context?: MarketplaceOutputContext & {
    sellerId: string | null;
  };
  listings: MarketplaceListing[];
  scrapedAt: string;
}

export interface ExtractorResult<T> {
  data: T;
  artifacts?: Record<string, unknown>;
}
