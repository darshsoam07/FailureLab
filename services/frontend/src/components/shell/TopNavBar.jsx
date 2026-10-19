import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { getPageTitle, canEmergencyStop, deriveHealthPillState } from '../../lib/shell.js';

/**
 * Top navigation bar with page title, controller readiness pill, and emergency stop button.
 *
 * @param {Object} props
 * @param {string} props.activeScreen - Current screen key
 * @param {Object|null} props.activeExperiment - Active experiment object (if any)
 * @param {Object|null} props.controllerReadiness - Controller /ready payload
 * @param {Error|null} props.controllerError - Controller /ready error
 * @param {boolean} props.controllerLoading - Controller polling state
 * @param {() => void} props.onOpenEmergencyStop - Trigger for Emergency Stop confirmation modal
 */
export function TopNavBar({
  activeScreen,
  activeExperiment,
  controllerReadiness,
  controllerError,
  controllerLoading,
  onOpenEmergencyStop,
}) {
  const [showHealthTooltip, setShowHealthTooltip] = useState(false);

  const title = getPageTitle(activeScreen);
  const healthPill = deriveHealthPillState({
    data: controllerReadiness,
    error: controllerError,
    loading: controllerLoading,
  });

  const stopConfig = canEmergencyStop(activeExperiment);

  return (
    <header className="sticky top-0 right-0 h-14 w-full z-30 bg-[#0B1020]/90 backdrop-blur-md border-b border-[#1E2942]/70 flex justify-between items-center px-4 md:px-6 select-none">
      {/* Left: Page Title & Steady State Health Pill */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-[15px] sm:text-[17px] font-bold text-[#dee1f9] tracking-tight truncate">
          {title}
        </h1>

        {/* Controller Readiness Pill with Hover Tooltip */}
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setShowHealthTooltip(true)}
            onMouseLeave={() => setShowHealthTooltip(false)}
            onFocus={() => setShowHealthTooltip(true)}
            onBlur={() => setShowHealthTooltip(false)}
            aria-label={`System health: ${healthPill.label}. ${healthPill.detail}`}
            className={`hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-mono transition-colors cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff] ${
              healthPill.state === 'ready'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                : healthPill.state === 'degraded'
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-300 glow-amber'
                : healthPill.state === 'unreachable'
                ? 'bg-red-950/50 border-red-500/60 text-red-300 glow-red'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {healthPill.state === 'ready' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 glow-dot-emerald" />
                </>
              )}
              {healthPill.state === 'degraded' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-amber-400" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400 glow-dot-amber" />
                </>
              )}
              {healthPill.state === 'unreachable' && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 glow-dot-red" />
              )}
              {healthPill.state === 'loading' && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400 animate-pulse" />
              )}
            </span>

            <span className="font-medium truncate max-w-[150px] md:max-w-none">
              {healthPill.label}
            </span>

            {/* Toxiproxy mode indicator */}
            {healthPill.toxiproxyMode && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase border ${
                  healthPill.toxiproxyMode === 'real'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}
                title={`Toxiproxy mode: ${healthPill.toxiproxyMode}. Real mode required for valid chaos runs.`}
              >
                {healthPill.toxiproxyMode}
              </span>
            )}
          </button>

          {/* Accessible Hover/Focus Tooltip */}
          {showHealthTooltip && (
            <div
              role="tooltip"
              className="absolute left-0 mt-2 w-72 rounded-lg bg-[#121A2F] border border-[#1E2942] p-3 shadow-2xl z-50 text-xs font-mono"
            >
              <div className="flex items-center gap-1.5 text-slate-300 font-semibold border-b border-[#1E2942] pb-1.5 mb-2">
                {healthPill.state === 'ready' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                {healthPill.state === 'degraded' && <AlertTriangle className="h-4 w-4 text-amber-400" />}
                {healthPill.state === 'unreachable' && <ShieldAlert className="h-4 w-4 text-red-400" />}
                {healthPill.state === 'loading' && <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" />}
                <span>Controller Readiness</span>
              </div>
              <p className="text-slate-300 leading-relaxed text-[11px]">
                {healthPill.detail}
              </p>
              {healthPill.failingChecks.length > 0 && (
                <div className="mt-2 text-amber-300 text-[10px] space-y-0.5">
                  <span className="font-bold uppercase tracking-wider">Failing probes:</span>
                  <ul className="list-disc list-inside pl-1 text-amber-200">
                    {healthPill.failingChecks.map(check => (
                      <li key={check}>{check} probe failing</li>
                    ))}
                  </ul>
                </div>
              )}
              {healthPill.toxiproxyMode && (
                <div className="mt-2 pt-1.5 border-t border-[#1E2942] text-[10px] text-slate-400 flex items-center justify-between">
                  <span>Toxiproxy Daemon:</span>
                  <span className="text-[#00e5ff] uppercase font-bold">{healthPill.toxiproxyMode} mode</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Emergency Stop Button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenEmergencyStop}
          disabled={!stopConfig.enabled}
          aria-label={stopConfig.enabled ? `Execute Emergency Stop for ${stopConfig.experimentName}` : 'Emergency Stop disabled: no running fault'}
          title={stopConfig.reason}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold tracking-wider transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
            stopConfig.enabled
              ? 'bg-[#93000a] text-white border border-red-500/80 hover:bg-red-600 glow-red cursor-pointer shadow-lg active:scale-95'
              : 'bg-[#121A2F]/80 text-[#9aa9ac]/60 border border-[#1E2942] cursor-not-allowed opacity-60'
          }`}
        >
          <ShieldAlert
            className={`h-4 w-4 shrink-0 ${stopConfig.enabled ? 'text-red-300 animate-pulse' : 'text-[#9aa9ac]/50'}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">
            {stopConfig.enabled ? 'EMERGENCY STOP' : 'STANDBY (NO FAULT)'}
          </span>
          <span className="sm:hidden">
            {stopConfig.enabled ? 'STOP' : 'STANDBY'}
          </span>
        </button>
      </div>
    </header>
  );
}
