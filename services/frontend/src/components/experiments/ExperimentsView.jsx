import React from 'react';
import { FlaskConical } from 'lucide-react';
import { ExperimentLauncherCard } from './ExperimentLauncherCard.jsx';
import { LiveRunCard } from './LiveRunCard.jsx';

/**
 * Phase 4 Experiments View:
 * Two columns on desktop (grid-cols-1 lg:grid-cols-2), stacked on mobile.
 * Hosts ExperimentLauncherCard (form, sliders, preview, AI proposal loader, safety card)
 * and LiveRunCard (single source of truth detail polling, timeline chart, watchdog indicator, event log).
 */
export function ExperimentsView({
  catalog,
  activeExperiment,
  latestExperiment,
  detail,
  detailError,
  detailLoading,
  blocked,
  busy,
  onLaunch,
  onTriggerEmergencyStop,
  latestProposal = null,
  latestReport = null,
}) {
  return (
    <div className="space-y-6">
      {/* Experiments Studio Header Banner */}
      <div className="rounded-xl bg-surface border border-border p-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div>
          <div className="flex items-center gap-2.5">
            <FlaskConical className="h-5 w-5 text-accent-ink" />
            <h2 className="text-xl font-bold text-foreground tracking-tight">
              Chaos Experiments Studio
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Automated fault injection suites for validating microservice circuit breakers and graceful degradation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-background text-accent-ink border border-border">
            Target: {catalog?.target_service || 'unknown'}
          </span>
        </div>
      </div>

      {/* Two Column Layout (Stacked on Mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Column: Launcher */}
        <ExperimentLauncherCard
          catalog={catalog}
          activeExperiment={activeExperiment}
          blocked={blocked}
          busy={busy}
          onLaunch={onLaunch}
          latestProposal={latestProposal}
          latestExperiment={latestExperiment}
          latestReport={latestReport}
        />

        {/* Right Column: Live Run / Recent Run Telemetry View */}
        <LiveRunCard
          experiment={latestExperiment}
          detail={detail}
          detailError={detailError}
          detailLoading={detailLoading}
          onTriggerEmergencyStop={onTriggerEmergencyStop}
        />
      </div>
    </div>
  );
}
