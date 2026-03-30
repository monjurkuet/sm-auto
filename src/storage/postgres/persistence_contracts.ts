import type { PoolClient } from 'pg';

import type { ExtractorResult } from '../../types/contracts';

export type ScrapeSurface =
  | 'page_info'
  | 'page_posts'
  | 'marketplace_search'
  | 'marketplace_listing'
  | 'marketplace_seller';

export interface ScrapeRunStartInput {
  surface: ScrapeSurface;
  schemaVersion: string;
  entityExternalId?: string | null;
  sourceUrl?: string | null;
  inputPayload: Record<string, unknown>;
}

export interface ScrapeRunCompletion {
  entityExternalId?: string | null;
  sourceUrl?: string | null;
  outputSummary: Record<string, unknown>;
}

export interface PostgresJobPersistence<T> {
  start: ScrapeRunStartInput;
  persist: (client: PoolClient, scrapeRunId: string, result: ExtractorResult<T>) => Promise<ScrapeRunCompletion>;
}
