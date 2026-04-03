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
    .option('timeout-ms', { type: 'number', default: 90_000 })
    .option('max-scrolls', { type: 'number', default: 8 })
    .option('scroll-delay-ms', { type: 'number', default: 2000 })
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
