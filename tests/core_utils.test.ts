import assert from 'node:assert/strict';
import test from 'node:test';

import { countBy } from '../src/core/utils';
import { waitForCondition, sleep } from '../src/core/sleep';

test('countBy counts and sorts values', () => {
  const result = countBy(['a', 'b', 'a', 'c', 'a', 'b']);
  assert.deepEqual(result, [
    { value: 'a', count: 3 },
    { value: 'b', count: 2 },
    { value: 'c', count: 1 }
  ]);
});

test('countBy handles empty array', () => {
  const result = countBy([]);
  assert.deepEqual(result, []);
});

test('countBy handles single value', () => {
  const result = countBy(['x']);
  assert.deepEqual(result, [{ value: 'x', count: 1 }]);
});

test('sleep waits for specified time', async () => {
  const start = Date.now();
  await sleep(50);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`);
});

test('waitForCondition resolves when predicate is true', async () => {
  let value = false;
  setTimeout(() => {
    value = true;
  }, 20);
  await waitForCondition(() => value, 1000, { pollMs: 10 });
  assert.equal(value, true);
});

test('waitForCondition rejects on timeout', async () => {
  await assert.rejects(() => waitForCondition(() => false, 50, { pollMs: 10 }), /Timed out after 50ms/);
});

test('waitForCondition uses custom message', async () => {
  await assert.rejects(
    () => waitForCondition(() => false, 50, { pollMs: 10, message: 'custom error' }),
    /custom error/
  );
});
