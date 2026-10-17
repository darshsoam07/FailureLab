import React from 'react';
import { Settings, Shield, Sliders, Server, Info, ExternalLink } from 'lucide-react';
import { Card } from '../common/Card.jsx';
import { SectionHeader } from '../common/SectionHeader.jsx';
import { StatusBadge } from '../common/StatusBadge.jsx';

/**
 * Read-only Settings & Environment view.
 *
 * @param {Object} props
 * @param {Object|null} props.controllerReadiness - Output of controller /ready
 * @param {Object|null} props.catalog - Catalog parameters
 */
export function SettingsView({ controllerReadiness, catalog }) {
  const checks = controllerReadiness?.checks || {};
  const toxiproxyMode = controllerReadiness?.toxiproxy_mode || 'unknown';

  return (
    <div className="space-y-6">
      <SectionHeader
        title="System & Guardrail Settings"
        icon={<Settings className="h-5 w-5" />}
        subtitle="Read-only runtime configuration & safety bounds"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Guardrail Policy */}
        <Card hover={true}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5 text-[#00e5ff]" />
            <h4 className="text-sm font-semibold text-[#dee1f9]">
              Automated Safety Engine & Auto-Abort
            </h4>
          </div>
          <p className="text-xs text-[#849396] leading-relaxed mb-4">
            FailureLab enforces strict server-controlled tripwires to prevent unrecoverable service outages during resilience testing.
          </p>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
              <span className="text-[#849396]">Auto-Abort Tripwire:</span>
              <span className="text-amber-300 font-bold">3 consecutive breaches</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
              <span className="text-[#849396]">Watchdog Enforcement:</span>
              <span className="text-emerald-400 font-bold">Autonomous Controller Loop</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
              <span className="text-[#849396]">Safety Engine State:</span>
              <StatusBadge
                status={checks.safety_engine ? 'healthy' : 'degraded'}
                label={checks.safety_engine ? 'ACTIVE' : 'DEGRADED'}
              />
            </div>
          </div>
        </Card>

        {/* Experiment Bounds */}
        <Card hover={true}>
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="h-5 w-5 text-[#00e5ff]" />
            <h4 className="text-sm font-semibold text-[#dee1f9]">
              Allowlisted Catalog Limits
            </h4>
          </div>
          <p className="text-xs text-[#849396] leading-relaxed mb-4">
            Fault injection parameters are bound by the controller catalog allowlist. SLO thresholds are configured per experiment.
          </p>

          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
              <span className="text-[#849396]">Duration Limits:</span>
              <span className="text-[#dee1f9]">
                {catalog?.duration_seconds?.minimum ?? 1}s – {catalog?.duration_seconds?.maximum ?? 3600}s
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
              <span className="text-[#849396]">Default Target:</span>
              <span className="text-[#00e5ff] font-bold">{catalog?.target_service || 'inventory_service'}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
              <span className="text-[#849396]">Traffic RPS Range:</span>
              <span className="text-[#dee1f9]">1 – 10 RPS (strict integer)</span>
            </div>
          </div>
        </Card>

        {/* Readiness Probes Output */}
        <Card className="md:col-span-2" hover={true}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-[#00e5ff]" />
              <h4 className="text-sm font-semibold text-[#dee1f9]">
                Control Plane Readiness Probes (/ready)
              </h4>
            </div>
            <span className="text-[11px] font-mono text-[#849396]">
              Toxiproxy Mode: <strong className="text-[#00e5ff] uppercase">{toxiproxyMode}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-2">
            {Object.entries(checks).map(([probeName, isHealthy]) => (
              <div
                key={probeName}
                className="p-3 rounded-lg bg-[#0B1020] border border-[#1E2942] flex flex-col justify-between"
              >
                <span className="text-[11px] font-mono text-[#849396] uppercase truncate">
                  {probeName}
                </span>
                <div className="mt-2">
                  <StatusBadge
                    status={isHealthy ? 'healthy' : 'degraded'}
                    label={isHealthy ? 'PASS' : 'FAIL'}
                    dot={true}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-[#1E2942] flex items-center gap-2 text-xs text-[#849396]">
            <Info className="h-4 w-4 shrink-0 text-[#00e5ff]" />
            <span>
              Real mode requires native Toxiproxy server (:8474) running locally. Simulated mode falls back for development testing.
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
