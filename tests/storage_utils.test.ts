import assert from 'node:assert/strict';
import test from 'node:test';

import { compactJson, toJsonb, toIsoTimestamp } from '../src/storage/postgres/persistence_utils';

test('toJsonb returns JSON string for objects', () => {
  const result = toJsonb({ key: 'value' });
  assert.equal(result, '{"key":"value"}');
});

test('toJsonb returns "null" for undefined', () => {
  const result = toJsonb(undefined);
  assert.equal(result, 'null');
});

test('toJsonb returns "null" for null', () => {
  const result = toJsonb(null);
  assert.equal(result, 'null');
});

test('compactJson returns object for valid input', () => {
  const result = compactJson({ a: 1 });
  assert.deepEqual(result, { a: 1 });
});

test('compactJson returns empty object for null', () => {
  const result = compactJson(null);
  assert.deepEqual(result, {});
});

test('compactJson returns empty object for array', () => {
  const result = compactJson([1, 2, 3]);
  assert.deepEqual(result, {});
});

test('toIsoTimestamp handles Unix timestamp in seconds', () => {
  const result = toIsoTimestamp(1609459200);
  assert.equal(result, '2021-01-01T00:00:00.000Z');
});

test('toIsoTimestamp handles Unix timestamp in milliseconds', () => {
  const result = toIsoTimestamp(1609459200000);
  assert.equal(result, '2021-01-01T00:00:00.000Z');
});

test('toIsoTimestamp handles ISO string', () => {
  const result = toIsoTimestamp('2021-01-01T00:00:00.000Z');
  assert.equal(result, '2021-01-01T00:00:00.000Z');
});

test('toIsoTimestamp returns null for null', () => {
  const result = toIsoTimestamp(null);
  assert.equal(result, null);
});

test('toIsoTimestamp returns null for undefined', () => {
  const result = toIsoTimestamp(undefined);
  assert.equal(result, null);
});

test('toIsoTimestamp returns null for invalid date', () => {
  const result = toIsoTimestamp('not-a-date');
  assert.equal(result, null);
});
