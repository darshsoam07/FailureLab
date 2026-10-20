import { FAULT_LABELS } from '../api/experiments.js';
import { formatExperimentStatus } from './experimentLogic.js';

/**
 * Pure logic for Reports & Audit page:
 * - KPI calculations from loaded data only
 * - Status filtering and chronological sorting for the loaded page
 * - Row data mapping from ExperimentResponse API shape
 * - AI Report metadata extraction (unmeasured callouts, report source)
 * - Heuristic confidence formatting
 * - Export JSON payload builder (no env values or secrets)
 */

/**
 * Computes summary KPIs from loaded experiments array only.
 * Reuses formatExperimentStatus so tables, badges, and KPIs share single classification truth.
 * No resilience score, MTTR, or invented metrics.
 *
 * @param {Array<Object>} experiments
 * @returns {{ loadedCount: number, completedCount: number, abortedSloCount: number, manuallyStoppedCount: number }}
 */
export function calculateReportsKpis(experiments = []) {
  if (!Array.isArray(experiments)) {
    return { loadedCount: 0, completedCount: 0, abortedSloCount: 0, manuallyStoppedCount: 0 };
  }

  let completedCount = 0;
  let abortedSloCount = 0;
  let manuallyStoppedCount = 0;

  for (const exp of experiments) {
    if (!exp) continue;
    const { label } = formatExperimentStatus(exp.status, exp.abort_reason);

    if (label === 'Manually stopped') {
      manuallyStoppedCount += 1;
    } else if (label === 'ABORTED (SLO BREACH)') {
      abortedSloCount += 1;
    } else if (label === 'COMPLETED') {
      completedCount += 1;
    }
  }

  return {
    loadedCount: experiments.length,
    completedCount,
    abortedSloCount,
    manuallyStoppedCount,
  };
}

/**
 * Pure pagination helper for limit/offset without implying a total.
 * A page with fewer items than limit is treated as the last page.
 *
 * @param {Object} options
 * @param {number} [options.offset=0]
 * @param {number} [options.limit=10]
 * @param {number} [options.currentCount=0]
 * @returns {{ page: number, pageLabel: string, hasPrev: boolean, hasNext: boolean, prevOffset: number, nextOffset: number }}
 */
export function calculatePagination({ offset = 0, limit = 10, currentCount = 0 } = {}) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(1, Number(limit) || 10);
  const page = Math.floor(safeOffset / safeLimit) + 1;
  const hasPrev = safeOffset > 0;
  // A page with fewer items than the requested limit is the last page
  const hasNext = currentCount >= safeLimit;
  const prevOffset = Math.max(0, safeOffset - safeLimit);
  const nextOffset = safeOffset + safeLimit;

  return {
    page,
    pageLabel: `Page ${page}`,
    hasPrev,
    hasNext,
    prevOffset,
    nextOffset,
  };
}

/**
 * Filters and sorts the loaded page of experiments.
 * Explicitly scoped to the loaded page.
 *
 * @param {Array<Object>} experiments
 * @param {Object} options
 * @param {string} [options.statusFilter='all'] - 'all' | 'COMPLETED' | 'ABORTED_SLO_BREACH' | 'MANUAL_STOP' | 'RUNNING'
 * @param {'desc'|'asc'} [options.sortDirection='desc'] - Newest first ('desc') or oldest first ('asc')
 * @returns {Array<Object>}
 */
export function filterAndSortExperiments(experiments = [], { statusFilter = 'all', sortDirection = 'desc' } = {}) {
  if (!Array.isArray(experiments)) return [];

  let filtered = [...experiments];

  if (statusFilter && statusFilter !== 'all') {
    const filterKey = statusFilter.toUpperCase();
    filtered = filtered.filter(exp => {
      const { label } = formatExperimentStatus(exp?.status, exp?.abort_reason);

      if (filterKey === 'MANUAL_STOP') {
        return label === 'Manually stopped';
      }
      if (filterKey === 'COMPLETED') {
        return label === 'COMPLETED';
      }
      if (filterKey === 'ABORTED_SLO_BREACH' || filterKey === 'ABORTED') {
        return label === 'ABORTED (SLO BREACH)';
      }
      if (filterKey === 'RUNNING') {
        return label === 'RUNNING';
      }
      return String(exp?.status || '').toUpperCase() === filterKey;
    });
  }

  filtered.sort((a, b) => {
    const timeA = a?.started_at ? new Date(a.started_at).getTime() : 0;
    const timeB = b?.started_at ? new Date(b.started_at).getTime() : 0;
    return sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
  });

  return filtered;
}

