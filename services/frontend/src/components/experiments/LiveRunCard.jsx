import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  Shield,
  Square,
  Radio,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { ExperimentStatusBadge } from '../common/StatusBadge.jsx';
import {
  mapSnapshotsToTimeline,
  deriveConsecutiveBreaches,
  deriveExperimentEventLog,
} from '../../lib/experimentLogic.js';

/**
 * Custom Tooltip for Timeline Chart.
 */
function TimelineTooltip({ active, payload, label, p95Ceiling, errorCeilingPct }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  const isP95Breach = data.p95 > p95Ceiling;
  const isErrorBreach = data.errorRatePct > errorCeilingPct;

  return (
    <div className="rounded-lg bg-[#0B1020]/95 border border-[#1E2942] p-3 text-xs font-mono shadow-xl space-y-1">
      <div className="text-[#849396] border-b border-[#1E2942] pb-1 flex justify-between gap-4">
        <span>Snapshot #{data.index}</span>
        <span className="text-white">{data.timeFormatted}</span>
      </div>
      <div className="flex justify-between gap-4 pt-1">
        <span className="text-[#00e5ff]">P95 Latency:</span>
        <span className={`font-bold ${isP95Breach ? 'text-red-400' : 'text-white'}`}>
          {data.p95}ms {isP95Breach && '(BREACH)'}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-[#f97316]">Error Rate:</span>
        <span className={`font-bold ${isErrorBreach ? 'text-red-400' : 'text-white'}`}>
          {data.errorRatePct}% {isErrorBreach && '(BREACH)'}
        </span>
      </div>
      <div className="flex justify-between gap-4 text-[#849396]">
        <span>Requests (total/failed):</span>
        <span className="text-white">{data.totalRequests} / {data.failedRequests}</span>
      </div>
    </div>
  );
}

/**
 * Custom Dot marker that highlights SLO breach points on the P95 line.
 */
function BreachDot(props) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload || !payload.isBreached) return null;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill="#ef4444"
        opacity={0.3}
        className="animate-ping"
      />
      <circle
        cx={cx}
        cy={cy}
        r={4.5}
        fill="#ef4444"
        stroke="#ffffff"
        strokeWidth={1.5}
      />
    </g>
  );
}

/**
 * Phase 4 Live Run View component:
 * - Single source of truth telemetry chart (Recharts)
 * - Watchdog 3-dots indicator & snapshot freshness
 * - Derived consecutive breaches (N/3)
 * - Monospace chronological event log (newest first)
 * - Enum-accurate ExperimentStatusBadge with raw fallback
 * - Monospace ID, elapsed/final duration, and Emergency Stop trigger
 */
