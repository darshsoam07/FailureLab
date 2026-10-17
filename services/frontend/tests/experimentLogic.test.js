import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePreviewSentence,
  percentToFraction,
  fractionToPercent,
  mapSnapshotsToTimeline,
  deriveConsecutiveBreaches,
  deriveExperimentEventLog,
  formatExperimentStatus,
} from '../src/lib/experimentLogic.js';

test('generatePreviewSentence builds accurate descriptions for all 4 fault types', () => {
  // 1. LATENCY
  const latencySentence = generatePreviewSentence({
    faultType: 'LATENCY',
    parameters: { latency_ms: 450, jitter_ms: 50 },
    targetService: 'inventory_service',
    durationSeconds: 60,
    sloMaxP95Ms: 500,
    sloMaxErrorRate: 0.05,
  });
  assert.equal(
    latencySentence,
    'Add 450ms (±50ms) latency to inventory_service for 60s. Abort if P95 exceeds 500ms or errors exceed 5% for 3 consecutive checks.'
  );

  // 2. TIMEOUT (indefinite drop and explicit ms)
  const timeoutZero = generatePreviewSentence({
    faultType: 'TIMEOUT',
    parameters: { timeout_ms: 0 },
    targetService: 'inventory_service',
    durationSeconds: 30,
    sloMaxP95Ms: 300,
    sloMaxErrorRate: 0.1,
  });
  assert.equal(
    timeoutZero,
    'Inject indefinite timeout drop to inventory_service for 30s. Abort if P95 exceeds 300ms or errors exceed 10% for 3 consecutive checks.'
  );

  const timeoutMs = generatePreviewSentence({
    faultType: 'TIMEOUT',
    parameters: { timeout_ms: 2500 },
    targetService: 'order_service',
    durationSeconds: 45,
  });
  assert.ok(timeoutMs.includes('Inject 2500ms timeout to order_service for 45s'));

  // 3. ERROR_RATE (http_503 and reset_peer)
  const error503 = generatePreviewSentence({
    faultType: 'ERROR_RATE',
    parameters: { mode: 'http_503', error_rate_percent: 25 },
    targetService: 'inventory_service',
    durationSeconds: 90,
  });
  assert.ok(error503.includes('Inject 25% HTTP 503 errors to inventory_service for 90s'));

  const errorReset = generatePreviewSentence({
    faultType: 'ERROR_RATE',
    parameters: { mode: 'reset_peer' },
    targetService: 'inventory_service',
  });
  assert.ok(errorReset.includes('Inject TCP connection resets to inventory_service'));

  // 4. BANDWIDTH
  const bandwidthSentence = generatePreviewSentence({
    faultType: 'BANDWIDTH',
    parameters: { rate_kbps: 15 },
    targetService: 'inventory_service',
    durationSeconds: 60,
  });
  assert.ok(bandwidthSentence.includes('Throttle bandwidth to 15 KB/s on inventory_service for 60s'));
});

test('percentToFraction and fractionToPercent conversions handle boundaries and decimals', () => {
  assert.equal(percentToFraction(5), 0.05);
  assert.equal(percentToFraction(0.5), 0.005);
  assert.equal(percentToFraction(100), 1);
  assert.equal(percentToFraction(0), 0);
  assert.equal(percentToFraction(-10), 0);
  assert.equal(percentToFraction(150), 1);

  assert.equal(fractionToPercent(0.05), 5);
  assert.equal(fractionToPercent(0.005), 0.5);
  assert.equal(fractionToPercent(1), 100);
  assert.equal(fractionToPercent(0), 0);
  assert.equal(fractionToPercent(-0.2), 0);
  assert.equal(fractionToPercent(1.5), 100);
});

