import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractGroupPosts } from '../extractors/group_posts_extractor';
import { createGroupPostsPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'group-posts',
    outputName: 'group_posts.json',
    run: (ctx) => extractGroupPosts(ctx, args.url),
    persistence: createGroupPostsPersistence(args.url)
  });
}

void main();
