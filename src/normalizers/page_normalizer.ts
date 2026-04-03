import type { DataProvenance, PageContactInfo, PageInfoResult } from '../types/contracts';

export interface PageInfoInput {
  pageId: string | null;
  url: string;
  name: string | null;
  category: string | null;
  followers: number | null;
  following: number | null;
  bio: string | null;
  location: string | null;
  contact: PageContactInfo;
  creationDate: string | null;
  history: string[];
  provenance?: Record<string, DataProvenance>;
}

export function normalizePageInfo(input: PageInfoInput): PageInfoResult {
  return {
    pageId: input.pageId,
    url: input.url,
    name: input.name,
    category: input.category,
    followers: input.followers,
    following: input.following ?? null,
    bio: input.bio ?? null,
    location: input.location ?? null,
    contact: {
      ...input.contact,
      socialMedia: input.contact.socialMedia ?? []
    },
    transparency: {
      creationDate: input.creationDate,
      history: [...new Set(input.history)]
    },
    scrapedAt: new Date().toISOString(),
    provenance: input.provenance
  };
}