test('deriveConsecutiveBreaches counts trailing consecutive breach streak accurately', () => {
  // Empty
  assert.deepEqual(deriveConsecutiveBreaches([]), { consecutiveBreaches: 0, totalBreaches: 0, isBreaching: false });

  // No breaches
  const healthy = [
    { p95_latency_ms: 100, error_rate: 0.01 },
    { p95_latency_ms: 120, error_rate: 0.02 },
  ];
  assert.deepEqual(deriveConsecutiveBreaches(healthy, 500, 0.05), {
    consecutiveBreaches: 0,
    totalBreaches: 0,
    isBreaching: false,
  });

  // Edge case: Exactly equal to threshold is NOT a breach (strict '>' in watchdog.py lines 73, 75)
  const exactThreshold = [
    { p95_latency_ms: 500.0, error_rate: 0.05 },
  ];
  assert.deepEqual(deriveConsecutiveBreaches(exactThreshold, 500, 0.05), {
    consecutiveBreaches: 0,
    totalBreaches: 0,
    isBreaching: false,
  });

  // Edge case: P95 breaches independently
  const p95BreachOnly = [
    { p95_latency_ms: 500.1, error_rate: 0.01 },
  ];
  assert.deepEqual(deriveConsecutiveBreaches(p95BreachOnly, 500, 0.05), {
    consecutiveBreaches: 1,
    totalBreaches: 1,
    isBreaching: true,
  });

  // Edge case: Error rate breaches independently
  const errorBreachOnly = [
    { p95_latency_ms: 200, error_rate: 0.0501 },
  ];
  assert.deepEqual(deriveConsecutiveBreaches(errorBreachOnly, 500, 0.05), {
    consecutiveBreaches: 1,
    totalBreaches: 1,
    isBreaching: true,
  });

  // 1 breach in middle, followed by healthy -> resets streak to 0, total is 1
  const recovered = [
    { p95_latency_ms: 600, error_rate: 0.01 },
    { p95_latency_ms: 150, error_rate: 0.01 },
  ];
  assert.deepEqual(deriveConsecutiveBreaches(recovered, 500, 0.05), {
    consecutiveBreaches: 0,
    totalBreaches: 1,
    isBreaching: false,
  });

  // 2 trailing breaches -> consecutive is 2/3
  const twoBreaches = [
    { p95_latency_ms: 100, error_rate: 0.01 },
    { p95_latency_ms: 650, error_rate: 0.01 },
    { p95_latency_ms: 700, error_rate: 0.01 },
  ];
  assert.deepEqual(deriveConsecutiveBreaches(twoBreaches, 500, 0.05), {
    consecutiveBreaches: 2,
    totalBreaches: 2,
    isBreaching: true,
  });

  // 4 trailing breaches -> capped at 3 (watchdog.py triggers abort on 3 consecutive)
  const fourBreaches = [
    { p95_latency_ms: 600, error_rate: 0.06 },
    { p95_latency_ms: 600, error_rate: 0.06 },
    { p95_latency_ms: 600, error_rate: 0.06 },
    { p95_latency_ms: 600, error_rate: 0.06 },
  ];
  assert.equal(deriveConsecutiveBreaches(fourBreaches, 500, 0.05).consecutiveBreaches, 3);
});

test('mapSnapshotsToTimeline formats timeline points for Recharts', () => {
  const snapshots = [
    { timestamp: '2026-10-18T00:00:00Z', p95_latency_ms: 124.6, error_rate: 0.02, total_requests: 10, failed_requests: 0, queue_depth: 0 },
  ];
  const points = mapSnapshotsToTimeline(snapshots);
  assert.equal(points.length, 1);
  assert.equal(points[0].p95, 124.6);
  assert.equal(points[0].errorRatePct, 2);
  assert.equal(points[0].totalRequests, 10);
});

