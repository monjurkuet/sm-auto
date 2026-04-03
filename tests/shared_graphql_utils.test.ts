import assert from 'node:assert/strict';
import test from 'node:test';

import { asRecord, deepVisit, getString, getNumber } from '../src/parsers/graphql/shared_graphql_utils';

test('asRecord returns null for non-objects', () => {
  assert.equal(asRecord(null), null);
  assert.equal(asRecord(undefined), null);
  assert.equal(asRecord(42), null);
  assert.equal(asRecord('string'), null);
  assert.equal(asRecord(true), null);
  assert.equal(asRecord([]), null);
});

test('asRecord returns object for plain objects', () => {
  const obj = { key: 'value' };
  const result = asRecord(obj);
  assert.notEqual(result, null);
  assert.equal(result?.key, 'value');
});

test('getString returns string or null', () => {
  assert.equal(getString('hello'), 'hello');
  assert.equal(getString(null), null);
  assert.equal(getString(undefined), null);
  assert.equal(getString(42), null);
  assert.equal(getString({}), null);
});

test('getNumber parses numeric strings', () => {
  assert.equal(getNumber(42), 42);
  assert.equal(getNumber('42'), 42);
  assert.equal(getNumber('1,234.56'), 1234.56);
  assert.equal(getNumber('  100  '), 100);
  assert.equal(getNumber(null), null);
  assert.equal(getNumber(undefined), null);
  assert.equal(getNumber('not-a-number'), null);
  assert.equal(getNumber(''), null);
});

test('deepVisit visits all nodes in a tree', () => {
  const visited: Record<string, unknown>[] = [];
  const tree = {
    a: 1,
    b: {
      c: 2,
      d: [{ e: 3 }, { f: 4 }]
    }
  };

  deepVisit(tree, (node) => {
    visited.push(node);
  });

  assert.equal(visited.length, 4);
  assert.equal(visited[0], tree);
  assert.deepEqual(visited[1], { c: 2, d: [{ e: 3 }, { f: 4 }] });
  assert.deepEqual(visited[2], { e: 3 });
  assert.deepEqual(visited[3], { f: 4 });
});
