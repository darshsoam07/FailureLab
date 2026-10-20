import React, { useEffect, useRef } from 'react';
import { X, Zap, ArrowDownRight, ArrowUpLeft, HelpCircle, ExternalLink } from 'lucide-react';
import { deriveNodeDetails } from '../../lib/topologyGraph.js';

/**
 * Service Node Detail Panel (Desktop Drawer / Mobile Bottom Sheet).
 *
 * Adheres strictly to:
 * - Real signals only: exact check names, probe source, and last probe time
 * - Unprobed nodes explicitly declare "No readiness probe is reachable from the browser"
 * - Toxiproxy shows active fault while RUNNING; otherwise proxy mode (real vs simulated)
 * - Link to Experiments page for Toxiproxy
 * - Escape closes panel and returns focus to node
 * - Zero fabricated CPU, memory, or replica metrics
 */
export function TopologyDetailPanel({
  nodeId,
  nodeHealthMap = {},
  orderReadiness = null,
  controllerReadiness = null,
  experiment = null,
  lastProbeTime = null,
  onClose,
  onNavigate,
}) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const details = deriveNodeDetails({
    nodeId,
    nodeHealthMap,
    experiment,
    orderReadiness,
    controllerReadiness,
    lastProbeTime,
  });

  // Focus trap & Escape key handler
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    if (panelRef.current) {
      panelRef.current.focus();
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nodeId]);

  if (!details) return null;

  const isToxiproxy = details.id === 'toxiproxy';

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label={`${details.name} inspection panel`}
      className="rounded-2xl bg-surface border border-border p-5 shadow-2xl space-y-5 focus-visible:outline-none"
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-border text-accent-ink border border-border">
              {details.layer} Layer
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">
              {details.ports.length > 1
                ? `Ports :${details.ports.join(', :')}`
                : `Port :${details.ports[0]}`}
            </span>
          </div>

          <h3 className="text-lg font-bold text-foreground tracking-tight mt-1">
            {details.name}
          </h3>
          <p className="text-xs font-mono text-muted-foreground">{details.role}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close node detail panel"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-border transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Health Status & Probe Signal Card */}
      <div className="rounded-xl bg-background border border-border p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-muted-foreground font-semibold uppercase tracking-wider">
            Health Signal
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
              details.status === 'healthy'
                ? 'bg-teal-950/60 text-accent-ink border border-teal-500/40'
                : details.status === 'degraded'
                ? 'bg-warning/10 text-warning border border-warning/40'
                : details.status === 'unhealthy'
                ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                : 'bg-muted text-muted-foreground border border-border'
            }`}
          >
            {details.status}
          </span>
        </div>

        <div className="text-xs font-mono text-foreground">
          {details.healthDetail}
        </div>

        {/* Real Readiness Probe Checks */}
        {details.probeChecks.length > 0 && (
          <div className="pt-2 border-t border-border/70 space-y-1.5">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block">
              Probed Checks ({details.probeChecks[0].source}):
            </span>
            {details.probeChecks.map((chk, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded bg-surface border border-border"
              >
                <span className="text-muted-foreground">{chk.checkName}</span>
                <span
                  className={chk.passing ? 'text-accent-ink font-semibold' : 'text-warning font-semibold'}
                >
                  {chk.passing ? 'PASS' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Unprobed Node Reason Callout */}
        {details.unprobedReason && (
          <div className="pt-2 border-t border-border/70">
            <div className="flex items-start gap-2 text-xs font-mono text-muted-foreground bg-surface p-2.5 rounded-lg border border-border">
              <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span>{details.unprobedReason}</span>
            </div>
          </div>
        )}

        {/* Last Probe Time */}
        <div className="text-[10px] font-mono text-muted-foreground pt-1">
          Last probe (client successful poll): <span className="text-foreground">{details.lastProbeTime}</span>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-muted-foreground">
          Service Architecture
        </h4>
        <p className="text-xs text-foreground leading-relaxed font-sans">
          {details.description}
        </p>
      </div>

      {/* Toxiproxy Active Fault or Proxy Mode */}
      {isToxiproxy && (
        <div className="rounded-xl bg-background border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-warning" />
              Toxiproxy Chaos Engine
            </span>
            <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-surface border border-border">
              Mode: {details.toxiproxyMode}
            </span>
          </div>

          {details.toxiproxyActiveFault ? (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/50 space-y-1.5 text-xs font-mono">
              <div className="text-warning font-bold">
                Active Injection: {details.toxiproxyActiveFault.faultType}
              </div>
              <div className="text-[11px] text-foreground">
                Target: {details.toxiproxyActiveFault.targetService}
              </div>
              <pre className="text-[10px] bg-background p-2 rounded border border-warning/30 text-warning overflow-x-auto">
                {JSON.stringify(details.toxiproxyActiveFault.parameters, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-xs font-mono text-muted-foreground">
              No active fault injected. Toxiproxy operates in {details.toxiproxyMode} proxy mode on port 8475.
            </p>
          )}

          {/* Action Link to Experiments */}
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('experiments')}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-accent-ink/30 text-accent-ink hover:bg-primary hover:text-primary-foreground transition-colors text-xs font-mono font-semibold cursor-pointer"
            >
              <span>Open Experiments Studio</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Network Connections */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {/* Incoming */}
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-bold font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <ArrowDownRight className="h-3 w-3 text-accent-ink" />
            Incoming ({details.incoming.length})
          </h4>
          {details.incoming.length === 0 ? (
            <div className="text-[11px] font-mono text-muted-foreground italic">None</div>
          ) : (
            <div className="space-y-1">
              {details.incoming.map((conn, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded bg-background border border-border text-[10px] font-mono text-foreground leading-tight"
                >
                  <div className="font-semibold text-foreground">{conn.fromName}</div>
                  <div className="text-muted-foreground text-[9px]">{conn.label} · {conn.protocol}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Outgoing */}
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-bold font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <ArrowUpLeft className="h-3 w-3 text-accent-ink" />
            Outgoing ({details.outgoing.length})
          </h4>
          {details.outgoing.length === 0 ? (
            <div className="text-[11px] font-mono text-muted-foreground italic">None</div>
          ) : (
            <div className="space-y-1">
              {details.outgoing.map((conn, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded bg-background border border-border text-[10px] font-mono text-foreground leading-tight"
                >
                  <div className="font-semibold text-foreground">{conn.toName}</div>
                  <div className="text-muted-foreground text-[9px]">{conn.label} · {conn.protocol}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
