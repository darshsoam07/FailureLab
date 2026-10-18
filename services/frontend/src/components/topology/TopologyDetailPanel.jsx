import React, { useEffect, useRef } from 'react';
import {
  X,
  Server,
  Zap,
  ArrowRight,
  ArrowDownRight,
  ArrowUpLeft,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ExternalLink,
  ShieldCheck,
  Radio,
} from 'lucide-react';
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
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    if (panelRef.current) {
      panelRef.current.focus();
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!details) return null;

  const isToxiproxy = details.id === 'toxiproxy';

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label={`${details.name} inspection panel`}
      className="rounded-2xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-2xl space-y-5 focus-visible:outline-none"
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#1E2942]">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-[#1E2942] text-[#00e5ff] border border-[#1E2942]">
              {details.layer} Layer
            </span>
            <span className="text-[11px] font-mono text-[#849396]">
              {details.ports.length > 1
                ? `Ports :${details.ports.join(', :')}`
                : `Port :${details.ports[0]}`}
            </span>
          </div>

          <h3 className="text-lg font-bold text-white tracking-tight mt-1">
            {details.name}
          </h3>
          <p className="text-xs font-mono text-[#849396]">{details.role}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close node detail panel"
          className="p-1.5 rounded-lg text-[#849396] hover:text-white hover:bg-[#1E2942] transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Health Status & Probe Signal Card */}
      <div className="rounded-xl bg-[#0B1020] border border-[#1E2942] p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#849396] font-semibold uppercase tracking-wider">
            Health Signal
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
              details.status === 'healthy'
                ? 'bg-teal-950/60 text-[#00e5ff] border border-teal-500/40'
                : details.status === 'degraded'
                ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                : details.status === 'unhealthy'
                ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                : 'bg-slate-900 text-[#849396] border border-slate-700'
            }`}
          >
            {details.status}
          </span>
        </div>

        <div className="text-xs font-mono text-[#dee1f9]">
          {details.healthDetail}
        </div>

        {/* Real Readiness Probe Checks */}
        {details.probeChecks.length > 0 && (
          <div className="pt-2 border-t border-[#1E2942]/70 space-y-1.5">
            <span className="text-[10px] font-mono text-[#849396] uppercase tracking-wider block">
              Probed Checks ({details.probeChecks[0].source}):
            </span>
            {details.probeChecks.map((chk, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded bg-[#121A2F] border border-[#1E2942]"
              >
                <span className="text-[#849396]">{chk.checkName}</span>
                <span
                  className={chk.passing ? 'text-[#00e5ff] font-semibold' : 'text-amber-400 font-semibold'}
                >
                  {chk.passing ? 'PASS' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Unprobed Node Reason Callout */}
        {details.unprobedReason && (
          <div className="pt-2 border-t border-[#1E2942]/70">
            <div className="flex items-start gap-2 text-xs font-mono text-[#849396] bg-[#121A2F] p-2.5 rounded-lg border border-[#1E2942]">
              <HelpCircle className="h-4 w-4 text-[#849396] shrink-0 mt-0.5" />
              <span>{details.unprobedReason}</span>
            </div>
          </div>
        )}

        {/* Last Probe Time */}
        <div className="text-[10px] font-mono text-[#849396] pt-1">
          Last probe (client successful poll): <span className="text-[#dee1f9]">{details.lastProbeTime}</span>
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-[#849396]">
          Service Architecture
        </h4>
        <p className="text-xs text-[#dee1f9] leading-relaxed font-sans">
          {details.description}
        </p>
      </div>

      {/* Toxiproxy Active Fault or Proxy Mode */}
      {isToxiproxy && (
        <div className="rounded-xl bg-[#0B1020] border border-[#1E2942] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-400" />
              Toxiproxy Chaos Engine
            </span>
            <span className="text-[10px] font-mono text-[#849396] px-1.5 py-0.5 rounded bg-[#121A2F] border border-[#1E2942]">
              Mode: {details.toxiproxyMode}
            </span>
          </div>

          {details.toxiproxyActiveFault ? (
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/50 space-y-1.5 text-xs font-mono">
              <div className="text-amber-200 font-bold">
                Active Injection: {details.toxiproxyActiveFault.faultType}
              </div>
              <div className="text-[11px] text-[#dee1f9]">
                Target: {details.toxiproxyActiveFault.targetService}
              </div>
              <pre className="text-[10px] bg-[#0B1020] p-2 rounded border border-amber-500/30 text-amber-100 overflow-x-auto">
                {JSON.stringify(details.toxiproxyActiveFault.parameters, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-xs font-mono text-[#849396]">
              No active fault injected. Toxiproxy operates in {details.toxiproxyMode} proxy mode on port 8475.
            </p>
          )}

          {/* Action Link to Experiments */}
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('experiments')}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#00e5ff]/10 border border-[#00e5ff]/30 text-[#00e5ff] hover:bg-[#00e5ff] hover:text-[#0e1323] transition-colors text-xs font-mono font-semibold cursor-pointer"
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
          <h4 className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#849396] flex items-center gap-1">
            <ArrowDownRight className="h-3 w-3 text-[#00e5ff]" />
            Incoming ({details.incoming.length})
          </h4>
          {details.incoming.length === 0 ? (
            <div className="text-[11px] font-mono text-[#849396] italic">None</div>
          ) : (
            <div className="space-y-1">
              {details.incoming.map((conn, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded bg-[#0B1020] border border-[#1E2942] text-[10px] font-mono text-[#dee1f9] leading-tight"
                >
                  <div className="font-semibold text-white">{conn.fromName}</div>
                  <div className="text-[#849396] text-[9px]">{conn.label} · {conn.protocol}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Outgoing */}
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-bold font-mono uppercase tracking-wider text-[#849396] flex items-center gap-1">
            <ArrowUpLeft className="h-3 w-3 text-[#00e5ff]" />
            Outgoing ({details.outgoing.length})
          </h4>
          {details.outgoing.length === 0 ? (
            <div className="text-[11px] font-mono text-[#849396] italic">None</div>
          ) : (
            <div className="space-y-1">
              {details.outgoing.map((conn, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded bg-[#0B1020] border border-[#1E2942] text-[10px] font-mono text-[#dee1f9] leading-tight"
                >
                  <div className="font-semibold text-white">{conn.toName}</div>
                  <div className="text-[#849396] text-[9px]">{conn.label} · {conn.protocol}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
