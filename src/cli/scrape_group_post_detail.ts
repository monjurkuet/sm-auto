import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractGroupPostDetail } from '../extractors/group_post_detail_extractor';
import { createGroupPostDetailPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('post-url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'group-post-detail',
    outputName: 'group_post_detail.json',
    run: (ctx) => extractGroupPostDetail(ctx, args['post-url']),
    persistence: createGroupPostDetailPersistence(args['post-url'])
  });
}

void main();
