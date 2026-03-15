import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { createScraperContext, type ScraperContext } from '../core/scraper_context';

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
