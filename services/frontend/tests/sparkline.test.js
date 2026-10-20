import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSparklinePaths } from '../src/lib/sparkline.js';

test('returns empty paths when data array is empty or invalid', () => {
  assert.deepEqual(generateSparklinePaths([]), { linePath: '', areaPath: '', min: 0, max: 0, count: 0 });
  assert.deepEqual(generateSparklinePaths(null), { linePath: '', areaPath: '', min: 0, max: 0, count: 0 });
});

test('handles single point gracefully with flat line', () => {
  const result = generateSparklinePaths([150], { width: 100, height: 24 });
  assert.equal(result.count, 1);
  assert.equal(result.min, 150);
  assert.equal(result.max, 150);
  assert.ok(result.linePath.startsWith('M 0,12'));
  assert.ok(result.areaPath.includes('L 100,24'));
});

test('handles flat values without dividing by zero', () => {
  const result = generateSparklinePaths([50, 50, 50], { width: 100, height: 24 });
  assert.equal(result.count, 3);
  assert.equal(result.min, 50);
  assert.equal(result.max, 50);
  assert.ok(result.linePath.length > 0);
  assert.ok(result.areaPath.endsWith('Z'));
});

test('generates smooth cubic bezier paths scaled to width and height', () => {
  const values = [100, 150, 120, 200, 180];
  const result = generateSparklinePaths(values, { width: 100, height: 24, padding: 2 });
  assert.equal(result.count, 5);
  assert.equal(result.min, 100);
  assert.equal(result.max, 200);
  assert.ok(result.linePath.startsWith('M 0,'));
  assert.ok(result.linePath.includes(' C '));
  assert.ok(result.areaPath.includes(' L 100,24'));
  assert.ok(result.areaPath.endsWith('Z'));
});