/**
 * Formats an individual experiment response row for table display.
 * Peak P95 is calculated ONLY if selectedDetail matches; otherwise '-', avoiding N+1 calls.
 *
 * @param {Object} experiment
 * @param {Object|null} [selectedDetail=null]
 * @returns {Object}
 */
export function formatRowData(experiment, selectedDetail = null) {
  if (!experiment) return null;

  const id = String(experiment.id || '');
  const shortId = id.length > 8 ? `${id.slice(0, 8)}…` : id;
  const faultType = experiment.fault_type || 'UNKNOWN';
  const faultLabel = FAULT_LABELS[faultType] || faultType;

  // Format start time
  let startedFormatted = '-';
  if (experiment.started_at) {
    const d = new Date(experiment.started_at);
    if (Number.isFinite(d.getTime())) {
      startedFormatted = d.toISOString().replace('T', ' ').slice(0, 19);
    }
  }

  // Format duration
  let durationFormatted = '-';
  const plannedSec = experiment.parameters?.duration_seconds ?? 60;
  if (experiment.started_at && experiment.ended_at) {
    const s = new Date(experiment.started_at).getTime();
    const e = new Date(experiment.ended_at).getTime();
    if (Number.isFinite(s) && Number.isFinite(e)) {
      const sec = Math.max(0, Math.floor((e - s) / 1000));
      durationFormatted = `${sec}s`;
    }
  } else if (experiment.status === 'RUNNING') {
    durationFormatted = 'In progress';
  } else if (plannedSec) {
    durationFormatted = `${plannedSec}s (planned)`;
  }

  // Peak P95: Only computed if selectedDetail matches this experiment's ID; no N+1 fetch.
  let peakP95 = '-';
  if (selectedDetail && selectedDetail.id === experiment.id && Array.isArray(selectedDetail.telemetry_snapshots)) {
    const snapshots = selectedDetail.telemetry_snapshots;
    if (snapshots.length > 0) {
      const maxVal = snapshots.reduce((acc, snap) => {
        const val = Number(snap.p95_latency_ms);
        return Number.isFinite(val) ? Math.max(acc, val) : acc;
      }, 0);
      peakP95 = `${maxVal.toFixed(1)}ms`;
    }
  }

  const statusBadge = formatExperimentStatus(experiment);

  return {
    id,
    shortId,
    name: experiment.name || 'Unnamed Experiment',
    faultType,
    faultLabel,
    targetService: experiment.target_service || 'inventory_service',
    startedFormatted,
    durationFormatted,
    peakP95,
    statusBadge,
    raw: experiment,
  };
}

/**
 * Formats a 0.0 - 1.0 confidence score into an integer percentage.
 *
 * @param {number|null|undefined} score
 * @returns {number} 0 - 100
 */
export function formatConfidence(score) {
  const num = Number(score);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (num >= 1) return 100;
  return Math.round(num * 100);
}

/**
 * Extracts AI Post-Mortem metadata:
 * - Unmeasured behavior alerts (e.g. unconfirmed retry amplification or circuit-breaker trips)
 * - Verified report source tag if present (e.g. mock vs live LLM provider)
 * - Regular bullet points
 *
 * @param {Object|null} aiReport
 * @returns {{ isUnconfirmed: boolean, unconfirmedText: string|null, reportSource: string|null, regularBullets: Array<string> }}
 */
