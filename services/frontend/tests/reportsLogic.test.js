import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateReportsKpis,
  filterAndSortExperiments,
  formatRowData,
  formatConfidence,
  extractReportMeta,
  buildExportJson,
} from '../src/lib/reportsLogic.js';

test('calculateReportsKpis counts strictly from loaded experiments without invented metrics', () => {
  // Empty
  assert.deepEqual(calculateReportsKpis([]), {
    loadedCount: 0,
    completedCount: 0,
    abortedSloCount: 0,
    manuallyStoppedCount: 0,
  });

  // Mixed experiments
  const experiments = [
    { id: '1', status: 'COMPLETED', abort_reason: null },
    { id: '2', status: 'COMPLETED', abort_reason: null },
    { id: '3', status: 'ABORTED_SLO_BREACH', abort_reason: 'SLO breached for 3 consecutive snapshots' },
    { id: '4', status: 'COMPLETED', abort_reason: 'MANUAL_STOP' },
    { id: '5', status: 'MANUAL_STOP', abort_reason: null },
    { id: '6', status: 'RUNNING', abort_reason: null },
  ];

  const kpis = calculateReportsKpis(experiments);
  assert.equal(kpis.loadedCount, 6);
  assert.equal(kpis.completedCount, 2); // only normal completions
  assert.equal(kpis.abortedSloCount, 1);
  assert.equal(kpis.manuallyStoppedCount, 2); // 1 via abort_reason, 1 via status
});

test('filterAndSortExperiments filters loaded page and sorts chronologically', () => {
  const experiments = [
    { id: '1', status: 'COMPLETED', abort_reason: null, started_at: '2026-10-18T00:00:10Z' },
    { id: '2', status: 'ABORTED_SLO_BREACH', abort_reason: null, started_at: '2026-10-18T00:00:20Z' },
    { id: '3', status: 'COMPLETED', abort_reason: 'MANUAL_STOP', started_at: '2026-10-18T00:00:30Z' },
    { id: '4', status: 'RUNNING', abort_reason: null, started_at: '2026-10-18T00:00:40Z' },
  ];

  // 1. Filter by COMPLETED (excludes MANUAL_STOP)
  const completed = filterAndSortExperiments(experiments, { statusFilter: 'COMPLETED' });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, '1');

  // 2. Filter by MANUAL_STOP
  const manual = filterAndSortExperiments(experiments, { statusFilter: 'MANUAL_STOP' });
  assert.equal(manual.length, 1);
  assert.equal(manual[0].id, '3');

  // 3. Filter by ABORTED_SLO_BREACH
  const aborted = filterAndSortExperiments(experiments, { statusFilter: 'ABORTED_SLO_BREACH' });
  assert.equal(aborted.length, 1);
  assert.equal(aborted[0].id, '2');

  // 4. Sort order: desc (newest first)
  const desc = filterAndSortExperiments(experiments, { statusFilter: 'all', sortDirection: 'desc' });
  assert.equal(desc[0].id, '4');
  assert.equal(desc[desc.length - 1].id, '1');

  // 5. Sort order: asc (oldest first)
  const asc = filterAndSortExperiments(experiments, { statusFilter: 'all', sortDirection: 'asc' });
  assert.equal(asc[0].id, '1');
  assert.equal(asc[asc.length - 1].id, '4');
});

test('formatRowData maps row and computes peak P95 only for selectedDetail without N+1 fetch', () => {
  const exp = {
    id: '12345678-abcd-ef01-2345-6789abcdef01',
    name: 'Inventory Latency Test',
    fault_type: 'LATENCY',
    target_service: 'inventory_service',
    started_at: '2026-10-18T00:00:00Z',
    ended_at: '2026-10-18T00:01:00Z',
    parameters: { duration_seconds: 60 },
    status: 'COMPLETED',
    abort_reason: null,
  };

  // Unselected row -> peak P95 is '-'
  const unselectedRow = formatRowData(exp, null);
  assert.equal(unselectedRow.id, exp.id);
  assert.equal(unselectedRow.shortId, '12345678…');
  assert.equal(unselectedRow.peakP95, '-');
  assert.equal(unselectedRow.durationFormatted, '60s');
  assert.equal(unselectedRow.faultLabel, 'Latency Spike');
  assert.equal(unselectedRow.statusBadge.label, 'COMPLETED');

  // Selected row with detail containing snapshots -> peak P95 computed
  const selectedDetail = {
    id: exp.id,
    telemetry_snapshots: [
      { p95_latency_ms: 120.5 },
      { p95_latency_ms: 489.2 },
      { p95_latency_ms: 210.0 },
    ],
  };

  const selectedRow = formatRowData(exp, selectedDetail);
  assert.equal(selectedRow.peakP95, '489.2ms');
});

