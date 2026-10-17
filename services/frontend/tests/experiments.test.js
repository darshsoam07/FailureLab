import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExperiment, buildProposal, validateParameters } from '../src/api/experiments.js';

export const catalog = {
  target_service: 'inventory_service', duration_seconds: { minimum: 1, maximum: 3600, default: 60 },
  experiments: [
    { fault_type: 'LATENCY', parameters_schema: { required: ['latency_ms'], properties: { latency_ms: { type: 'integer', minimum: 0, maximum: 30000 }, jitter_ms: { type: 'integer', minimum: 0, maximum: 30000, default: 0 } } } },
    { fault_type: 'ERROR_RATE', parameters_schema: { required: ['error_rate_percent'], properties: { mode: { type: 'string', enum: ['http_503', 'reset_peer'], default: 'http_503' }, error_rate_percent: { type: 'number', exclusiveMinimum: 0, maximum: 100 } } } },
  ],
};
const source = { name: 'Baseline', parameters: { duration_seconds: 90 }, slo_max_error_rate: .05, slo_max_p95_ms: 600 };

test('AI follow-up preserves duration and safety limits without copying controller internals', () => {
  const body = buildProposal(catalog, { ...source, parameters: { ...source.parameters, _controller: { phase: 'finished' } } }, { fault_type: 'LATENCY', suggested_parameters: { latency_ms: 200 }, rationale: 'Compare' });
  assert.deepEqual(body, { name: 'AI follow-up: Baseline', fault_type: 'LATENCY', target_service: 'inventory_service', parameters: { latency_ms: 200, jitter_ms: 0 }, duration_seconds: 90, slo_max_error_rate: .05, slo_max_p95_ms: 600 });
});

test('proposal cannot inject unknown faults, targets, or internal parameters', () => {
  assert.throws(() => validateParameters(catalog, 'ARBITRARY', {}), /allowlisted/);
  assert.throws(() => validateParameters(catalog, 'LATENCY', { latency_ms: 200, target_service: 'other' }), /Unsupported/);
  assert.throws(() => validateParameters(catalog, 'LATENCY', { latency_ms: 200, _controller: {} }), /Unsupported/);
});

test('parameter limits reject non-finite, fractional, and out-of-range values', () => {
  for (const value of [NaN, Infinity, null, -1, 30001, 2.5, '400', '']) assert.throws(() => validateParameters(catalog, 'LATENCY', { latency_ms: value }));
  assert.throws(() => validateParameters(catalog, 'ERROR_RATE', { mode: 'anything', error_rate_percent: 20 }));
  assert.throws(() => validateParameters(catalog, 'ERROR_RATE', { error_rate_percent: 0 }));
  assert.deepEqual(validateParameters(catalog, 'ERROR_RATE', { error_rate_percent: 100 }), { mode: 'http_503', error_rate_percent: 100 });
});

test('request validation enforces fractions and duration before calling API', () => {
  const values = { ...source, name: ' Test ', fault_type: 'LATENCY', parameters: { latency_ms: 10 }, duration_seconds: 60 };
  assert.equal(buildExperiment(catalog, values).name, 'Test');
  for (const override of [{ duration_seconds: 0 }, { duration_seconds: 1.5 }, { slo_max_error_rate: 10 }, { slo_max_p95_ms: 0 }, { name: ' ' }]) assert.throws(() => buildExperiment(catalog, { ...values, ...override }));
});
