/**
 * Pure logic for the Experiments page:
 * - Plain-language preview sentence builder for all 4 fault types
 * - Percent <-> fraction conversion for SLO inputs
 * - Snapshot-to-chart data point mapping
 * - Consecutive breach counting from snapshots
 * - Event log derivation from experiment and snapshots
 */

/**
 * Converts a percentage number (0-100) to a fraction (0-1).
 *
 * @param {number|string} percent
 * @returns {number}
 */
export function percentToFraction(percent) {
  const num = Number(percent);
  if (!Number.isFinite(num) || num < 0) return 0;
  if (num > 100) return 1;
  return Number((num / 100).toFixed(6));
}

/**
 * Converts a fraction (0-1) to a percentage number (0-100).
 *
 * @param {number|string} fraction
 * @returns {number}
 */
export function fractionToPercent(fraction) {
  const num = Number(fraction);
  if (!Number.isFinite(num) || num < 0) return 0;
  if (num > 1) return 100;
  return Number((num * 100).toFixed(4));
}

/**
 * Generates a human-readable preview sentence for an experiment configuration.
 *
 * @param {Object} params
 * @param {'LATENCY'|'TIMEOUT'|'ERROR_RATE'|'BANDWIDTH'} params.faultType
 * @param {Object} [params.parameters={}]
 * @param {string} [params.targetService='inventory_service']
 * @param {number} [params.durationSeconds=60]
 * @param {number} [params.sloMaxP95Ms=500]
 * @param {number} [params.sloMaxErrorRate=0.05] - Expressed as fraction (0-1) or percent (0-100)
 * @returns {string} Plain-language preview sentence
 */
export function generatePreviewSentence({
  faultType,
  parameters = {},
  targetService = 'inventory_service',
  durationSeconds = 60,
  sloMaxP95Ms = 500,
  sloMaxErrorRate = 0.05,
}) {
  const target = targetService || 'inventory_service';
  const duration = durationSeconds ?? 60;
  const p95 = sloMaxP95Ms ?? 500;

  // Normalize error rate to percent string
  const errorPct = sloMaxErrorRate > 1
    ? sloMaxErrorRate
    : Number((sloMaxErrorRate * 100).toFixed(1));

  let faultAction = '';
  switch (faultType) {
    case 'LATENCY': {
      const lat = parameters.latency_ms ?? 450;
      const jit = parameters.jitter_ms ?? 50;
      faultAction = `Add ${lat}ms (±${jit}ms) latency to ${target}`;
      break;
    }
    case 'TIMEOUT': {
      const timeout = parameters.timeout_ms ?? 0;
      faultAction = timeout === 0
        ? `Inject indefinite timeout drop to ${target}`
        : `Inject ${timeout}ms timeout to ${target}`;
      break;
    }
    case 'ERROR_RATE': {
      const mode = parameters.mode ?? 'http_503';
      const pct = parameters.error_rate_percent ?? 25;
      faultAction = mode === 'reset_peer'
        ? `Inject TCP connection resets to ${target}`
        : `Inject ${pct}% HTTP 503 errors to ${target}`;
      break;
    }
    case 'BANDWIDTH': {
      const rate = parameters.rate_kbps ?? 10;
      faultAction = `Throttle bandwidth to ${rate} KB/s on ${target}`;
      break;
    }
    default:
      faultAction = `Inject ${faultType} fault to ${target}`;
      break;
  }

  return `${faultAction} for ${duration}s. Abort if P95 exceeds ${p95}ms or errors exceed ${errorPct}% for 3 consecutive checks.`;
}

/**
 * Maps raw backend TelemetrySnapshot rows to Recharts timeline points.
 *
 * @param {Array<Object>} [snapshots=[]]
 * @returns {Array<Object>}
 */
export function mapSnapshotsToTimeline(snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return [];

  return snapshots.map((s, index) => {
    const ts = new Date(s.timestamp).getTime();
    return {
      index: index + 1,
      timestamp: Number.isFinite(ts) ? ts : Date.now(),
      p95: typeof s.p95_latency_ms === 'number' && Number.isFinite(s.p95_latency_ms)
        ? Number(s.p95_latency_ms.toFixed(1))
        : 0,
      errorRatePct: typeof s.error_rate === 'number' && Number.isFinite(s.error_rate)
        ? Number((s.error_rate * 100).toFixed(2))
        : 0,
      totalRequests: s.total_requests ?? 0,
      failedRequests: s.failed_requests ?? 0,
      queueDepth: s.queue_depth ?? 0,
    };
  });
}

/**
 * Derives consecutive breach count from snapshots based on active SLO thresholds.
 * Evaluates in chronological order and checks trailing streak.
 *
 * @param {Array<Object>} [snapshots=[]]
 * @param {number} [sloMaxP95Ms=500]
 * @param {number} [sloMaxErrorRate=0.05] - 0-1 fraction
 * @returns {{ consecutiveBreaches: number, totalBreaches: number, isBreaching: boolean }}
 */
