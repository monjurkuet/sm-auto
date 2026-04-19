import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDelayPlanner,
  sampleNextDelay,
  sampleStartupDelay,
  validateDelayPlannerOptions
} from '../src/cli/humanized_delay';

test('validateDelayPlannerOptions rejects invalid ranges', () => {
  assert.throws(
    () =>
      validateDelayPlannerOptions({
        delayMode: 'humanized',
        delayMs: 2500,
        delayJitterMs: 1500,
        pauseEveryMin: 10,
        pauseEveryMax: 4,
        pauseMinMs: 8000,
        pauseMaxMs: 25000,
        errorDelayMultiplier: 1.75
      }),
    /pauseEveryMin must be less than or equal to pauseEveryMax/
  );
});

test('sampleNextDelay returns fixed delay in fixed mode', () => {
  const planner = createDelayPlanner({
    delayMode: 'fixed',
    delayMs: 2500,
    delayJitterMs: 1500,
    pauseEveryMin: 4,
    pauseEveryMax: 9,
    pauseMinMs: 8000,
    pauseMaxMs: 25000,
    errorDelayMultiplier: 1.75,
    seed: 1
  });

  assert.deepEqual(sampleNextDelay(planner, 'success'), { delayMs: 2500, reason: 'fixed-delay' });
});

test('sampleNextDelay returns zero delay in off mode', () => {
  const planner = createDelayPlanner({
    delayMode: 'off',
    delayMs: 2500,
    delayJitterMs: 1500,
    pauseEveryMin: 4,
    pauseEveryMax: 9,
    pauseMinMs: 8000,
    pauseMaxMs: 25000,
    errorDelayMultiplier: 1.75,
    seed: 1
  });

  assert.deepEqual(sampleNextDelay(planner, 'success'), { delayMs: 0, reason: 'normal-jitter' });
});

test('sampleStartupDelay is bounded and deterministic with a seed', () => {
  const plannerA = createDelayPlanner({
    delayMode: 'humanized',
    delayMs: 2500,
    delayJitterMs: 1500,
    pauseEveryMin: 4,
    pauseEveryMax: 9,
    pauseMinMs: 8000,
    pauseMaxMs: 25000,
    errorDelayMultiplier: 1.75,
    seed: 123
  });
  const plannerB = createDelayPlanner({
    delayMode: 'humanized',
    delayMs: 2500,
    delayJitterMs: 1500,
    pauseEveryMin: 4,
    pauseEveryMax: 9,
    pauseMinMs: 8000,
    pauseMaxMs: 25000,
    errorDelayMultiplier: 1.75,
    seed: 123
  });

  const startupA = sampleStartupDelay(plannerA);
  const startupB = sampleStartupDelay(plannerB);

  assert.equal(startupA.reason, 'startup-jitter');
  assert.equal(startupA.delayMs, startupB.delayMs);
  assert.ok(startupA.delayMs >= 500);
  assert.ok(startupA.delayMs <= 2500);
});

test('sampleNextDelay applies error backoff and burst pause', () => {
  const planner = createDelayPlanner({
    delayMode: 'humanized',
    delayMs: 1000,
    delayJitterMs: 0,
    pauseEveryMin: 1,
    pauseEveryMax: 1,
    pauseMinMs: 5000,
    pauseMaxMs: 5000,
    errorDelayMultiplier: 2,
    seed: 7
  });

  const first = sampleNextDelay(planner, 'failure');
  assert.equal(first.reason, 'burst-pause');
  assert.equal(first.delayMs, 5000);
});
