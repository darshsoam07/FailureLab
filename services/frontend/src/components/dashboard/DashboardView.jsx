import React from 'react';
import { DashboardKpiRow } from './DashboardKpiRow.jsx';
import { LatencyChartCard } from './LatencyChartCard.jsx';
import { TrafficControlCard } from './TrafficControlCard.jsx';
import TopologyBanner from '../TopologyBanner.jsx';
import { ErrorBanner } from '../common/ErrorBanner.jsx';

/**
 * Phase 3 Dashboard View:
 * - KPI metric row (P95, Error Rate, Orders in 60s, Orders Reserved)
 * - Topology pipeline banner with live derived health and fault glow
 * - 2/3 width LatencyChartCard beside 1/3 width TrafficControlCard
 * - Stale and error handling
 *
 * @param {Object} props
 * @param {Object|null} props.metrics - Latest metrics summary
 * @param {string|null} props.metricsError - Error from metrics polling
 * @param {number|null} props.lastMetricsUpdated - Last successful poll timestamp
 * @param {Array<Object>} props.buffer - Rolling 90-sample buffer
 * @param {Object|null} props.experiment - Currently running experiment
 * @param {boolean} props.stale - Stale flag
 * @param {Object|null} props.traffic - Traffic generator state
 * @param {boolean} props.trafficBusy - In-flight traffic toggle mutation
 * @param {string|null} props.trafficError - Error from toggle mutation
 * @param {(enabled: boolean, rps: number) => Promise<void>} props.onToggleTraffic - Traffic toggle handler
 * @param {Object|null} props.orderReadiness - Order API /ready response
 * @param {Object|null} props.controllerReadiness - Controller /ready response
 * @param {(screen: string) => void} props.onNavigate - Screen switch handler
 */
export function DashboardView({
  metrics,
  metricsError,
  lastMetricsUpdated,
  buffer,
  experiment,
  stale,
  traffic,
  trafficBusy,
  trafficError,
  onToggleTraffic,
  orderReadiness,
  controllerReadiness,
  onNavigate,
}) {
  const currentP95 = metrics && typeof metrics.p95_latency_ms === 'number'
    ? Math.round(metrics.p95_latency_ms)
    : null;

  const isStale = Boolean(metricsError || stale);

  return (
    <div className="space-y-6"><h2 className="sr-only">Live service telemetry</h2>
      {/* Telemetry Polling Error Banner (retains last good data below) */}
      {metricsError && (
        <ErrorBanner
          title="Telemetry Polling Interrupted"
          message={`Failed to refresh order metrics: ${metricsError}. Displaying last recorded telemetry.`}
        />
      )}

      {/* Top: 4 KPI Cards Row */}
      <DashboardKpiRow
        metrics={metrics}
        experiment={experiment}
        buffer={buffer}
      />

      {/* Mid: Topology Banner with derived health & Toxiproxy fault highlight */}
      <TopologyBanner
        experiment={experiment}
        stale={isStale}
        orderReadiness={orderReadiness}
        controllerReadiness={controllerReadiness}
        onNavigate={onNavigate}
      />

      {/* Bottom Grid: 2/3 Latency Chart + 1/3 Traffic Control */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <LatencyChartCard
          buffer={buffer}
          experiment={experiment}
          currentP95={currentP95}
          lastUpdated={lastMetricsUpdated}
          isStale={isStale}
        />

        <TrafficControlCard
          traffic={traffic}
          busy={trafficBusy}
          error={trafficError}
          onToggleTraffic={onToggleTraffic}
        />
      </div>
    </div>
  );
}