export function extractReportMeta(aiReport) {
  if (!aiReport) {
    return {
      isUnconfirmed: false,
      unconfirmedText: null,
      reportSource: null,
      regularBullets: [],
    };
  }

  let isUnconfirmed = false;
  let unconfirmedText = null;
  let reportSource = null;
  const regularBullets = [];
  const bullets = Array.isArray(aiReport.evidence_bullets) ? aiReport.evidence_bullets : [];

  for (const bullet of bullets) {
    if (typeof bullet !== 'string') continue;

    const lower = bullet.toLowerCase();
    const mentionsResilience = lower.includes('circuit-breaker') || lower.includes('circuit breaker') || lower.includes('retry');
    const mentionsUnmeasured = lower.includes('not measured') || lower.includes('unmeasured') ||
      lower.includes('cannot be confirmed') || lower.includes('unconfirmed') || lower.includes('not proof');

    // Show report's own wording verbatim wherever it states retry/circuit-breaker behavior is unmeasured/unconfirmed
    if (mentionsResilience && mentionsUnmeasured && !unconfirmedText) {
      isUnconfirmed = true;
      unconfirmedText = bullet;
      continue;
    }

    // Check for analysis mode / report source
    if (bullet.startsWith('Analysis mode:')) {
      const rawMode = bullet.replace('Analysis mode:', '').trim().replace(/\.$/, '');
      if (rawMode.toLowerCase().includes('live')) {
        reportSource = 'Live Structured-Output LLM';
      } else if (rawMode.toLowerCase().includes('heuristic') || rawMode.toLowerCase().includes('deterministic')) {
        reportSource = 'Deterministic Local Heuristics';
      } else {
        reportSource = rawMode;
      }
      continue;
    }

    regularBullets.push(bullet);
  }

  // Fallback check on root_cause_summary if not already in bullets
  if (!unconfirmedText && typeof aiReport.root_cause_summary === 'string') {
    const summary = aiReport.root_cause_summary;
    const lowerSummary = summary.toLowerCase();
    if (
      (lowerSummary.includes('circuit-breaker') || lowerSummary.includes('circuit breaker') || lowerSummary.includes('retry')) &&
      (lowerSummary.includes('not proof') || lowerSummary.includes('cannot attribute') || lowerSummary.includes('unconfirmed') || lowerSummary.includes('not measured'))
    ) {
      isUnconfirmed = true;
      unconfirmedText = summary;
    }
  }

  return {
    isUnconfirmed,
    unconfirmedText,
    reportSource,
    regularBullets,
  };
}

/**
 * Builds a clean JSON export payload containing ONLY fields returned by the backend API.
 * Contains no secrets, internal URLs, or env configurations.
 *
 * @param {Object} options
 * @param {Object} options.experiment - The Experiment or ExperimentDetail
 * @param {Array<Object>} [options.snapshots] - Telemetry snapshots if detail loaded
 * @param {Object|null} [options.aiReport] - AI Report if available
 * @returns {{ filename: string, jsonString: string }}
 */
export function buildExportJson({ experiment, snapshots = [], aiReport = null }) {
  if (!experiment || !experiment.id) {
    throw new Error('Experiment is required for export.');
  }

  const exportPayload = {
    export_metadata: {
      generated_at: new Date().toISOString(),
      schema_version: '1.0',
      source: 'FailureLab SRE Console',
    },
    experiment: {
      id: experiment.id,
      name: experiment.name,
      fault_type: experiment.fault_type,
      target_service: experiment.target_service,
      parameters: experiment.parameters,
      slo_max_p95_ms: experiment.slo_max_p95_ms,
      slo_max_error_rate: experiment.slo_max_error_rate,
      status: experiment.status,
      abort_reason: experiment.abort_reason ?? null,
      started_at: experiment.started_at ?? null,
      ended_at: experiment.ended_at ?? null,
    },
    telemetry_snapshots: snapshots.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      total_requests: s.total_requests,
      failed_requests: s.failed_requests,
      error_rate: s.error_rate,
      p95_latency_ms: s.p95_latency_ms,
      queue_depth: s.queue_depth,
    })),
    ai_report: aiReport
      ? {
          id: aiReport.id,
          root_cause_summary: aiReport.root_cause_summary,
          confidence_score: aiReport.confidence_score,
          evidence_bullets: aiReport.evidence_bullets,
          recommended_fix: aiReport.recommended_fix,
          next_experiment_proposal: aiReport.next_experiment_proposal,
          created_at: aiReport.created_at,
        }
      : null,
  };

  const filename = `failurelab-experiment-${experiment.id}.json`;
  const jsonString = JSON.stringify(exportPayload, null, 2);

  return { filename, jsonString };
}
