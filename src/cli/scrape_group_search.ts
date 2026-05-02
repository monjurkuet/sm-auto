import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractGroupSearch } from '../extractors/group_search_extractor';
import { createGroupSearchPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv))
    .option('query', { type: 'string', demandOption: true })
    .option('max-scrolls', { type: 'number', default: 5 })
    .parseSync();

  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'group-search',
    outputName: 'group_search.json',
    run: (ctx) => extractGroupSearch(ctx, args.query),
    persistence: createGroupSearchPersistence(args.query)
  });
}

void main();
