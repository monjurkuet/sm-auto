import type { ExtractorResult } from '../types/contracts';
import type { ScraperContext } from './scraper_context';
import { writeArtifacts } from '../storage/artifact_writer';
import { writeJsonFile } from '../storage/json_writer';
import { withTransaction } from '../storage/postgres/client';
import { ensurePostgresReady } from '../storage/postgres/migrator';
import {
  completePersistenceRun,
  failScrapeRun,
  startPersistenceRun,
  type PostgresJobPersistence
} from '../storage/postgres/persistence';

/**
 * Sanitizes error stack traces by removing absolute file paths.
 * This prevents exposing internal directory structure in stored error logs.
 */
function sanitizeStackTrace(stack: string): string {
  return stack.replace(/(?:^|\s)\/[^\s:]+(?::\d+)?/g, ' <redacted>');
}

export async function runScrapeJob<T>(
  context: ScraperContext,
  jobName: string,
  outputName: string,
  run: () => Promise<ExtractorResult<T>>,
  persistence?: PostgresJobPersistence<T>
): Promise<ExtractorResult<T>> {
  context.logger.info(`Starting ${jobName}`);
  let scrapeRunId: string | null = null;

  if (context.persistDb && persistence) {
    await ensurePostgresReady();
    scrapeRunId = await withTransaction((client) => startPersistenceRun(client, persistence.start));
  }

  try {
    const result = await run();
    await writeJsonFile(context.outputDir, outputName, result.data);

    if (context.includeArtifacts && result.artifacts) {
      await writeArtifacts(context.outputDir, jobName, result.artifacts);
    }

    if (context.persistDb && persistence && scrapeRunId) {
      await withTransaction(async (client) => {
        const completion = await persistence.persist(client, scrapeRunId as string, result);
        await completePersistenceRun(client, scrapeRunId as string, completion);
      });
    }

    context.logger.info(`Completed ${jobName}`);
    return result;
  } catch (error) {
    if (context.persistDb && scrapeRunId) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error && error.stack ? sanitizeStackTrace(error.stack) : errorMessage;
      try {
        await withTransaction((client) => failScrapeRun(client, scrapeRunId as string, errorStack));
      } catch (persistError) {
        context.logger.warn('Failed to mark scrape run as failed in Postgres', persistError);
      }
    }
    throw error;
  }
}
