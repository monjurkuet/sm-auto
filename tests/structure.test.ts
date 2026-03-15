import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

for (const relativePath of [
  'src/browser/chrome_client.ts',
  'src/capture/graphql_capture.ts',
  'src/extractors/page_info_extractor.ts',
  'src/extractors/page_posts_extractor.ts',
  'src/extractors/marketplace_search_extractor.ts',
  'src/extractors/marketplace_listing_extractor.ts',
  'src/extractors/marketplace_seller_extractor.ts',
  'docs/architecture.md'
]) {
  test(`structure includes ${relativePath}`, () => {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true);
  });
}
