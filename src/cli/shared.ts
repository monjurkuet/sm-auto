import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { closePostgresPool } from '../storage/postgres/client';
import { runScrapeJob } from '../core/job_runner';
import { createScraperContext, type ScraperContext } from '../core/scraper_context';
import type { ExtractorResult } from '../types/contracts';
import type { PostgresJobPersistence } from '../storage/postgres/persistence_contracts';

export function parseSharedOptions(argv = process.argv): ScraperContext {
  const args = yargs(hideBin(argv))
    .option('chrome-port', { type: 'number', default: 9222 })
    .option('output-dir', { type: 'string', default: './output' })
    .option('include-artifacts', { type: 'boolean', default: false })
    .option('persist-db', { type: 'boolean', default: true })
    .option('timeout-ms', { type: 'number', default: 300_000 })
 .option('max-scrolls', { type: 'number', default: 200 })
 .option('scroll-delay-ms', { type: 'number', default: 800 })
    .parseSync();

  return createScraperContext({
    chromePort: args.chromePort,
    outputDir: args.outputDir,
    includeArtifacts: args.includeArtifacts,
    persistDb: args.persistDb,
    timeoutMs: args.timeoutMs,
    maxScrolls: args.maxScrolls,
    scrollDelayMs: args.scrollDelayMs
  });
}

export interface BulkQueueOptions {
  sourceQuery?: string;
  sourceLocation?: string;
  uncrawledOnly: boolean;
  limit: number;
  offset: number;
  batchSize: number;
  dryRun: boolean;
  continueOnError: boolean;
  delayMs: number;
}

export function parseBulkQueueOptions(argv = process.argv): BulkQueueOptions {
  const args = yargs(hideBin(argv))
    .option('source-query', { type: 'string' })
    .option('source-location', { type: 'string' })
    .option('uncrawled-only', { type: 'boolean', default: true })
    .option('limit', { type: 'number', default: 100 })
    .option('offset', { type: 'number', default: 0 })
    .option('batch-size', { type: 'number', default: 25 })
    .option('dry-run', { type: 'boolean', default: false })
    .option('continue-on-error', { type: 'boolean', default: true })
    .option('delay-ms', { type: 'number', default: 0 })
    .parseSync();

  return {
    sourceQuery: args.sourceQuery,
    sourceLocation: args.sourceLocation,
    uncrawledOnly: args.uncrawledOnly,
    limit: args.limit,
    offset: args.offset,
    batchSize: args.batchSize,
    dryRun: args.dryRun,
    continueOnError: args.continueOnError,
    delayMs: args.delayMs
  };
}

export interface CliSpec<T> {
  jobName: string;
  outputName: string;
  run: (context: ScraperContext) => Promise<ExtractorResult<T>>;
  persistence?: PostgresJobPersistence<T>;
}

export async function runCli<T>(context: ScraperContext, spec: CliSpec<T>): Promise<void> {
  await runScrapeJob(context, spec.jobName, spec.outputName, () => spec.run(context), spec.persistence)
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closePostgresPool());
}