test('deriveExperimentEventLog constructs chronological log sorted newest first', () => {
  const experiment = {
    id: 'exp-abc',
    name: 'Latency Test',
    fault_type: 'LATENCY',
    target_service: 'inventory_service',
    started_at: '2026-10-18T00:00:00Z',
    ended_at: '2026-10-18T00:01:00Z',
    status: 'COMPLETED',
    slo_max_p95_ms: 500,
    slo_max_error_rate: 0.05,
  };

  const snapshots = [
    { timestamp: '2026-10-18T00:00:10Z', p95_latency_ms: 200, error_rate: 0.01, total_requests: 20 },
    { timestamp: '2026-10-18T00:00:20Z', p95_latency_ms: 650, error_rate: 0.01, total_requests: 40 },
  ];

  const logs = deriveExperimentEventLog(experiment, snapshots);
  assert.equal(logs.length, 4); // START + 1 TELEMETRY + 1 BREACH + 1 COMPLETE
  // Newest first -> COMPLETE is at index 0
  assert.equal(logs[0].type, 'COMPLETE');
  assert.ok(logs[0].message.includes('completed successfully'));
  assert.equal(logs[1].type, 'BREACH');
  assert.ok(logs[1].message.includes('SLO breach'));
  assert.equal(logs[3].type, 'START');
});

test('formatExperimentStatus covers all backend enum values and unknown fallbacks', () => {
  // 1. RUNNING
  const running = formatExperimentStatus('RUNNING');
  assert.deepEqual(running, { label: 'RUNNING', variant: 'info', dot: true, pulse: true });

  // 2. PLANNED
  const planned = formatExperimentStatus({ status: 'PLANNED' });
  assert.deepEqual(planned, { label: 'PLANNED', variant: 'neutral', dot: true, pulse: false });

  // 3. COMPLETED (Normal)
  const completed = formatExperimentStatus({ status: 'COMPLETED', abort_reason: null });
  assert.deepEqual(completed, { label: 'COMPLETED', variant: 'healthy', dot: true, pulse: false });

  // 4. COMPLETED with MANUAL_STOP -> Manually stopped
  const manualStop = formatExperimentStatus({ status: 'COMPLETED', abort_reason: 'MANUAL_STOP' });
  assert.deepEqual(manualStop, { label: 'Manually stopped', variant: 'degraded', dot: true, pulse: false });

  // 5. Direct MANUAL_STOP status
  const manualDirect = formatExperimentStatus('MANUAL_STOP');
  assert.deepEqual(manualDirect, { label: 'Manually stopped', variant: 'degraded', dot: true, pulse: false });

  // 6. COMPLETED with exact controller abort reasons (no wildcards)
  const safetyFailure = formatExperimentStatus('COMPLETED', 'SAFETY_STOP_CONTROLLER_FAILURE');
  assert.deepEqual(safetyFailure, { label: 'CONTROLLER FAILURE STOP', variant: 'degraded', dot: true, pulse: false });

  const startupRecovery = formatExperimentStatus('COMPLETED', 'STARTUP_RECOVERY');
  assert.deepEqual(startupRecovery, { label: 'STARTUP RECOVERY STOP', variant: 'degraded', dot: true, pulse: false });

  const monitoringGap = formatExperimentStatus('COMPLETED', 'SAFETY_STOP_MONITORING_GAP');
  assert.deepEqual(monitoringGap, { label: 'MONITORING GAP STOP', variant: 'degraded', dot: true, pulse: false });

  const telemetryGap = formatExperimentStatus('COMPLETED', 'SAFETY_STOP_TELEMETRY_UNAVAILABLE: httpx.TimeoutException');
  assert.deepEqual(telemetryGap, { label: 'TELEMETRY UNAVAILABLE STOP', variant: 'degraded', dot: true, pulse: false });

  // 7. ABORTED_SLO_BREACH
  const sloAborted = formatExperimentStatus({ status: 'ABORTED_SLO_BREACH', abort_reason: 'SLO breached for 3 consecutive snapshots' });
  assert.deepEqual(sloAborted, { label: 'ABORTED (SLO BREACH)', variant: 'breached', dot: true, pulse: false });

  // 8. Unknown fallback (e.g. UNKNOWN_NEW_STATUS)
  const unknown = formatExperimentStatus('CUSTOM_EXPERIMENTAL_STATE');
  assert.deepEqual(unknown, { label: 'CUSTOM_EXPERIMENTAL_STATE', variant: 'neutral', dot: false, pulse: false });

  // 9. Null/empty fallback
  const empty = formatExperimentStatus(null);
  assert.deepEqual(empty, { label: 'UNKNOWN', variant: 'neutral', dot: false, pulse: false });
});

