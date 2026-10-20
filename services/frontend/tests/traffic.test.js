import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRps, calculateSuccessFidelity, MIN_RPS, MAX_RPS } from '../src/lib/traffic.js';

test('clamps RPS strictly between 1 and 10 integer range', () => {
  assert.equal(MIN_RPS, 1);
  assert.equal(MAX_RPS, 10);

  // Boundary checks
  assert.equal(clampRps(0), 1);
  assert.equal(clampRps(-5), 1);
  assert.equal(clampRps(1), 1);
  assert.equal(clampRps(5), 5);
  assert.equal(clampRps(10), 10);
  assert.equal(clampRps(11), 10);
  assert.equal(clampRps(999), 10);

  // Decimals and non-finite values
  assert.equal(clampRps(3.7), 4);
  assert.equal(clampRps(3.2), 3);
  assert.equal(clampRps(NaN), 1);
  assert.equal(clampRps(null), 1);
  assert.equal(clampRps('invalid'), 1);
  assert.equal(clampRps('7'), 7);
});

test('calculates success fidelity percentage correctly', () => {
  assert.equal(calculateSuccessFidelity(0, 0), 100);
  assert.equal(calculateSuccessFidelity(100, 100), 100);
  assert.equal(calculateSuccessFidelity(100, 95), 95);
  assert.equal(calculateSuccessFidelity(200, 199), 99.5);
  assert.equal(calculateSuccessFidelity(100, 0), 0);
  assert.equal(calculateSuccessFidelity(-1, 5), 100);
});
