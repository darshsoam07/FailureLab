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
    <header className="sticky top-0 right-0 min-h-14 w-full z-30 bg-background/95 backdrop-blur-md border-b border-border/70 flex justify-between gap-3 items-center px-4 py-2 md:px-6 select-none">
      {/* Left: Page Title & Steady State Health Pill */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-[15px] sm:text-[17px] font-bold text-foreground tracking-tight leading-snug">
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
            className={`hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-mono transition-colors cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              healthPill.state === 'ready'
                ? 'bg-success/10 border-success/40 text-success'
                : healthPill.state === 'degraded'
                ? 'bg-warning/10 border-warning/40 text-warning glow-amber'
                : healthPill.state === 'unreachable'
                ? 'bg-destructive/10 border-destructive/60 text-destructive glow-red'
                : 'bg-muted border-border text-muted-foreground'
            }`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              {healthPill.state === 'ready' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-primary" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary glow-dot-emerald" />
                </>
              )}
              {healthPill.state === 'degraded' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-warning" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-warning glow-dot-amber" />
                </>
              )}
              {healthPill.state === 'unreachable' && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-danger-button glow-dot-red" />
              )}
              {healthPill.state === 'loading' && (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-muted animate-pulse" />
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
                    ? 'bg-success/10 text-success border-success'
                    : 'bg-warning/10 text-warning border-warning'
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
              className="absolute left-0 mt-2 w-72 rounded-lg bg-surface border border-border p-3 shadow-2xl z-50 text-xs font-mono"
            >
              <div className="flex items-center gap-1.5 text-foreground font-semibold border-b border-border pb-1.5 mb-2">
                {healthPill.state === 'ready' && <CheckCircle2 className="h-4 w-4 text-success" />}
                {healthPill.state === 'degraded' && <AlertTriangle className="h-4 w-4 text-warning" />}
                {healthPill.state === 'unreachable' && <ShieldAlert className="h-4 w-4 text-destructive" />}
                {healthPill.state === 'loading' && <RefreshCw className="h-4 w-4 text-muted-foreground animate-spin" />}
                <span>Controller Readiness</span>
              </div>
              <p className="text-foreground leading-relaxed text-[11px]">
                {healthPill.detail}
              </p>
              {healthPill.failingChecks.length > 0 && (
                <div className="mt-2 text-warning text-[10px] space-y-0.5">
                  <span className="font-bold uppercase tracking-wider">Failing probes:</span>
                  <ul className="list-disc list-inside pl-1 text-warning">
                    {healthPill.failingChecks.map(check => (
                      <li key={check}>{check} probe failing</li>
                    ))}
                  </ul>
                </div>
              )}
              {healthPill.toxiproxyMode && (
                <div className="mt-2 pt-1.5 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between">
                  <span>Toxiproxy Daemon:</span>
                  <span className="text-accent-ink uppercase font-bold">{healthPill.toxiproxyMode} mode</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Emergency Stop Button */}
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenEmergencyStop}
          disabled={!stopConfig.enabled}
          aria-label={stopConfig.enabled ? `Execute Emergency Stop for ${stopConfig.experimentName}` : 'Emergency Stop disabled: no running fault'}
          title={stopConfig.reason}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold tracking-wider transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
            stopConfig.enabled
              ? 'bg-danger-button text-on-destructive border border-danger-button hover:brightness-110 cursor-pointer shadow-sm active:scale-95'
              : 'bg-surface/80 text-muted-foreground/60 border border-border cursor-not-allowed opacity-60'
          }`}
        >
          <ShieldAlert
            className={`h-4 w-4 shrink-0 ${stopConfig.enabled ? 'text-destructive animate-pulse' : 'text-muted-foreground/50'}`}
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
