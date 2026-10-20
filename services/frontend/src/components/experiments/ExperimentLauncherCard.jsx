import React, { useState, useEffect } from 'react';
import { Clock, TimerOff, AlertTriangle, WifiOff, Play, Shield, Sparkles, Info, Check } from 'lucide-react';
import { buildExperiment, buildProposal, DEFAULT_PARAMETERS, FAULT_LABELS } from '../../api/experiments.js';
import { generatePreviewSentence, percentToFraction, fractionToPercent } from '../../lib/experimentLogic.js';

const FAULT_ICONS = {
  LATENCY: Clock,
  TIMEOUT: TimerOff,
  ERROR_RATE: AlertTriangle,
  BANDWIDTH: WifiOff,
};

const FAULT_DESCRIPTIONS = {
  LATENCY: 'Inject packet delay and jitter into downstream inventory calls',
  TIMEOUT: 'Simulate connection hangs or indefinite upstream socket drops',
  ERROR_RATE: 'Inject 503 Service Unavailable or hard TCP peer resets',
  BANDWIDTH: 'Throttle network throughput to test graceful bandwidth exhaustion',
};

/**
 * Phase 4 Experiment Launcher Form with catalog fault cards, synced sliders,
 * plain-language preview sentence, safety summary card, and AI proposal loader.
 */
