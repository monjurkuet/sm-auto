import type { PoolClient } from 'pg';

export function compactJson(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

export function toJsonb(value: unknown): string {
    return JSON.stringify(value ?? null);
}

export function toIsoTimestamp(value: number | string | null | undefined): string | null {
    if (value == null) {
        return null;
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function insertArtifacts(client: PoolClient, scrapeRunId: string, artifacts?: Record<string, unknown>): Promise<void> {
    if (!artifacts) {
        return;
    }

    for (const [name, value] of Object.entries(artifacts)) {
        if (typeof value === 'string') {
            await client.query(
                `
          INSERT INTO scraper.scrape_artifacts (
            scrape_run_id,
            artifact_name,
            artifact_format,
            payload_text
          ) VALUES ($1, $2, 'text', $3)
          ON CONFLICT (scrape_run_id, artifact_name)
          DO UPDATE SET payload_text = EXCLUDED.payload_text, artifact_format = EXCLUDED.artifact_format
        `,
                [scrapeRunId, name, value]
            );
            continue;
        }

        await client.query(
            `
        INSERT INTO scraper.scrape_artifacts (
          scrape_run_id,
          artifact_name,
          artifact_format,
          payload
        ) VALUES ($1, $2, 'json', $3)
        ON CONFLICT (scrape_run_id, artifact_name)
        DO UPDATE SET payload = EXCLUDED.payload, artifact_format = EXCLUDED.artifact_format
      `,
            [scrapeRunId, name, toJsonb(value)]
        );
    }
}