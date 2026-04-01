import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createChildScraperContext, createScraperContext } from '../src/core/scraper_context';

test('createChildScraperContext preserves runtime flags and logger', () => {
  const parent = createScraperContext({
    chromePort: 9444,
    outputDir: './output/base',
    includeArtifacts: true,
    persistDb: false,
    timeoutMs: 45_000,
    maxScrolls: 3,
    scrollDelayMs: 750
  });

  const child = createChildScraperContext(parent, path.join(parent.outputDir, 'nested'));

  assert.equal(child.chromePort, 9444);
  assert.equal(child.timeoutMs, 45_000);
  assert.equal(child.maxScrolls, 3);
  assert.equal(child.scrollDelayMs, 750);
  assert.equal(child.includeArtifacts, true);
  assert.equal(child.persistDb, false);
  assert.equal(child.outputDir, path.join(parent.outputDir, 'nested'));
  assert.equal(child.logger, parent.logger);
});
