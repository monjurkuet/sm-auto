import type { PoolClient } from 'pg';

import type { ScrapeRunCompletion, ScrapeRunStartInput } from './persistence_contracts';
import { toJsonb } from './persistence_utils';

export async function startScrapeRun(client: PoolClient, input: ScrapeRunStartInput): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO scraper.scrape_runs (
        surface,
        status,
        entity_external_id,
        source_url,
        schema_version,
        input_payload
      ) VALUES ($1, 'running', $2, $3, $4, $5)
      RETURNING id
    `,
    [
      input.surface,
      input.entityExternalId ?? null,
      input.sourceUrl ?? null,
      input.schemaVersion,
      toJsonb(input.inputPayload)
    ]
  );

  return inserted.rows[0].id;
}

export async function completeScrapeRun(
  client: PoolClient,
  scrapeRunId: string,
  completion: ScrapeRunCompletion
): Promise<void> {
  await client.query(
    `
      UPDATE scraper.scrape_runs
      SET
        status = 'completed',
        entity_external_id = COALESCE($2, entity_external_id),
        source_url = COALESCE($3, source_url),
        output_summary = $4,
        completed_at = now()
      WHERE id = $1
    `,
    [scrapeRunId, completion.entityExternalId ?? null, completion.sourceUrl ?? null, toJsonb(completion.outputSummary)]
  );
}

export async function failScrapeRun(client: PoolClient, scrapeRunId: string, errorMessage: string): Promise<void> {
  await client.query(
    `
      UPDATE scraper.scrape_runs
      SET
        status = 'failed',
        error_message = $2,
        completed_at = now()
      WHERE id = $1
    `,
    [scrapeRunId, errorMessage]
  );
}
