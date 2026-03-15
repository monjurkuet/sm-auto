import type { PageContactInfo, PageInfoResult } from '../types/contracts';

export interface PageInfoInput {
  pageId: string | null;
  url: string;
  name: string | null;
  category: string | null;
  followers: number | null;
  contact: PageContactInfo;
  creationDate: string | null;
  history: string[];
}

export function normalizePageInfo(input: PageInfoInput): PageInfoResult {
  return {
    pageId: input.pageId,
    url: input.url,
    name: input.name,
    category: input.category,
    followers: input.followers,
    contact: input.contact,
    transparency: {
      creationDate: input.creationDate,
      history: [...new Set(input.history)]
    },
    scrapedAt: new Date().toISOString()
  };
}