export function LiveRunCard({
  experiment,
  detail,
  detailError,
  detailLoading,
  onTriggerEmergencyStop,
}) {
  const [now, setNow] = useState(Date.now());

  // Keep a ticking clock while experiment is RUNNING for live elapsed duration & freshness
  useEffect(() => {
    if (experiment?.status !== 'RUNNING') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [experiment?.status]);

  if (!experiment) {
    return (
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-8 shadow-md text-center">
        <Activity className="h-10 w-10 text-[#849396] mx-auto mb-3 opacity-60" />
        <h4 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
          No Experiment Executed Yet
        </h4>
        <p className="text-xs text-[#849396] mt-1 max-w-sm mx-auto">
          Configure and launch a fault from the launcher to view live telemetry, watchdog tripwires, and event logs.
        </p>
      </div>
    );
  }

  const isRunning = experiment.status === 'RUNNING';
  const snapshots = detail?.telemetry_snapshots ?? [];
  const p95Ceiling = experiment.slo_max_p95_ms ?? 500;
  const errorCeilingFraction = experiment.slo_max_error_rate ?? 0.05;
  const errorCeilingPct = Number((errorCeilingFraction * 100).toFixed(2));

  // 1. Chart Timeline Points
  const timelineData = useMemo(() => {
    return mapSnapshotsToTimeline(snapshots, p95Ceiling, errorCeilingFraction);
  }, [snapshots, p95Ceiling, errorCeilingFraction]);

  // 2. Derived Consecutive Breaches
  const { consecutiveBreaches, totalBreaches, isBreaching } = useMemo(() => {
    return deriveConsecutiveBreaches(snapshots, p95Ceiling, errorCeilingFraction);
  }, [snapshots, p95Ceiling, errorCeilingFraction]);

  // 3. Derived Chronological Event Log (newest first)
  const eventLog = useMemo(() => {
    return deriveExperimentEventLog(experiment, snapshots);
  }, [experiment, snapshots]);

  // 4. Elapsed or Final Duration calculation
  const startTs = experiment.started_at ? new Date(experiment.started_at).getTime() : null;
  const endTs = experiment.ended_at ? new Date(experiment.ended_at).getTime() : null;
  const plannedSeconds = experiment.parameters?.duration_seconds ?? 60;

  let durationLabel = '';
  if (isRunning && startTs) {
    const elapsed = Math.max(0, Math.floor((now - startTs) / 1000));
    durationLabel = `${elapsed}s elapsed / ${plannedSeconds}s planned`;
  } else if (startTs && endTs) {
    const finalSec = Math.max(0, Math.floor((endTs - startTs) / 1000));
    durationLabel = `${finalSec}s total duration`;
  } else if (startTs) {
    durationLabel = `${plannedSeconds}s planned`;
  }

  // 5. Snapshot Freshness Calculation
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const latestSnapshotTs = latestSnapshot ? new Date(latestSnapshot.timestamp).getTime() : null;
  const snapshotSecondsAgo = latestSnapshotTs ? Math.max(0, Math.floor((now - latestSnapshotTs) / 1000)) : null;
  const isStreamDelayed = isRunning && snapshotSecondsAgo !== null && snapshotSecondsAgo > 12;

  // 6. Fault Injected ReferenceLine marker derived from experiment.started_at
  const faultMarker = useMemo(() => {
    if (!experiment?.started_at || timelineData.length === 0) return null;
    const startEpoch = new Date(experiment.started_at).getTime();
    if (!Number.isFinite(startEpoch)) return null;

    const earliest = timelineData[0].timestamp;
    const latest = timelineData[timelineData.length - 1].timestamp;

    // Clamped to left edge if start time is before earliest plotted snapshot
    if (startEpoch < earliest) {
      return {
        x: timelineData[0].timeFormatted,
        label: 'Fault injected (prior to window)',
      };
    }
    // If start time is after latest plotted snapshot
    if (startEpoch > latest) {
      return {
        x: timelineData[timelineData.length - 1].timeFormatted,
        label: 'Fault injected (pending snapshots)',
      };
    }

    // Find the plotted snapshot closest to started_at
    let closest = timelineData[0];
    let minDiff = Math.abs(timelineData[0].timestamp - startEpoch);
    for (let i = 1; i < timelineData.length; i++) {
      const diff = Math.abs(timelineData[i].timestamp - startEpoch);
      if (diff < minDiff) {
        minDiff = diff;
        closest = timelineData[i];
      }
    }
    return {
      x: closest.timeFormatted,
      label: 'Fault injected',
    };
  }, [experiment?.started_at, timelineData]);

  // Chart domain bounds
  const maxP95 = timelineData.reduce((acc, d) => Math.max(acc, d.p95), p95Ceiling * 1.25);
  const maxError = timelineData.reduce((acc, d) => Math.max(acc, d.errorRatePct), Math.max(10, errorCeilingPct * 2));

  return (
    <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-md space-y-6">
      {/* Header: Status, ID, Duration & Emergency Stop */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#1E2942]">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[17px] font-bold text-white tracking-tight">
              {isRunning ? 'Live Experiment Telemetry' : 'Experiment Telemetry Summary'}
            </h3>
            <ExperimentStatusBadge
              experiment={experiment}
              status={experiment.status}
              abortReason={experiment.abort_reason}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-[#849396]">
            <span>
              ID: <span className="text-[#00e5ff] font-semibold">{experiment.id}</span>
            </span>
            <span>·</span>
            <span>{experiment.name}</span>
            {durationLabel && (
              <>
                <span>·</span>
                <span className="text-white flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-[#849396]" />
                  {durationLabel}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Emergency Stop Button */}
        <div>
          <button
            type="button"
            onClick={onTriggerEmergencyStop}
            disabled={!isRunning}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed ${
              isRunning
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg glow-red'
                : 'bg-[#1E2942] text-[#849396] border border-[#22304D] opacity-60'
            }`}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>{isRunning ? 'EMERGENCY STOP' : 'INACTIVE'}</span>
          </button>
        </div>
      </div>

      {/* Detail Polling Error or Stale State Banner */}
      {detailError && (
        <div role="alert" className="p-3 rounded-lg bg-red-950/40 border border-red-500/50 text-xs font-mono text-red-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Telemetry Sync Degraded:</span> {detailError}
            <div className="text-[11px] text-red-300/80 mt-0.5">
              Displaying last known snapshot data while retaining connection state.
            </div>
          </div>
        </div>
      )}

      {/* Watchdog Guardrails & Snapshot Freshness Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#0B1020] border border-[#1E2942]">
        {/* Watchdog Status */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-[#849396] tracking-wider flex items-center gap-1">
              <Shield className="h-3.5 w-3.5 text-amber-400" />
              Watchdog Tripwire (3 Breaches)
            </span>
            <span className="text-xs font-bold font-mono text-white">
              {consecutiveBreaches}/3
            </span>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <div className="flex items-center gap-1.5" aria-label={`Consecutive breaches: ${consecutiveBreaches} of 3`}>
              {[1, 2, 3].map(i => {
                const isTripped = consecutiveBreaches >= i;
                return (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`h-3 w-3 rounded-full transition-all ${
                      isTripped
                        ? 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                        : 'bg-[#1E2942] border border-[#22304D]'
                    }`}
                  />
                );
              })}
            </div>
            <span className="text-[10px] font-mono text-[#849396] truncate">
              {isBreaching ? 'SLO breach streak active' : 'Guardrails normal'}
            </span>
          </div>

          <p className="text-[10px] font-mono text-[#849396]/80 pt-0.5">
            derived from snapshots; the server remains the authority for the abort decision
          </p>
        </div>

        {/* Snapshot Freshness */}
        <div className="space-y-1 sm:border-l sm:border-[#1E2942] sm:pl-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-[#849396] tracking-wider flex items-center gap-1">
              <Radio className={`h-3.5 w-3.5 ${isRunning ? 'text-[#00e5ff] animate-pulse' : 'text-[#849396]'}`} />
              Snapshot Freshness
            </span>
            <span className="text-xs font-mono text-[#849396]">
              {snapshots.length} recorded
            </span>
          </div>

          <div className="text-xs font-mono pt-1">
            {isRunning ? (
              snapshotSecondsAgo !== null ? (
                isStreamDelayed ? (
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Stream delayed: last snapshot {snapshotSecondsAgo}s ago
                  </span>
                ) : (
                  <span className="text-[#00e5ff] flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-[#00e5ff] glow-dot-cyan" />
                    Live stream: last snapshot {snapshotSecondsAgo}s ago
                  </span>
                )
              ) : (
                <span className="text-[#849396]">Waiting for initial watchdog snapshot…</span>
              )
            ) : (
              <span className="text-[#849396]">
                Experiment finished · {snapshots.length} snapshots archived
              </span>
            )}
          </div>

          <p className="text-[10px] font-mono text-[#849396]/80 pt-0.5">
            The controller aborts automatically after 3 consecutive SLO breaches
          </p>
        </div>
      </div>

      {/* Timeline Chart Area */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="font-bold text-white uppercase tracking-wider">
            Telemetry Snapshot Timeline
          </span>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1.5 text-[#00e5ff]">
              <span className="h-2 w-2 rounded-full bg-[#00e5ff]" />
              P95 Latency (ms)
            </span>
            <span className="flex items-center gap-1.5 text-[#f97316]">
              <span className="h-2 w-2 rounded-full bg-[#f97316]" />
              Error Rate (%)
            </span>
            <span className="flex items-center gap-1.5 text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              SLO Breach
            </span>
          </div>
        </div>

        {timelineData.length === 0 ? (
          <div className="h-56 rounded-xl bg-[#0B1020] border border-[#1E2942] flex flex-col items-center justify-center p-6 text-center">
            {isRunning ? (
              <>
                <Radio className="h-8 w-8 text-[#00e5ff] animate-pulse mb-2" />
                <span className="text-xs font-mono text-[#00e5ff]">
                  Waiting for first telemetry snapshot from controller watchdog…
                </span>
                <span className="text-[11px] font-mono text-[#849396] mt-1">
                  Snapshots are evaluated every 2 seconds
                </span>
              </>
            ) : (
              <>
                <Activity className="h-8 w-8 text-[#849396] mb-2 opacity-50" />
                <span className="text-xs font-mono text-[#849396]">
                  No snapshots captured for this experiment
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-[#0B1020] border border-[#1E2942] p-3 pt-4">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={timelineData}
                  margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="p95Grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00e5ff" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00e5ff" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1E2942" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="timeFormatted"
                    stroke="#849396"
                    tick={{ fill: '#849396', fontSize: 10 }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="latency"
                    stroke="#849396"
                    tick={{ fill: '#849396', fontSize: 10 }}
                    domain={[0, Math.ceil(maxP95)]}
                    tickLine={false}
                    unit="ms"
                  />
                  <YAxis
                    yAxisId="error"
                    orientation="right"
                    stroke="#f97316"
                    tick={{ fill: '#f97316', fontSize: 10 }}
                    domain={[0, Math.ceil(maxError)]}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip
                    content={
                      <TimelineTooltip
                        p95Ceiling={p95Ceiling}
                        errorCeilingPct={errorCeilingPct}
                      />
                    }
                  />

                  {/* SLO Reference Lines */}
                  <ReferenceLine
                    yAxisId="latency"
                    y={p95Ceiling}
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    label={{
                      value: `P95 SLO (${p95Ceiling}ms)`,
                      fill: '#ef4444',
                      fontSize: 9,
                      position: 'insideTopRight',
                    }}
                  />
                  <ReferenceLine
                    yAxisId="error"
                    y={errorCeilingPct}
                    stroke="#f97316"
                    strokeDasharray="3 3"
                    label={{
                      value: `Err SLO (${errorCeilingPct}%)`,
                      fill: '#f97316',
                      fontSize: 9,
                      position: 'insideBottomRight',
                    }}
                  />

                  {/* Fault Injected marker using experiment.started_at (clamped to left edge if prior to window) */}
                  {faultMarker && (
                    <ReferenceLine
                      x={faultMarker.x}
                      stroke="#00e5ff"
                      strokeDasharray="2 2"
                      label={{
                        value: faultMarker.label,
                        fill: '#00e5ff',
                        fontSize: 9,
                        position: 'insideTopLeft',
                      }}
                    />
                  )}

                  <Area
                    yAxisId="latency"
                    type="monotone"
                    dataKey="p95"
                    stroke="#00e5ff"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#p95Grad)"
                    dot={<BreachDot />}
                  />
                  <Line
                    yAxisId="error"
                    type="monotone"
                    dataKey="errorRatePct"
                    stroke="#f97316"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Derived Event Log (Newest First) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="font-bold text-white uppercase tracking-wider">
            Derived Experiment Event Log
          </span>
          <span className="text-[10px] text-[#849396]">
            {eventLog.length} events · Newest first
          </span>
        </div>

        <div
          role="log"
          aria-label="Experiment event log"
          className="max-h-52 overflow-y-auto space-y-1.5 p-3 rounded-xl bg-[#080d1d] border border-[#1E2942] font-mono text-xs divide-y divide-[#1E2942]/40"
        >
          {eventLog.length === 0 ? (
            <p className="text-[#849396] text-center py-4">No events logged yet</p>
          ) : (
            eventLog.map(evt => {
              const timeStr = new Date(evt.timestamp).toTimeString().slice(0, 8);
              const isBreach = evt.type === 'BREACH' || evt.type === 'ABORT';
              const isSuccess = evt.type === 'COMPLETE';

              return (
                <div
                  key={evt.id}
                  className={`pt-1.5 first:pt-0 flex items-start gap-2.5 ${
                    isBreach ? 'text-red-300' : isSuccess ? 'text-emerald-300' : 'text-[#dee1f9]'
                  }`}
                >
                  <span className="text-[#849396] shrink-0">{timeStr}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 ${
                      isBreach
                        ? 'bg-red-950/60 text-red-400 border border-red-800/60'
                        : isSuccess
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                        : 'bg-[#1E2942] text-[#00e5ff] border border-[#1E2942]'
                    }`}
                  >
                    {evt.type}
                  </span>
                  <span className="break-words leading-relaxed text-[11px]">{evt.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
