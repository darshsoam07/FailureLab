import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPageTitle,
  canEmergencyStop,
  deriveHealthPillState,
  isExperimentAlreadyEndedError,
  NAV_ITEMS,
} from '../src/lib/shell.js';

test('nav items covers all 5 primary views', () => {
  const ids = NAV_ITEMS.map(item => item.id);
  assert.deepEqual(ids, ['dashboard', 'experiments', 'reports', 'topology', 'settings']);
});

test('page title maps accurately to each screen id with sensible fallback', () => {
  assert.equal(getPageTitle('dashboard'), 'Command Center Dashboard');
  assert.equal(getPageTitle('experiments'), 'Chaos Experiments Studio');
  assert.equal(getPageTitle('reports'), 'Resilience Reports & Post-Mortems');
  assert.equal(getPageTitle('topology'), 'Distributed System Topology');
  assert.equal(getPageTitle('settings'), 'System & Guardrail Settings');
  assert.equal(getPageTitle('unknown'), 'Command Center Dashboard');
});

test('canEmergencyStop rules: enabled ONLY when experiment status is RUNNING', () => {
  // Null or missing
  assert.deepEqual(canEmergencyStop(null), {
    enabled: false,
    label: 'STANDBY',
    reason: 'No running fault injection to abort',
    experimentId: null,
    experimentName: null,
  });

  // Non-running statuses
  for (const status of ['PLANNED', 'COMPLETED', 'ABORTED', 'FAILED']) {
    const res = canEmergencyStop({ id: 'exp-1', name: 'Latency test', status });
    assert.equal(res.enabled, false);
    assert.equal(res.experimentId, null);
  }

  // Active RUNNING experiment
  const active = canEmergencyStop({ id: 'exp-123', name: 'Latency Spike (450ms)', status: 'RUNNING' });
  assert.equal(active.enabled, true);
  assert.equal(active.label, 'EMERGENCY STOP');
  assert.equal(active.experimentId, 'exp-123');
  assert.equal(active.experimentName, 'Latency Spike (450ms)');
});

test('deriveHealthPillState handles loading, unreachable, ready, and degraded states', () => {
  // Loading
  const loadingRes = deriveHealthPillState({ loading: true, data: null });
  assert.equal(loadingRes.state, 'loading');

  // Unreachable error
  const errorRes = deriveHealthPillState({ error: new Error('Failed to fetch :8003') });
  assert.equal(errorRes.state, 'unreachable');
  assert.ok(errorRes.detail.includes('Failed to fetch :8003'));

  // Ready with all checks true
  const readyRes = deriveHealthPillState({
    data: {
      status: 'ready',
      checks: { database: true, rabbitmq: true, toxiproxy: true, background_tasks: true, safety_engine: true },
      toxiproxy_mode: 'real',
    },
  });
  assert.equal(readyRes.state, 'ready');
  assert.equal(readyRes.toxiproxyMode, 'real');
  assert.equal(readyRes.failingChecks.length, 0);

  // Degraded when some checks are false
  const degradedRes = deriveHealthPillState({
    data: {
      status: 'not_ready',
      checks: { database: true, rabbitmq: false, toxiproxy: false, safety_engine: true },
      toxiproxy_mode: 'simulated',
    },
  });
  assert.equal(degradedRes.state, 'degraded');
  assert.equal(degradedRes.toxiproxyMode, 'simulated');
  assert.deepEqual(degradedRes.failingChecks, ['rabbitmq', 'toxiproxy']);
  assert.ok(degradedRes.detail.includes('rabbitmq, toxiproxy'));

  // Error as string
  const stringErrRes = deriveHealthPillState({ error: 'Network timeout' });
  assert.equal(stringErrRes.state, 'unreachable');
  assert.ok(stringErrRes.detail.includes('Network timeout'));

  // Missing ID on running experiment
  const missingIdRes = canEmergencyStop({ status: 'RUNNING', id: null });
  assert.equal(missingIdRes.enabled, false);
});

test('isExperimentAlreadyEndedError classifies stop race errors correctly', () => {
  assert.equal(isExperimentAlreadyEndedError(null), false);
  assert.equal(isExperimentAlreadyEndedError(new Error('Internal server error 500')), false);
  assert.equal(isExperimentAlreadyEndedError(new Error('Database lock acquisition timeout')), false);

  assert.equal(isExperimentAlreadyEndedError(new Error('Experiment already finished')), true);
  assert.equal(isExperimentAlreadyEndedError(new Error('Experiment already ended')), true);
  assert.equal(isExperimentAlreadyEndedError(new Error('Experiment not found')), true);
  assert.equal(isExperimentAlreadyEndedError(new Error('404 Not Found')), true);
  assert.equal(isExperimentAlreadyEndedError('Experiment is not running'), true);
  assert.equal(isExperimentAlreadyEndedError('row.status not in active'), true);
});