test('formatConfidence safely converts 0-1 scores to rounded percentages', () => {
  assert.equal(formatConfidence(0.85), 85);
  assert.equal(formatConfidence(0.504), 50);
  assert.equal(formatConfidence(1), 100);
  assert.equal(formatConfidence(0), 0);
  assert.equal(formatConfidence(null), 0);
  assert.equal(formatConfidence(undefined), 0);
  assert.equal(formatConfidence(-0.5), 0);
  assert.equal(formatConfidence(1.5), 100);
});

test('extractReportMeta separates unconfirmed circuit-breaker text and detects report source', () => {
  const aiReport = {
    evidence_bullets: [
      'First snapshot p95_latency_ms=120ms',
      'Retry count and circuit-breaker state/transitions are not measured by TelemetrySnapshot; retry amplification or breaker activation cannot be confirmed from this timeline.',
      'Maximum recorded P95 latency=620ms',
      'Analysis mode: live structured-output provider.',
    ],
  };

  const meta = extractReportMeta(aiReport);
  assert.equal(meta.isUnconfirmed, true);
  assert.ok(meta.unconfirmedText.includes('cannot be confirmed'));
  assert.equal(meta.reportSource, 'Live Structured-Output LLM');
  assert.equal(meta.regularBullets.length, 2);
  assert.equal(meta.regularBullets[0], 'First snapshot p95_latency_ms=120ms');

  // Test missing or empty report
  assert.deepEqual(extractReportMeta(null), {
    isUnconfirmed: false,
    unconfirmedText: null,
    reportSource: null,
    regularBullets: [],
  });
});

test('buildExportJson produces compliant export payload with experiment ID filename', () => {
  const exp = {
    id: 'exp-999',
    name: 'Timeout Drill',
    fault_type: 'TIMEOUT',
    target_service: 'inventory_service',
    parameters: { timeout_ms: 2000 },
    slo_max_p95_ms: 500,
    slo_max_error_rate: 0.05,
    status: 'COMPLETED',
    abort_reason: null,
    started_at: '2026-10-18T00:00:00Z',
    ended_at: '2026-10-18T00:01:00Z',
  };

  const snapshots = [
    { id: 's1', timestamp: '2026-10-18T00:00:10Z', total_requests: 10, failed_requests: 0, error_rate: 0, p95_latency_ms: 100, queue_depth: 0 },
  ];

  const aiReport = {
    id: 'r1',
    root_cause_summary: 'Target timeout caused client retry storm',
    confidence_score: 0.8,
    evidence_bullets: ['Snapshot 1 at 100ms'],
    recommended_fix: 'Tune client deadline to 1.5s',
    next_experiment_proposal: { fault_type: 'LATENCY', suggested_parameters: { latency_ms: 200 } },
    created_at: '2026-10-18T00:01:05Z',
  };

  const { filename, jsonString } = buildExportJson({ experiment: exp, snapshots, aiReport });
  assert.equal(filename, 'failurelab-experiment-exp-999.json');

  const parsed = JSON.parse(jsonString);
  assert.equal(parsed.experiment.id, 'exp-999');
  assert.equal(parsed.telemetry_snapshots.length, 1);
  assert.equal(parsed.ai_report.confidence_score, 0.8);
  // Contains no secrets or env values
  assert.equal(parsed.env, undefined);
  assert.equal(parsed.api_url, undefined);
});
