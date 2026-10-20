import React, { useState, useEffect } from 'react';
import { Sliders, AlertTriangle } from 'lucide-react';
import { clampRps, calculateSuccessFidelity } from '../../lib/traffic.js';

/**
 * Traffic Control card managing synthetic background order traffic.
 *
 * @param {Object} props
 * @param {Object|null} props.traffic - Controller traffic status payload
 * @param {boolean} props.busy - Whether an API toggle mutation is in-flight
 * @param {string|null} [props.error=null] - Inline mutation error
 * @param {(enabled: boolean, rps: number) => Promise<void>} props.onToggleTraffic - Toggle action
 */
export function TrafficControlCard({
  traffic,
  busy,
  error = null,
  onToggleTraffic,
}) {
  const [rps, setRps] = useState(5);

  // Sync with active requests_per_second when traffic status updates
  useEffect(() => {
    if (traffic && typeof traffic.requests_per_second === 'number') {
      setRps(clampRps(traffic.requests_per_second));
    }
  }, [traffic?.requests_per_second]);

  const isActive = Boolean(traffic?.active);
  const totalSent = traffic?.total_orders_sent ?? 0;
  const accepted = traffic?.accepted_orders ?? 0;
  const fidelity = calculateSuccessFidelity(totalSent, accepted);

  async function handleToggle() {
    if (busy) return;
    const nextEnabled = !isActive;
    const targetRps = clampRps(rps);
    await onToggleTraffic(nextEnabled, targetRps);
  }

  function handleSliderChange(e) {
    const nextVal = clampRps(e.target.value);
    setRps(nextVal);
    // If traffic is currently active, re-configure immediately
    if (isActive && !busy) {
      onToggleTraffic(true, nextVal);
    }
  }

  return (
    <div className="lg:col-span-4 rounded-xl bg-surface border border-border p-4 md:p-5 flex flex-col justify-between hover:border-border transition-colors shadow-md select-none">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-accent-ink" aria-hidden="true" />
            <h3 className="text-[16px] md:text-[17px] font-semibold text-foreground">
              Traffic Control
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-accent-ink border border-accent-ink/30 font-semibold tracking-wider uppercase">
            SYNTHETIC GEN
          </span>
        </div>

        {/* Inline Error Banner */}
        {error && (
          <div
            role="alert"
            className="mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/60 text-xs font-mono text-destructive flex items-start gap-2"
          >
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span className="leading-tight">{error}</span>
          </div>
        )}

        {/* Toggle Switch Block */}
        <div className="mt-4 p-3.5 rounded-lg bg-background border border-border flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium text-foreground">
              Background Traffic
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              Synthetic customer order loop
            </div>
          </div>

          {/* Accessible Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            aria-label="Toggle synthetic background order traffic"
            disabled={busy || !traffic}
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isActive ? 'bg-primary glow-cyan' : 'bg-muted'
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 transform rounded-full bg-primary-foreground shadow-sm transition duration-200 ease-in-out ${
                isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* RPS Rate Slider (strictly 1-10 range) */}
        <div className="mt-3.5 p-3.5 rounded-lg bg-background border border-border">
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="rps-range"
              className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider"
            >
              REQUESTS PER SECOND
            </label>
            <span className="font-mono text-[16px] text-accent-ink font-semibold">
              {rps} <span className="text-[11px] font-normal text-muted-foreground">req/s</span>
            </span>
          </div>

          <input
            id="rps-range"
            type="range"
            min="1"
            max="10"
            step="1"
            value={rps}
            disabled={busy}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-accent-ink disabled:opacity-50"
          />

          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground mt-1.5">
            <span>1 req/s (min)</span>
            <span className="text-warning/80">Backend bound: 10 max</span>
            <span>10 req/s</span>
          </div>
        </div>
      </div>

      {/* Telemetry Counters & Fidelity Bar */}
      <div className="mt-4 pt-3 border-t border-border space-y-2">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="p-2 rounded bg-background border border-border">
            <div className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider">
              Sent Attempts
            </div>
            <div className="text-[14px] font-mono text-foreground font-semibold mt-0.5 tabular-nums">
              {traffic ? totalSent.toLocaleString() : '—'}
            </div>
          </div>

          <div className="p-2 rounded bg-background border border-border">
            <div className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider">
              Accepted Orders
            </div>
            <div className="text-[14px] font-mono text-success font-semibold mt-0.5 tabular-nums">
              {traffic ? accepted.toLocaleString() : '—'}
            </div>
          </div>
        </div>

        {/* Success Fidelity Progress Bar */}
        <div className="p-2.5 rounded bg-background border border-border">
          <div className="flex justify-between items-center text-[11px] font-mono mb-1.5">
            <span className="text-muted-foreground">Success Fidelity</span>
            <span className={fidelity >= 95 ? 'text-success font-semibold' : 'text-warning font-semibold'}>
              {traffic ? `${fidelity}%` : '—'}
            </span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                fidelity >= 95 ? 'bg-primary' : 'bg-warning'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, fidelity))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
