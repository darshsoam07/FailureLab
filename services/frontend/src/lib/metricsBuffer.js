/**
 * In-memory rolling telemetry buffer and metrics formatting utilities.
 */

export const BUFFER_CAPACITY = 90; // ~3 minutes of history at 2s polling interval

/**
 * Appends a new metrics sample to the rolling buffer.
 * Rules:
 * - Caps at BUFFER_CAPACITY samples.
 * - Skips failed/empty polls (returns current buffer unchanged).
 * - Never appends null or missing metrics as 0.
 *
 * @param {Array<Object>} [buffer=[]]
 * @param {Object|null} [metrics=null] - Payload from /api/orders/metrics-summary
 * @param {number} [timestamp=Date.now()]
 * @returns {Array<Object>} New buffer array
 */
export function appendMetricsPoint(buffer = [], metrics = null, timestamp = Date.now()) {
  const current = Array.isArray(buffer) ? buffer : [];

  // Skip failed polls or invalid payloads
  if (!metrics || typeof metrics !== 'object') {
    return current;
  }

  const p95 = metrics.p95_latency_ms;
  if (typeof p95 !== 'number' || !Number.isFinite(p95) || p95 < 0) {
    // Missing or invalid latency sample: do NOT coerce to 0
    return current;
  }

  const errorRate = typeof metrics.error_rate === 'number' && Number.isFinite(metrics.error_rate)
    ? Math.max(0, Math.min(1, metrics.error_rate))
    : null;

  const newPoint = {
    timestamp,
    p95: Number(p95.toFixed(1)),
    errorRate,
    succeeded: Number(metrics.succeeded ?? 0),
    totalOrders: Number(metrics.total_orders ?? 0),
  };

  return [...current, newPoint].slice(-BUFFER_CAPACITY);
}

/**
 * Converts a 0–1 fraction into a formatted percentage string.
 * Returns '-' for unknown or invalid inputs (never falsy 0%).
 *
 * @param {number|null|undefined} fraction - Number between 0 and 1
 * @param {number} [decimals=2]
 * @returns {string} e.g. "4.50%" or "-"
 */
export function formatPercent(fraction, decimals = 2) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0) {
    return '—';
  }
  const pct = fraction * 100;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Derives the breach zone parameters for Recharts ReferenceArea shading.
 *
 * @param {Object} params
 * @param {number|null} params.p95 - Current P95 latency in ms
 * @param {number|null} params.sloMaxP95Ms - SLO threshold in ms
 * @param {number} [params.maxY=600] - Ceiling for chart Y domain
 * @returns {{ isBreached: boolean, y1: number|null, y2: number|null }}
 */
export function deriveBreachZone({ p95, sloMaxP95Ms, maxY = 600 } = {}) {
  const threshold = typeof sloMaxP95Ms === 'number' && Number.isFinite(sloMaxP95Ms) && sloMaxP95Ms > 0
    ? sloMaxP95Ms
    : null;

  if (threshold === null) {
    return { isBreached: false, y1: null, y2: null };
  }

  const currentP95 = typeof p95 === 'number' && Number.isFinite(p95) ? p95 : 0;
  const isBreached = currentP95 > threshold;

  const topY = Math.max(maxY, threshold * 1.25, currentP95 * 1.1);

  return {
    isBreached,
    y1: threshold,
    y2: Number(topY.toFixed(0)),
  };
}

/**
 * Extracts a numeric array series from the rolling buffer for sparklines.
 *
 * @param {Array<Object>} buffer
 * @param {'p95'|'errorRate'} [key='p95']
 * @returns {number[]} Array of finite numbers
 */
export function extractSparklineSeries(buffer, key = 'p95') {
  if (!Array.isArray(buffer) || buffer.length === 0) return [];

  return buffer
    .map(point => point[key])
    .filter(val => typeof val === 'number' && Number.isFinite(val));
}
