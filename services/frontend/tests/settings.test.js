import test from 'node:test';
import assert from 'node:assert/strict';
import { safeProxyPrefix, catalogBounds } from '../src/lib/settings.js';

test('settings exposes relative prefixes only, never credentials or upstream URLs', () => {
  assert.equal(safeProxyPrefix('/order-api'), '/order-api');
  for (const input of ['https://user:secret@example.test/api', '//example.test/api', '/api?token=secret', '/api#secret', undefined, '/%2Fsecret']) {
    assert.equal(safeProxyPrefix(input), 'Not configured as a relative proxy prefix');
  }
});
test('missing catalog has no invented limits', () => assert.deepEqual(catalogBounds(null), []));
test('catalog bounds preserve server limits and enum values', () => {
  assert.deepEqual(catalogBounds({ experiments: [{ fault_type: 'LATENCY', parameters_schema: { properties: { latency_ms: { minimum: 0, maximum: 900 }, mode: { enum: ['a', 'b'] } } } }] }), [
    { fault: 'LATENCY', name: 'latency_ms', limits: '0 – 900' }, { fault: 'LATENCY', name: 'mode', limits: 'a, b' },
  ]);
});
