import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractGroupInfo } from '../extractors/group_info_extractor';
import { createGroupInfoPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'group-info',
    outputName: 'group_info.json',
    run: (ctx) => extractGroupInfo(ctx, args.url),
    persistence: createGroupInfoPersistence(args.url)
  });
}

void main();
