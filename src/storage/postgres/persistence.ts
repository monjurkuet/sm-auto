import type { PoolClient } from 'pg';

import { SCHEMA_VERSIONS } from '../schema_versions';
import type {
  MarketplaceListingResult,
  MarketplaceSearchResult,
  MarketplaceSellerResult,
  PageInfoResult,
  PagePostsResult
} from '../../types/contracts';
import type {
  PostgresJobPersistence,
  ScrapeRunCompletion,
  ScrapeRunStartInput,
  ScrapeSurface
} from './persistence_contracts';
import { persistMarketplaceListingSurface, persistMarketplaceSearchSurface, persistMarketplaceSellerSurface } from './marketplace_repository';
import { persistPageInfoSurface } from './page_repository';
import { persistPagePostsSurface } from './post_repository';
import { completeScrapeRun, startScrapeRun } from './run_repository';

export type { PostgresJobPersistence, ScrapeRunCompletion, ScrapeRunStartInput, ScrapeSurface } from './persistence_contracts';
export { failScrapeRun } from './run_repository';

export async function startPersistenceRun(client: PoolClient, input: ScrapeRunStartInput): Promise<string> {
  return startScrapeRun(client, input);
}

export async function completePersistenceRun(client: PoolClient, scrapeRunId: string, completion: ScrapeRunCompletion): Promise<void> {
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

export function createMarketplaceSearchPersistence(queryText: string, location: string, searchUrl: string): PostgresJobPersistence<MarketplaceSearchResult> {
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

export function createMarketplaceListingPersistence(listingId: string, url: string): PostgresJobPersistence<MarketplaceListingResult> {
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

export function createMarketplaceSellerPersistence(sellerId: string, url: string): PostgresJobPersistence<MarketplaceSellerResult> {
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
