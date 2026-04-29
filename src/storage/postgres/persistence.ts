import type { PoolClient } from 'pg';

import { SCHEMA_VERSIONS } from '../schema_versions';
import type {
  GroupInfoResult,
  GroupPostDetailResult,
  GroupPostsResult,
  MarketplaceListingResult,
  MarketplaceSearchResult,
  MarketplaceSellerResult,
  PageInfoResult,
  PagePostsResult
} from '../../types/contracts';
import type { PostgresJobPersistence, ScrapeRunCompletion, ScrapeRunStartInput } from './persistence_contracts';
import {
  persistGroupInfoSurface,
  persistGroupPostDetailSurface,
  persistGroupPostsSurface
} from './group_repository';
import {
  persistMarketplaceListingSurface,
  persistMarketplaceSearchSurface,
  persistMarketplaceSellerSurface
} from './marketplace_repository';
import { persistPageInfoSurface } from './page_repository';
import { persistPagePostsSurface } from './post_repository';
import { completeScrapeRun, startScrapeRun } from './run_repository';

export type {
  PostgresJobPersistence,
  ScrapeRunCompletion,
  ScrapeRunStartInput,
  ScrapeSurface
} from './persistence_contracts';
export { failScrapeRun } from './run_repository';

export async function startPersistenceRun(client: PoolClient, input: ScrapeRunStartInput): Promise<string> {
  return startScrapeRun(client, input);
}

export async function completePersistenceRun(
  client: PoolClient,
  scrapeRunId: string,
  completion: ScrapeRunCompletion
): Promise<void> {
  return completeScrapeRun(client, scrapeRunId, completion);
}

export function createPageInfoPersistence(url: string): PostgresJobPersistence<PageInfoResult> {
  return {
    start: {
      surface: 'page_info',
      schemaVersion: SCHEMA_VERSIONS.pageInfo,
      sourceUrl: url,
      inputPayload: { url }
    },
    persist: persistPageInfoSurface
  };
}

export function createPagePostsPersistence(url: string): PostgresJobPersistence<PagePostsResult> {
  return {
    start: {
      surface: 'page_posts',
      schemaVersion: SCHEMA_VERSIONS.pagePosts,
      sourceUrl: url,
      inputPayload: { url }
    },
    persist: persistPagePostsSurface
  };
}

export function createMarketplaceSearchPersistence(
  queryText: string,
  location: string,
  searchUrl: string
): PostgresJobPersistence<MarketplaceSearchResult> {
  return {
    start: {
      surface: 'marketplace_search',
      sourceUrl: searchUrl,
      schemaVersion: SCHEMA_VERSIONS.marketplaceSearch,
      inputPayload: {
        query: queryText,
        location,
        searchUrl
      }
    },
    persist: persistMarketplaceSearchSurface
  };
}

export function createMarketplaceListingPersistence(
  listingId: string,
  url: string
): PostgresJobPersistence<MarketplaceListingResult> {
  return {
    start: {
      surface: 'marketplace_listing',
      entityExternalId: listingId,
      sourceUrl: url,
      schemaVersion: SCHEMA_VERSIONS.marketplaceListing,
      inputPayload: { listingId, url }
    },
    persist: persistMarketplaceListingSurface
  };
}

export function createMarketplaceSellerPersistence(
  sellerId: string,
  url: string
): PostgresJobPersistence<MarketplaceSellerResult> {
  return {
    start: {
      surface: 'marketplace_seller',
      entityExternalId: sellerId,
      sourceUrl: url,
      schemaVersion: SCHEMA_VERSIONS.marketplaceSeller,
      inputPayload: { sellerId, url }
    },
    persist: persistMarketplaceSellerSurface
  };
}

export function createGroupInfoPersistence(groupUrl: string): PostgresJobPersistence<GroupInfoResult> {
  return {
    start: {
      surface: 'group_info',
      schemaVersion: SCHEMA_VERSIONS.groupInfo,
      sourceUrl: groupUrl,
      inputPayload: { url: groupUrl }
    },
    persist: persistGroupInfoSurface,
  };
}

export function createGroupPostsPersistence(groupUrl: string): PostgresJobPersistence<GroupPostsResult> {
  return {
    start: {
      surface: 'group_posts',
      schemaVersion: SCHEMA_VERSIONS.groupPosts,
      sourceUrl: groupUrl,
      inputPayload: { url: groupUrl }
    },
    persist: persistGroupPostsSurface,
  };
}

export function createGroupPostDetailPersistence(postUrl: string): PostgresJobPersistence<GroupPostDetailResult> {
  return {
    start: {
      surface: 'group_post_detail',
      schemaVersion: SCHEMA_VERSIONS.groupPostDetail,
      sourceUrl: postUrl,
      inputPayload: { url: postUrl }
    },
    persist: persistGroupPostDetailSurface,
  };
}
