import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { runCli, parseSharedOptions } from './shared';
import { extractPagePosts } from '../extractors/page_posts_extractor';
import { createPagePostsPersistence } from '../storage/postgres/persistence';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runCli(context, {
    jobName: 'page-posts',
    outputName: 'page_posts.json',
    run: (ctx) => extractPagePosts(ctx, args.url),
    persistence: createPagePostsPersistence(args.url)
  });
}

void main();
