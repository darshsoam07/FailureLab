import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMetricsPoint,
  formatPercent,
  deriveBreachZone,
  extractSparklineSeries,
  BUFFER_CAPACITY,
} from '../src/lib/metricsBuffer.js';

test('appendMetricsPoint skips failed polls and does not append null as 0', () => {
  const initial = [{ timestamp: 1000, p95: 120, errorRate: 0.01 }];

  // Null payload returns initial buffer unchanged
  assert.equal(appendMetricsPoint(initial, null), initial);
  assert.equal(appendMetricsPoint(initial, undefined), initial);
  assert.equal(appendMetricsPoint(initial, {}), initial);

  // Missing or negative p95 does not append a 0-value point
  assert.equal(appendMetricsPoint(initial, { p95_latency_ms: null }), initial);
  assert.equal(appendMetricsPoint(initial, { p95_latency_ms: -5 }), initial);
  assert.equal(appendMetricsPoint(initial, { p95_latency_ms: NaN }), initial);

  // Valid point appends correctly
  const updated = appendMetricsPoint(initial, {
    p95_latency_ms: 145.2,
    error_rate: 0.03,
    total_orders: 50,
    succeeded: 48,
  }, 2000);

  assert.equal(updated.length, 2);
  assert.equal(updated[1].p95, 145.2);
  assert.equal(updated[1].errorRate, 0.03);
  assert.equal(updated[1].timestamp, 2000);
});

test('appendMetricsPoint enforces capacity limit of 90 samples', () => {
  let buffer = [];
  for (let i = 0; i < 110; i++) {
    buffer = appendMetricsPoint(buffer, { p95_latency_ms: 100 + i }, i * 1000);
  }
  assert.equal(buffer.length, BUFFER_CAPACITY);
  assert.equal(buffer[0].p95, 120); // First 20 discarded
  assert.equal(buffer[buffer.length - 1].p95, 209);
});

test('formatPercent converts 0-1 fractions to percentages and never shows 0 for unknown', () => {
  assert.equal(formatPercent(0.045), '4.50%');
  assert.equal(formatPercent(0.0456, 1), '4.6%');
  assert.equal(formatPercent(0), '0.00%');
  assert.equal(formatPercent(1), '100.00%');

  // Unknown / invalid inputs return honest '-'
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(undefined), '—');
  assert.equal(formatPercent(NaN), '—');
  assert.equal(formatPercent(-0.1), '—');
  assert.equal(formatPercent('0.5'), '—');
});

test('deriveBreachZone computes correct threshold boundaries and breach flag', () => {
  // Not armed (null or 0 threshold)
  assert.deepEqual(deriveBreachZone({ p95: 300, sloMaxP95Ms: null }), { isBreached: false, y1: null, y2: null });
  assert.deepEqual(deriveBreachZone({ p95: 300, sloMaxP95Ms: 0 }), { isBreached: false, y1: null, y2: null });

  // Armed, healthy (below threshold)
  const healthyZone = deriveBreachZone({ p95: 180, sloMaxP95Ms: 500, maxY: 600 });
  assert.equal(healthyZone.isBreached, false);
  assert.equal(healthyZone.y1, 500);
  assert.ok(healthyZone.y2 >= 600);

  // Armed, breached (p95 above threshold)
  const breachedZone = deriveBreachZone({ p95: 580, sloMaxP95Ms: 500, maxY: 600 });
  assert.equal(breachedZone.isBreached, true);
  assert.equal(breachedZone.y1, 500);
  assert.ok(breachedZone.y2 >= 638);
});

test('extractSparklineSeries pulls valid numeric arrays for sparklines', () => {
  const buffer = [
    { timestamp: 1, p95: 110, errorRate: 0.01 },
    { timestamp: 2, p95: 120, errorRate: null },
    { timestamp: 3, p95: 130, errorRate: 0.05 },
  ];

  assert.deepEqual(extractSparklineSeries(buffer, 'p95'), [110, 120, 130]);
  assert.deepEqual(extractSparklineSeries(buffer, 'errorRate'), [0.01, 0.05]);
  assert.deepEqual(extractSparklineSeries([], 'p95'), []);
  assert.deepEqual(extractSparklineSeries(null, 'p95'), []);
});
