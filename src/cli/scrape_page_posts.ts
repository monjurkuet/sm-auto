import yargs from 'yargs/yargs';
import { closePostgresPool } from '../storage/postgres/client';
import { hideBin } from 'yargs/helpers';

import { runScrapeJob } from '../core/job_runner';
import { extractPagePosts } from '../extractors/page_posts_extractor';
import { createPagePostsPersistence } from '../storage/postgres/persistence';
import { parseSharedOptions } from './shared';

async function main(): Promise<void> {
  const args = yargs(hideBin(process.argv)).option('url', { type: 'string', demandOption: true }).parseSync();
  const context = parseSharedOptions(process.argv);
  await runScrapeJob(
    context,
    'page-posts',
    'page_posts.json',
    () => extractPagePosts(context, args.url),
    createPagePostsPersistence(args.url)
  );
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool());
