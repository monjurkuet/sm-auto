import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractGroupJoin } from '../extractors/group_join_extractor';
import { createGroupJoinPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'group-join',
    outputName: 'group_join.json',
    run: (ctx) => extractGroupJoin(ctx, args.url),
    persistence: createGroupJoinPersistence(args.url)
  });
}

void main();
