import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { Activity, Clock } from 'lucide-react';
import { deriveBreachZone } from '../../lib/metricsBuffer.js';

const formatTime = (ts) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/**
 * Recharts-based latency time-series chart styled to Stitch design specs.
 *
 * @param {Object} props
 * @param {Array<Object>} props.buffer - Rolling telemetry buffer
 * @param {Object|null} props.experiment - Running experiment (if any)
 * @param {number|null} [props.currentP95] - Latest P95 value
 * @param {number|null} [props.lastUpdated] - Timestamp of last poll
 * @param {boolean} [props.isStale=false] - Whether telemetry is stale / errored
 */
export function LatencyChartCard({
  buffer = [],
  experiment = null,
  currentP95 = null,
  lastUpdated = null,
  isStale = false,
}) {
  const isRunning = experiment?.status === 'RUNNING';
  const sloThreshold = isRunning && typeof experiment.slo_max_p95_ms === 'number'
    ? experiment.slo_max_p95_ms
    : null;

  // Derive maximum Y from points for breach shading
  const maxY = useMemo(() => {
    if (buffer.length === 0) return 600;
    const maxVal = Math.max(...buffer.map(pt => pt.p95 || 0));
    return Math.max(600, maxVal * 1.15);
  }, [buffer]);

  const breachZone = useMemo(() => {
    return deriveBreachZone({
      p95: currentP95,
      sloMaxP95Ms: sloThreshold,
      maxY,
    });
  }, [currentP95, sloThreshold, maxY]);

  // Experiment start timestamp marker (rendered only if start time falls inside the buffered window)
  const experimentStartTs = useMemo(() => {
    if (!isRunning || !experiment?.started_at || buffer.length === 0) return null;
    const parsed = new Date(experiment.started_at).getTime();
    if (!Number.isFinite(parsed)) return null;

    const minTs = buffer[0]?.timestamp;
    const maxTs = buffer[buffer.length - 1]?.timestamp;
    if (typeof minTs === 'number' && typeof maxTs === 'number' && parsed >= minTs && parsed <= maxTs) {
      return parsed;
    }
    return null;
  }, [isRunning, experiment?.started_at, buffer]);

  // Compute seconds since last successful update
  const secondsAgo = lastUpdated
    ? Math.max(0, Math.round((Date.now() - lastUpdated) / 1000))
    : null;

  return (
    <div
      role="region"
      aria-label="Latency history chart"
      className="lg:col-span-8 rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 md:p-5 flex flex-col justify-between shadow-md select-none"
    >
      {/* Accessible visually hidden summary for screen readers */}
      <div className="sr-only" aria-live="polite">
        Current P95 latency is {currentP95 !== null ? `${currentP95}ms` : 'unknown'}.
        {sloThreshold !== null ? ` Active SLO ceiling is ${sloThreshold}ms.` : ' SLO is not armed.'}
        {breachZone.isBreached ? ' Above SLO ceiling (dashboard view).' : ' Operating within normal limits.'}
        P50 latency is not available from the Order API.
      </div>

      <div>
        {/* Header with Title and Legend */}
        <div className="flex flex-wrap items-center justify-between gap-y-2 pb-3 border-b border-[#1E2942]">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#00e5ff]" aria-hidden="true" />
            <h3 className="text-[16px] md:text-[17px] font-semibold text-[#dee1f9]">
              Latency over time
            </h3>
            <span className="text-[11px] text-[#849396] font-mono ml-1">
              rolling 90 samples (~3m)
            </span>
          </div>

          {/* Legend Items */}
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-1 bg-[#00e5ff] rounded-full inline-block" />
              <span className="text-[#dee1f9] font-medium">
                P95 ({currentP95 !== null ? `${currentP95}ms` : '—'})
              </span>
            </div>

            {sloThreshold !== null && (
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 border-t border-dashed border-red-400 inline-block" />
                <span className="text-red-300 font-semibold">
                  SLO {sloThreshold}ms
                </span>
              </div>
            )}

            <div className="flex items-center gap-1 text-[#849396] text-[10px]">
              <span className="italic">P50 unavailable</span>
            </div>
          </div>
        </div>

        {/* Chart Visual Surface */}
        <div className="relative w-full h-[280px] my-3">
          {buffer.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={buffer}
                margin={{ top: 12, right: 12, bottom: 4, left: -10 }}
                accessibilityLayer
              >
                <CartesianGrid
                  stroke="#1E2942"
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatTime}
                  minTickGap={60}
                  stroke="#849396"
                  tick={{ fill: '#849396', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  stroke="#849396"
                  tick={{ fill: '#849396', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 'auto']}
                  width={42}
                  unit="ms"
                />

                <Tooltip
                  labelFormatter={formatTime}
                  formatter={(val) => [`${val} ms`, 'P95 Latency']}
                  contentStyle={{
                    backgroundColor: '#0B1020',
                    borderColor: '#1E2942',
                    borderRadius: '8px',
                    color: '#dee1f9',
                    fontFamily: 'JetBrains Mono',
                    fontSize: '11px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}
                  itemStyle={{ color: '#00e5ff' }}
                />

                {/* Shading area above SLO where P95 exceeds threshold */}
                {breachZone.isBreached && breachZone.y1 !== null && (
                  <ReferenceArea
                    y1={breachZone.y1}
                    y2={breachZone.y2}
                    fill="rgba(239, 68, 68, 0.22)"
                    stroke="none"
                    label={{
                      value: 'BREACH ZONE',
                      fill: '#f87171',
                      fontSize: 10,
                      position: 'insideTopRight',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                )}

                {/* Dashed SLO reference line */}
                {sloThreshold !== null && (
                  <ReferenceLine
                    y={sloThreshold}
                    stroke="#ef4444"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    label={{
                      value: `SLO ${sloThreshold}ms`,
                      fill: '#f87171',
                      fontSize: 10,
                      position: 'right',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                )}

                {/* Vertical marker for experiment start */}
                {experimentStartTs !== null && (
                  <ReferenceLine
                    x={experimentStartTs}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: 'EXPERIMENT START',
                      fill: '#fbbf24',
                      fontSize: 9,
                      position: 'insideTopLeft',
                      fontFamily: 'JetBrains Mono',
                    }}
                  />
                )}

                {/* Primary P95 latency line */}
                <Line
                  type="monotone"
                  dataKey="p95"
                  stroke={breachZone.isBreached ? '#ef4444' : '#00e5ff'}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, fill: '#00e5ff', stroke: '#0B1020', strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs font-mono text-[#849396]">
              Awaiting telemetry samples from Order API…
            </div>
          )}
        </div>
      </div>

      {/* Footer freshness indicator */}
      <div className="pt-2 border-t border-[#1E2942] flex items-center justify-between font-mono text-[10px] text-[#849396]">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-[#00e5ff]" aria-hidden="true" />
          {isStale ? (
            <span className="text-amber-400 font-semibold">
              TELEMETRY STALE {secondsAgo !== null ? `· last received ${secondsAgo}s ago` : ''}
            </span>
          ) : lastUpdated ? (
            <span>UPDATED {formatTime(lastUpdated)}</span>
          ) : (
            <span>CONNECTING...</span>
          )}
        </div>

        <div>
          {buffer.length} / 90 SAMPLES RECORDED
        </div>
      </div>
    </div>
  );
}
