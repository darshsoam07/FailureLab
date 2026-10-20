import { startVisiblePolling } from '../../lib/visiblePolling.js';
import React, { useState, useEffect, useMemo } from 'react';
import { Activity, AlertTriangle, Clock, Shield, Square, Radio } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { ExperimentStatusBadge } from '../common/StatusBadge.jsx';
import { mapSnapshotsToTimeline, deriveConsecutiveBreaches, deriveExperimentEventLog } from '../../lib/experimentLogic.js';

/**
 * Custom Tooltip for Timeline Chart.
 */
function TimelineTooltip({ active, payload, label, p95Ceiling, errorCeilingPct }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  const isP95Breach = data.p95 > p95Ceiling;
  const isErrorBreach = data.errorRatePct > errorCeilingPct;

  return (
    <div className="rounded-lg bg-background/95 border border-border p-3 text-xs font-mono shadow-xl space-y-1">
      <div className="text-muted-foreground border-b border-border pb-1 flex justify-between gap-4">
        <span>Snapshot #{data.index}</span>
        <span className="text-foreground">{data.timeFormatted}</span>
      </div>
      <div className="flex justify-between gap-4 pt-1">
        <span className="text-accent-ink">P95 Latency:</span>
        <span className={`font-bold ${isP95Breach ? 'text-destructive' : 'text-foreground'}`}>
          {data.p95}ms {isP95Breach && '(BREACH)'}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-chart-secondary">Error Rate:</span>
        <span className={`font-bold ${isErrorBreach ? 'text-destructive' : 'text-foreground'}`}>
          {data.errorRatePct}% {isErrorBreach && '(BREACH)'}
        </span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        <span>Requests (total/failed):</span>
        <span className="text-foreground">{data.totalRequests} / {data.failedRequests}</span>
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
        fill="var(--destructive)"
        opacity={0.3}
        className="animate-ping"
      />
      <circle
        cx={cx}
        cy={cy}
        r={4.5}
        fill="var(--destructive)"
        stroke="var(--foreground)"
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
    const polling = startVisiblePolling(() => setNow(Date.now()), 1000);
    return () => polling.stop();
  }, [experiment?.status]);

  if (!experiment) {
    return (
      <div className="rounded-xl bg-surface border border-border p-8 shadow-md text-center">
        <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
        <h3 className="text-sm font-bold text-foreground font-mono uppercase tracking-wider">
          No Experiment Executed Yet
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
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
    <div className="terminal-panel rounded-lg bg-surface-dark border border-border p-5 shadow-sm space-y-6">
      {/* Header: Status, ID, Duration & Emergency Stop */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[17px] font-bold text-foreground tracking-tight">
              {isRunning ? 'Live Experiment Telemetry' : 'Experiment Telemetry Summary'}
            </h3>
            <ExperimentStatusBadge
              experiment={experiment}
              status={experiment.status}
              abortReason={experiment.abort_reason}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground">
            <span>
              ID: <span className="text-accent-ink font-semibold">{experiment.id}</span>
            </span>
            <span>·</span>
            <span>{experiment.name}</span>
            {durationLabel && (
              <>
                <span>·</span>
                <span className="text-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
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
                ? 'bg-danger-button hover:brightness-110 text-on-destructive shadow-sm'
                : 'bg-border text-muted-foreground border border-border opacity-60'
            }`}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>{isRunning ? 'EMERGENCY STOP' : 'INACTIVE'}</span>
          </button>
        </div>
      </div>

      {/* Detail Polling Error or Stale State Banner */}
      {detailError && (
        <div role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-xs font-mono text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Telemetry Sync Degraded:</span> {detailError}
            <div className="text-[11px] text-destructive/80 mt-0.5">
              Displaying last known snapshot data while retaining connection state.
            </div>
          </div>
        </div>
      )}

      {/* Watchdog Guardrails & Snapshot Freshness Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-background border border-border">
        {/* Watchdog Status */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider flex items-center gap-1">
              <Shield className="h-3.5 w-3.5 text-warning" />
              Watchdog Tripwire (3 Breaches)
            </span>
            <span className="text-xs font-bold font-mono text-foreground">
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
                        ? 'bg-destructive'
                        : 'bg-border border border-border'
                    }`}
                  />
                );
              })}
            </div>
            <span className="text-[10px] font-mono text-muted-foreground truncate">
              {isBreaching ? 'SLO breach streak active' : 'Guardrails normal'}
            </span>
          </div>

          <p className="text-[10px] font-mono text-muted-foreground pt-0.5">
            derived from snapshots; the server remains the authority for the abort decision
          </p>
        </div>

        {/* Snapshot Freshness */}
        <div className="space-y-1 sm:border-l sm:border-border sm:pl-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider flex items-center gap-1">
              <Radio className={`h-3.5 w-3.5 ${isRunning ? 'text-accent-ink animate-pulse' : 'text-muted-foreground'}`} />
              Snapshot Freshness
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {snapshots.length} recorded
            </span>
          </div>

          <div className="text-xs font-mono pt-1">
            {isRunning ? (
              snapshotSecondsAgo !== null ? (
                isStreamDelayed ? (
                  <span className="text-warning font-semibold flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Stream delayed: last snapshot {snapshotSecondsAgo}s ago
                  </span>
                ) : (
                  <span className="text-accent-ink flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-primary glow-dot-cyan" />
                    Live stream: last snapshot {snapshotSecondsAgo}s ago
                  </span>
                )
              ) : (
                <span className="text-muted-foreground">Waiting for initial watchdog snapshot…</span>
              )
            ) : (
              <span className="text-muted-foreground">
                Experiment finished · {snapshots.length} snapshots archived
              </span>
            )}
          </div>

          <p className="text-[10px] font-mono text-muted-foreground pt-0.5">
            The controller aborts automatically after 3 consecutive SLO breaches
          </p>
        </div>
      </div>

      {/* Timeline Chart Area */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center justify-between text-xs font-mono">
          <span className="font-bold text-foreground uppercase tracking-wider">
            Telemetry Snapshot Timeline
          </span>
          <div className="flex flex-wrap items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1.5 text-accent-ink">
              <span className="h-2 w-2 rounded-full bg-primary" />
              P95 Latency (ms)
            </span>
            <span className="flex items-center gap-1.5 text-chart-secondary">
              <span className="h-2 w-2 rounded-full bg-chart-secondary" />
              Error Rate (%)
            </span>
            <span className="flex items-center gap-1.5 text-destructive">
              <span className="h-2 w-2 rounded-full bg-danger-button" />
              SLO Breach
            </span>
          </div>
        </div>

        {timelineData.length === 0 ? (
          <div className="h-56 rounded-xl bg-background border border-border flex flex-col items-center justify-center p-6 text-center">
            {isRunning ? (
              <>
                <Radio className="h-8 w-8 text-accent-ink animate-pulse mb-2" />
                <span className="text-xs font-mono text-accent-ink">
                  Waiting for first telemetry snapshot from controller watchdog…
                </span>
                <span className="text-[11px] font-mono text-muted-foreground mt-1">
                  Snapshots are evaluated every 2 seconds
                </span>
              </>
            ) : (
              <>
                <Activity className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
                <span className="text-xs font-mono text-muted-foreground">
                  No snapshots captured for this experiment
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-background border border-border p-3 pt-4">
            <div className="h-56 w-full" role="region" aria-label="Experiment latency and error-rate timeline">
              <p className="sr-only">{timelineData.length} recorded snapshots; P95 latency in milliseconds and error rate in percent. Consecutive breaches: {consecutiveBreaches} of 3. Exact snapshot values appear in the event log below.</p>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart accessibilityLayer
                  data={timelineData}
                  margin={{ top: 12, right: 12, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="p95Grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-ink)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-ink)" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="timeFormatted"
                    stroke="var(--muted-foreground)"
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="latency"
                    stroke="var(--muted-foreground)"
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                    domain={[0, Math.ceil(maxP95)]}
                    tickLine={false}
                    unit="ms"
                  />
                  <YAxis
                    yAxisId="error"
                    orientation="right"
                    stroke="var(--chart-secondary)"
                    tick={{ fill: 'var(--chart-secondary)', fontSize: 10 }}
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
                    stroke="var(--destructive)"
                    strokeDasharray="3 3"
                    label={{
                      value: `P95 SLO (${p95Ceiling}ms)`,
                      fill: 'var(--destructive)',
                      fontSize: 9,
                      position: 'insideTopRight',
                    }}
                  />
                  <ReferenceLine
                    yAxisId="error"
                    y={errorCeilingPct}
                    stroke="var(--chart-secondary)"
                    strokeDasharray="3 3"
                    label={{
                      value: `Err SLO (${errorCeilingPct}%)`,
                      fill: 'var(--chart-secondary)',
                      fontSize: 9,
                      position: 'insideBottomRight',
                    }}
                  />

                  {/* Fault Injected marker using experiment.started_at (clamped to left edge if prior to window) */}
                  {faultMarker && (
                    <ReferenceLine
                      x={faultMarker.x}
                      stroke="var(--accent-ink)"
                      strokeDasharray="2 2"
                      label={{
                        value: faultMarker.label,
                        fill: 'var(--accent-ink)',
                        fontSize: 9,
                        position: 'insideTopLeft',
                      }}
                    />
                  )}

                  <Area isAnimationActive={false}
                    yAxisId="latency"
                    type="monotone"
                    dataKey="p95"
                    stroke="var(--accent-ink)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#p95Grad)"
                    dot={<BreachDot />}
                  />
                  <Line isAnimationActive={false}
                    yAxisId="error"
                    type="monotone"
                    dataKey="errorRatePct"
                    stroke="var(--chart-secondary)"
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
          <span className="font-bold text-foreground uppercase tracking-wider">
            Derived Experiment Event Log
          </span>
          <span className="text-[10px] text-muted-foreground">
            {eventLog.length} events · Newest first
          </span>
        </div>

        <div
          role="log"
          aria-label="Experiment event log"
          className="max-h-52 overflow-y-auto space-y-1.5 p-3 rounded-xl bg-muted border border-border font-mono text-xs divide-y divide-border/40"
        >
          {eventLog.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No events logged yet</p>
          ) : (
            eventLog.map(evt => {
              const timeStr = new Date(evt.timestamp).toTimeString().slice(0, 8);
              const isBreach = evt.type === 'BREACH' || evt.type === 'ABORT';
              const isSuccess = evt.type === 'COMPLETE';

              return (
                <div
                  key={evt.id}
                  className={`pt-1.5 first:pt-0 flex items-start gap-2.5 ${
                    isBreach ? 'text-destructive' : isSuccess ? 'text-success' : 'text-foreground'
                  }`}
                >
                  <span className="text-muted-foreground shrink-0">{timeStr}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 ${
                      isBreach
                        ? 'bg-destructive/10 text-destructive border border-destructive/60'
                        : isSuccess
                        ? 'bg-success/10 text-success border border-success/60'
                        : 'bg-border text-accent-ink border border-border'
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
