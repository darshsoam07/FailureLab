import React from 'react';
import { KpiCard } from '../common/KpiCard.jsx';
import { formatPercent, extractSparklineSeries } from '../../lib/metricsBuffer.js';

/**
 * KPI metric card row adhering to FailureLab requirements:
 * - P95 Latency with rolling sparkline and conditional SLO ceiling (ONLY when running)
 * - Error rate (% converted from fraction) with rolling sparkline
 * - Honest "Orders (last 60s)" count (no fake per-second rate, no sparkline)
 * - Orders Reserved count (no sparkline)
 * - Honest '-' empty states; never coereces unknown to 0.
 *
 * @param {Object} props
 * @param {Object|null} props.metrics - Latest metrics-summary object
 * @param {Object|null} props.experiment - Running experiment object (if any)
 * @param {Array<Object>} props.buffer - Rolling telemetry samples buffer
 */
export function DashboardKpiRow({ metrics, experiment, buffer }) {
  const isRunning = experiment?.status === 'RUNNING';
  const hasMetrics = metrics !== null && typeof metrics === 'object';

  // 1. P95 Latency Card State
  const p95Val = hasMetrics && typeof metrics.p95_latency_ms === 'number'
    ? Math.round(metrics.p95_latency_ms)
    : null;

  const sloMaxP95 = isRunning && typeof experiment.slo_max_p95_ms === 'number'
    ? experiment.slo_max_p95_ms
    : null;

  const isP95Breached = isRunning && sloMaxP95 !== null && p95Val !== null && p95Val > sloMaxP95;
  const isP95Degraded = isRunning && p95Val !== null && p95Val >= 250;

  const p95Status = !hasMetrics
    ? 'neutral'
    : isP95Breached
    ? 'breached'
    : isP95Degraded
    ? 'degraded'
    : 'healthy';

  const p95Subtitle = isRunning && sloMaxP95 !== null
    ? `SLO ceiling ${sloMaxP95}ms`
    : 'last 60s (server window)';

  const p95Badge = !hasMetrics
    ? 'UNKNOWN'
    : isP95Breached
    ? 'Above SLO ceiling (dashboard view)'
    : isP95Degraded
    ? 'DEGRADED'
    : 'HEALTHY';

  // 2. Error Rate Card State
  const errorRateVal = hasMetrics && typeof metrics.error_rate === 'number'
    ? metrics.error_rate
    : null;

  const sloMaxError = isRunning && typeof experiment.slo_max_error_rate === 'number'
    ? experiment.slo_max_error_rate
    : null;

  const isErrorBreached = isRunning && sloMaxError !== null && errorRateVal !== null && errorRateVal > sloMaxError;
  const isErrorDegraded = errorRateVal !== null && errorRateVal > 0.05;

  const errorStatus = !hasMetrics
    ? 'neutral'
    : isErrorBreached
    ? 'breached'
    : isErrorDegraded
    ? 'degraded'
    : 'healthy';

  const errorSubtitle = isRunning && sloMaxError !== null
    ? `SLO ceiling ${formatPercent(sloMaxError, 1)}`
    : 'last 60s (server window)';

  const errorBadge = !hasMetrics
    ? 'UNKNOWN'
    : isErrorBreached
    ? 'Above SLO ceiling (dashboard view)'
    : isErrorDegraded
    ? 'WARNING'
    : 'STEADY';

  // Extract sparklines from rolling buffer (only for P95 and Error Rate)
  const p95Sparkline = extractSparklineSeries(buffer, 'p95');
  const errorSparkline = extractSparklineSeries(buffer, 'errorRate');

  // 3. Orders (last 60s) State
  const totalOrders = hasMetrics && typeof metrics.total_orders === 'number'
    ? metrics.total_orders
    : null;

  // 4. Orders Reserved State
  const succeededOrders = hasMetrics && typeof metrics.succeeded === 'number'
    ? metrics.succeeded
    : null;

  return (
    <section
      aria-label="Key Performance Indicators"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      {/* KPI 1: P95 Latency */}
      <KpiCard
        title="P95 LATENCY"
        value={p95Val !== null ? p95Val : '—'}
        unit={p95Val !== null ? 'ms' : undefined}
        subtitle={p95Subtitle}
        status={p95Status}
        badgeLabel={p95Badge}
        sparklineData={p95Sparkline}
        sparklineColor={isP95Breached ? 'var(--destructive)' : isP95Degraded ? 'var(--warning)' : 'var(--accent-ink)'}
      />

      {/* KPI 2: Error Rate */}
      <KpiCard
        title="ERROR RATE"
        value={errorRateVal !== null ? formatPercent(errorRateVal, 2).replace('%', '') : '—'}
        unit={errorRateVal !== null ? '%' : undefined}
        subtitle={errorSubtitle}
        status={errorStatus}
        badgeLabel={errorBadge}
        sparklineData={errorSparkline}
        sparklineColor="var(--simulated)"
      />

      {/* KPI 3: Orders in last 60s (honest count, NO sparkline) */}
      <KpiCard
        title="ORDERS (LAST 60S)"
        value={totalOrders !== null ? totalOrders.toLocaleString() : '—'}
        unit={totalOrders !== null ? 'orders' : undefined}
        subtitle="in 60s window"
        status={totalOrders !== null ? (totalOrders > 0 ? 'healthy' : 'neutral') : 'neutral'}
        badgeLabel={totalOrders !== null ? (totalOrders > 0 ? 'LOAD OPTIMAL' : 'IDLE') : 'UNKNOWN'}
      />

      {/* KPI 4: Orders Reserved (fulfilled count, NO sparkline) */}
      <KpiCard
        title="ORDERS RESERVED"
        value={succeededOrders !== null ? succeededOrders.toLocaleString() : '—'}
        unit={succeededOrders !== null ? 'orders' : undefined}
        subtitle={hasMetrics ? `${metrics.failed ?? 0} failed · ${metrics.pending_count ?? 0} pending` : undefined}
        status={hasMetrics ? (metrics.failed > 0 ? 'degraded' : 'healthy') : 'neutral'}
        badgeLabel={hasMetrics ? (metrics.failed > 0 ? 'FAILURES' : 'STEADY') : 'UNKNOWN'}
      />
    </section>
  );
}
