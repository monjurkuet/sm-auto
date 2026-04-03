import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractPageInfo } from '../extractors/page_info_extractor';
import { createPageInfoPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'page-info',
    outputName: 'page_info.json',
    run: (ctx) => extractPageInfo(ctx, args.url),
    persistence: createPageInfoPersistence(args.url)
  });
}

void main();