export function deriveConsecutiveBreaches(snapshots = [], sloMaxP95Ms = 500, sloMaxErrorRate = 0.05) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return { consecutiveBreaches: 0, totalBreaches: 0, isBreaching: false };
  }

  const p95Ceiling = typeof sloMaxP95Ms === 'number' ? sloMaxP95Ms : 500;
  const errorCeiling = typeof sloMaxErrorRate === 'number' ? sloMaxErrorRate : 0.05;

  let totalBreaches = 0;
  const breachFlags = snapshots.map(s => {
    const isP95Breach = typeof s.p95_latency_ms === 'number' && s.p95_latency_ms > p95Ceiling;
    const isErrorBreach = typeof s.error_rate === 'number' && s.error_rate > errorCeiling;
    const breached = isP95Breach || isErrorBreach;
    if (breached) totalBreaches += 1;
    return breached;
  });

  // Calculate trailing consecutive breaches from the most recent snapshot backwards
  let consecutiveBreaches = 0;
  for (let i = breachFlags.length - 1; i >= 0; i--) {
    if (breachFlags[i]) {
      consecutiveBreaches += 1;
    } else {
      break;
    }
  }

  return {
    consecutiveBreaches: Math.min(3, consecutiveBreaches),
    totalBreaches,
    isBreaching: consecutiveBreaches > 0,
  };
}

/**
 * Derives a human-readable chronological event log from an experiment and its snapshots.
 * Returns events sorted newest first.
 *
 * @param {Object} experiment
 * @param {Array<Object>} [snapshots=[]]
 * @returns {Array<{ id: string, timestamp: number, type: string, message: string, level: string }>}
 */
export function deriveExperimentEventLog(experiment, snapshots = []) {
  if (!experiment) return [];

  const events = [];

  // 1. Experiment Started Event
  const startTs = experiment.started_at
    ? new Date(experiment.started_at).getTime()
    : Date.now();

  events.push({
    id: `start-${experiment.id}`,
    timestamp: startTs,
    type: 'START',
    message: `Experiment started: ${experiment.name} targeting ${experiment.target_service} (${experiment.fault_type})`,
    level: 'info',
  });

  // 2. Snapshot & Breach Events
  const p95Ceiling = experiment.slo_max_p95_ms ?? 500;
  const errorCeiling = experiment.slo_max_error_rate ?? 0.05;

  if (Array.isArray(snapshots)) {
    snapshots.forEach((snap, idx) => {
      const snapTs = new Date(snap.timestamp).getTime();
      const p95 = typeof snap.p95_latency_ms === 'number' ? snap.p95_latency_ms.toFixed(1) : '0';
      const errPct = typeof snap.error_rate === 'number' ? (snap.error_rate * 100).toFixed(1) : '0';

      const isP95Breach = snap.p95_latency_ms > p95Ceiling;
      const isErrorBreach = snap.error_rate > errorCeiling;

      if (isP95Breach || isErrorBreach) {
        const breachDetails = [];
        if (isP95Breach) breachDetails.push(`P95 ${p95}ms > ${p95Ceiling}ms`);
        if (isErrorBreach) breachDetails.push(`Error rate ${errPct}% > ${(errorCeiling * 100).toFixed(1)}%`);

        events.push({
          id: `breach-${idx}-${snapTs}`,
          timestamp: snapTs,
          type: 'BREACH',
          message: `SLO breach detected in snapshot #${idx + 1}: ${breachDetails.join(', ')}`,
          level: 'error',
        });
      } else {
        events.push({
          id: `snap-${idx}-${snapTs}`,
          timestamp: snapTs,
          type: 'TELEMETRY',
          message: `Snapshot #${idx + 1}: P95 ${p95}ms, Error rate ${errPct}%, Requests ${snap.total_requests ?? 0}`,
          level: 'info',
        });
      }
    });
  }

  // 3. Experiment Ended Event (if finished or aborted)
  if (experiment.ended_at || ['COMPLETED', 'ABORTED_SLO_BREACH'].includes(experiment.status)) {
    const endTs = experiment.ended_at
      ? new Date(experiment.ended_at).getTime()
      : Date.now();

    const isAborted = experiment.status === 'ABORTED_SLO_BREACH' || Boolean(experiment.abort_reason);

    events.push({
      id: `end-${experiment.id}`,
      timestamp: endTs,
      type: isAborted ? 'ABORT' : 'COMPLETE',
      message: isAborted
        ? `Experiment aborted (${experiment.status})${experiment.abort_reason ? ': ' + experiment.abort_reason : ''}`
        : `Experiment completed successfully (${experiment.status})`,
      level: isAborted ? 'error' : 'success',
    });
  }

  // Sort newest first
  return events.sort((a, b) => b.timestamp - a.timestamp);
}
