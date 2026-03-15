import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runScrapeJob } from '../core/job_runner';
import { extractPageInfo } from '../extractors/page_info_extractor';
import { createPageInfoPersistence } from '../storage/postgres/persistence';
import { parseSharedOptions } from './shared';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runScrapeJob(context, 'page-info', 'page_info.json', () => extractPageInfo(context, args.url), createPageInfoPersistence(args.url));
}

void main();