export function ExperimentLauncherCard({
  catalog,
  activeExperiment,
  blocked,
  busy,
  onLaunch,
  latestProposal = null,
  latestExperiment = null,
  latestReport = null,
}) {
  const [faultType, setFaultType] = useState('LATENCY');
  const [name, setName] = useState('Inventory Latency Spike Test');
  const [parameters, setParameters] = useState({ ...DEFAULT_PARAMETERS.LATENCY });
  const [duration, setDuration] = useState(60);
  const [p95Ceiling, setP95Ceiling] = useState(500);
  const [errorPercent, setErrorPercent] = useState(5);
  const [error, setError] = useState('');
  const [aiNotice, setAiNotice] = useState('');

  const minDuration = catalog?.duration_seconds?.minimum ?? 1;
  const maxDuration = catalog?.duration_seconds?.maximum ?? 3600;
  const targetService = catalog?.target_service || 'inventory_service';

  const availableFaults = (catalog?.experiments ?? [])
    .filter(item => Object.hasOwn(FAULT_LABELS, item.fault_type));

  const activeSchema = availableFaults.find(item => item.fault_type === faultType)?.parameters_schema;

  // Derive proposal body via buildProposal if latestReport is provided
  let resolvedProposalBody = null;
  let proposalRationale = '';
  if (latestProposal) {
    resolvedProposalBody = latestProposal;
    proposalRationale = latestProposal.rationale || '';
  } else if (latestReport?.next_experiment_proposal && latestExperiment && catalog) {
    try {
      resolvedProposalBody = buildProposal(catalog, latestExperiment, latestReport.next_experiment_proposal);
      proposalRationale = latestReport.next_experiment_proposal.rationale || '';
    } catch {
      resolvedProposalBody = null;
    }
  }

  // Auto-populate form when a proposal is explicitly staged (e.g. navigated from Reports)
  useEffect(() => {
    if (latestProposal) {
      const type = latestProposal.fault_type;
      if (type && Object.hasOwn(FAULT_LABELS, type)) {
        setFaultType(type);
      }
      if (latestProposal.parameters) {
        setParameters({ ...latestProposal.parameters });
      } else if (latestProposal.suggested_parameters) {
        setParameters({ ...latestProposal.suggested_parameters });
      }
      if (typeof latestProposal.duration_seconds === 'number') {
        setDuration(latestProposal.duration_seconds);
      }
      if (typeof latestProposal.slo_max_p95_ms === 'number') {
        setP95Ceiling(latestProposal.slo_max_p95_ms);
      }
      if (typeof latestProposal.slo_max_error_rate === 'number') {
        setErrorPercent(fractionToPercent(latestProposal.slo_max_error_rate));
      }
      if (latestProposal.name) {
        setName(latestProposal.name);
      }
      setAiNotice('AI proposal loaded into form fields. Advisory only: model assessment, not an automated safety clearance. Review parameters before launching.');
    }
  }, [latestProposal]);

  // Sync parameters when changing fault type
  function handleSelectFault(type) {
    setFaultType(type);
    setParameters({ ...(DEFAULT_PARAMETERS[type] || {}) });
    setError('');
  }

  // Update a single parameter value
  function handleParamChange(key, value) {
    setParameters(prev => ({ ...prev, [key]: value }));
  }

  // Load AI proposal into form fields only (NEVER auto-launch)
  function handleLoadProposal() {
    if (!resolvedProposalBody) return;
    try {
      const type = resolvedProposalBody.fault_type;
      if (type && Object.hasOwn(FAULT_LABELS, type)) {
        setFaultType(type);
      }
      if (resolvedProposalBody.parameters) {
        setParameters({ ...resolvedProposalBody.parameters });
      }
      if (typeof resolvedProposalBody.duration_seconds === 'number') {
        setDuration(resolvedProposalBody.duration_seconds);
      }
      if (typeof resolvedProposalBody.slo_max_p95_ms === 'number') {
        setP95Ceiling(resolvedProposalBody.slo_max_p95_ms);
      }
      if (typeof resolvedProposalBody.slo_max_error_rate === 'number') {
        setErrorPercent(fractionToPercent(resolvedProposalBody.slo_max_error_rate));
      }
      if (resolvedProposalBody.name) {
        setName(resolvedProposalBody.name);
      }
      setAiNotice('AI proposal loaded into form fields. Advisory only: model assessment, not an automated safety clearance. Review parameters before launching.');
      setTimeout(() => setAiNotice(''), 8000);
    } catch (err) {
      setError(`Cannot load proposal: ${err.message}`);
    }
  }

  // Plain-language preview sentence derived from form state
  const previewSentence = generatePreviewSentence({
    faultType,
    parameters,
    targetService,
    durationSeconds: Number(duration),
    sloMaxP95Ms: Number(p95Ceiling),
    sloMaxErrorRate: percentToFraction(errorPercent),
  });

  const isRunning = activeExperiment?.status === 'RUNNING';
  const isFormDisabled = blocked || busy || isRunning;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (isRunning) {
      setError('An experiment is already in progress. Wait for it to complete or use Emergency Stop.');
      return;
    }

    try {
      const sloErrorFraction = percentToFraction(errorPercent);
      const experimentBody = buildExperiment(catalog, {
        name: name.trim(),
        fault_type: faultType,
        parameters,
        duration_seconds: Number(duration),
        slo_max_error_rate: sloErrorFraction,
        slo_max_p95_ms: Number(p95Ceiling),
      });

      await onLaunch(experimentBody);
    } catch (err) {
      // Clear inline error message for conflict (409) or validation failure
      setError(err?.message || 'Failed to start experiment');
    }
  }

  return (
    <div className="rounded-xl bg-surface border border-border p-5 shadow-md space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div>
          <h3 className="text-[17px] font-bold text-foreground tracking-tight">
            Configure Chaos Experiment
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Target service: <span className="font-mono text-accent-ink font-semibold">{targetService}</span> · Governed by catalog allowlist
          </p>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-border text-muted-foreground border border-border">
          4 Catalog Suites
        </span>
      </div>

      {/* AI Suggestion Card (if proposal available) */}
      {resolvedProposalBody && (
        <div className="p-4 rounded-xl bg-simulated/10 border border-simulated/40 space-y-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-5 w-5 text-simulated shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-simulated font-mono uppercase tracking-wider">
                  AI SRE Next Proposal
                </div>
                <p className="text-xs text-foreground mt-0.5 leading-relaxed">
                  {proposalRationale || 'Recommended next test based on recent post-mortem analysis.'}
                </p>
                <div className="text-[11px] font-mono text-simulated mt-1">
                  Suggested fault: <strong className="text-foreground">{resolvedProposalBody.fault_type}</strong>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLoadProposal}
              disabled={isFormDisabled}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-simulated/10 hover:bg-simulated/10 text-simulated border border-simulated/50 text-xs font-mono font-semibold transition-all cursor-pointer disabled:opacity-50"
            >
              Load into form
            </button>
          </div>
          <div className="text-[11px] font-mono text-simulated/80 border-t border-simulated/20 pt-2 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>Advisory only: model assessment, not an automated safety clearance. Review parameters before launching.</span>
          </div>
        </div>
      )}

      {aiNotice && (
        <div className="p-3 rounded-lg bg-success/10 border border-success/40 text-xs font-mono text-success flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" />
          <span>{aiNotice}</span>
        </div>
      )}

      {/* Active Conflict Warning */}
      {isRunning && (
        <div className="p-3.5 rounded-lg bg-warning/10 border border-warning/50 text-xs font-mono text-warning flex items-start gap-2.5">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div>
            <div className="font-bold uppercase tracking-wider text-warning">
              Experiment In Progress
            </div>
            <p className="mt-0.5 text-foreground">
              Cannot launch: <strong>{activeExperiment.name}</strong> is currently active on the control plane.
            </p>
          </div>
        </div>
      )}

      {/* Inline Validation / Conflict Error */}
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/60 text-xs font-mono text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Experiment Name */}
        <div>
          <label htmlFor="exp-name" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Experiment Name
          </label>
          <input
            id="exp-name"
            type="text"
            required
            maxLength={255}
            value={name}
            disabled={isFormDisabled}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3.5 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 font-mono"
            placeholder="e.g. Inventory Latency Spike Test"
          />
        </div>

        {/* Fault Selection Cards (Radio Group) */}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Select Allowlisted Fault
          </label>
          <div
            role="radiogroup"
            aria-label="Allowlisted fault types"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {availableFaults.map(({ fault_type }) => {
              const Icon = FAULT_ICONS[fault_type] || AlertTriangle;
              const isSelected = faultType === fault_type;
              return (
                <button
                  key={fault_type}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={isFormDisabled}
                  onClick={() => handleSelectFault(fault_type)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'border-accent-ink bg-primary/10 glow-cyan shadow-sm'
                      : 'border-border bg-background hover:border-border'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${isSelected ? 'text-accent-ink' : 'text-muted-foreground'}`} />
                      <span className="text-xs font-bold text-foreground font-mono">
                        {FAULT_LABELS[fault_type]}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="h-2 w-2 rounded-full bg-primary glow-dot-cyan" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {FAULT_DESCRIPTIONS[fault_type] || 'Inject fault into target service proxy'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Parameter Sliders & Numeric Inputs */}
        <div className="space-y-4 p-4 rounded-xl bg-background border border-border">
          <div className="text-xs font-bold font-mono text-accent-ink uppercase tracking-wider border-b border-border pb-2">
            Fault Parameters ({FAULT_LABELS[faultType]})
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(activeSchema?.properties ?? {}).map(([key, rule]) => {
              const label = key.replaceAll('_', ' ').toUpperCase();
              const val = parameters[key] ?? rule.default ?? 0;

              if (rule.enum) {
                return (
                  <div key={key} className="space-y-1.5">
                    <label htmlFor={`param-${key}`} className="block text-[11px] font-mono text-muted-foreground">
                      {label}
                    </label>
                    <select
                      id={`param-${key}`}
                      value={parameters[key] ?? rule.default}
                      disabled={isFormDisabled}
                      onChange={e => handleParamChange(key, e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
                    >
                      {rule.enum.map(opt => (
                        <option key={opt} value={opt}>
                          {opt === 'reset_peer' ? 'TCP Reset Peer (Connection Abort)' : 'HTTP 503 Service Unavailable'}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              const min = rule.minimum ?? (rule.exclusiveMinimum !== undefined ? rule.exclusiveMinimum + 1 : 0);
              const max = rule.maximum ?? 30000;
              const step = rule.type === 'integer' ? (max > 1000 ? 50 : 1) : 0.5;

              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`param-${key}`} className="text-[11px] font-mono text-muted-foreground">
                      {label}
                    </label>
                    <input
                      type="number"
                      id={`param-${key}`}
                      min={min}
                      max={max}
                      step={step}
                      value={val}
                      disabled={isFormDisabled}
                      onChange={e => handleParamChange(key, e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-24 text-right rounded border border-border bg-surface px-2 py-1 text-xs text-accent-ink font-mono font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
                    />
                  </div>
                  <input
                    type="range"
                    aria-label={`${label} slider`}
                    min={min}
                    max={max}
                    step={step}
                    value={val || 0}
                    disabled={isFormDisabled}
                    onChange={e => handleParamChange(key, Number(e.target.value))}
                    className="w-full h-1.5 bg-border rounded appearance-none cursor-pointer accent-accent-ink disabled:opacity-50"
                  />
                  <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                    <span>{min}</span>
                    <span>{max} max</span>
                  </div>
                </div>
              );
            })}

            {/* Duration Slider + Number Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="duration-input" className="text-[11px] font-mono text-muted-foreground">
                  DURATION (SECONDS)
                </label>
                <input
                  id="duration-input"
                  type="number"
                  min={minDuration}
                  max={maxDuration}
                  step={1}
                  value={duration}
                  disabled={isFormDisabled}
                  onChange={e => setDuration(Number(e.target.value))}
                  className="w-24 text-right rounded border border-border bg-surface px-2 py-1 text-xs text-accent-ink font-mono font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
                />
              </div>
              <input
                type="range"
                aria-label="Duration slider"
                min={minDuration}
                max={Math.min(300, maxDuration)}
                step={1}
                value={duration}
                disabled={isFormDisabled}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full h-1.5 bg-border rounded appearance-none cursor-pointer accent-accent-ink disabled:opacity-50"
              />
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                <span>{minDuration}s</span>
                <span>{Math.min(300, maxDuration)}s</span>
              </div>
            </div>
          </div>
        </div>

        {/* SLO Ceilings Section */}
        <div className="p-4 rounded-xl bg-background border border-border space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-xs font-bold font-mono text-warning uppercase tracking-wider">
              Safety Guardrails (SLO Tripwires)
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              Server Watchdog Enforced
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="slo-p95" className="block text-[11px] font-mono text-muted-foreground mb-1">
                MAXIMUM P95 LATENCY (MS)
              </label>
              <input
                id="slo-p95"
                type="number"
                required
                min={1}
                step="any"
                value={p95Ceiling}
                disabled={isFormDisabled}
                onChange={e => setP95Ceiling(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              />
            </div>

            <div>
              <label htmlFor="slo-error" className="block text-[11px] font-mono text-muted-foreground mb-1">
                MAXIMUM ERROR RATE (%)
              </label>
              <input
                id="slo-error"
                type="number"
                required
                min={0}
                max={100}
                step={0.5}
                value={errorPercent}
                disabled={isFormDisabled}
                onChange={e => setErrorPercent(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 text-[11px] font-mono text-warning/90">
            <Shield className="h-4 w-4 shrink-0" />
            <span>The controller aborts automatically after 3 consecutive SLO breaches.</span>
          </div>
        </div>

        {/* Safety Summary Card */}
        <div className="rounded-xl bg-muted border border-border p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/80 pb-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-success" />
              <span className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                Safety Profile Summary
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-success/10 text-success border border-success/40">
              Watchdog Enforced
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
            <div className="p-2.5 rounded-lg bg-background border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Target Proxy</span>
              <span className="text-foreground font-semibold truncate block mt-0.5">{targetService}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-background border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Max Duration</span>
              <span className="text-accent-ink font-semibold block mt-0.5">{duration}s</span>
            </div>
            <div className="p-2.5 rounded-lg bg-background border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">P95 Tripwire</span>
              <span className="text-warning font-semibold block mt-0.5">{p95Ceiling}ms</span>
            </div>
            <div className="p-2.5 rounded-lg bg-background border border-border/60">
              <span className="text-[10px] text-muted-foreground block uppercase">Error Tripwire</span>
              <span className="text-warning font-semibold block mt-0.5">{errorPercent}%</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-warning/90 pt-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>The controller aborts automatically after 3 consecutive SLO breaches.</span>
          </div>
        </div>

        {/* Plain-Language Preview Sentence */}
        <div className="p-3.5 rounded-lg bg-muted border border-border">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            Plain-Language Execution Preview
          </div>
          <p className="text-xs text-accent-ink font-mono leading-relaxed">
            "{previewSentence}"
          </p>
        </div>

        {/* Launch Button */}
        <button
          type="submit"
          disabled={isFormDisabled}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary hover:brightness-95 text-primary-foreground border border-accent-ink/30 px-5 py-3.5 text-sm font-bold font-sans shadow-sm transition-all cursor-pointer active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          <Play className="h-4 w-4 fill-current" aria-hidden="true" />
          <span>{busy ? 'APPLYING FAULT CONFIGURATION…' : 'LAUNCH CHAOS EXPERIMENT'}</span>
        </button>
      </form>
    </div>
  );
}
