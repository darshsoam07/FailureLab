import React, { useState } from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const ExperimentsView: React.FC = () => {
  const {
    experiments,
    activeToxic,
    injectToxic,
    stopActiveToxic,
    setIsToxiproxyModalOpen,
  } = useChaos();

  const [filter, setFilter] = useState<'all' | 'ready' | 'completed'>('all');

  const filteredExperiments = experiments.filter((e) => {
    if (filter === 'all') return true;
    return e.status === filter;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#00e5ff] text-[20px]">
              science
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Chaos Experiments Studio
            </h2>
          </div>
          <p className="text-xs text-[#849396] mt-1">
            Automated fault injection suites for validating microservice circuit breakers and graceful degradation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsToxiproxyModalOpen(true)}
            className="px-4 py-2 text-xs font-bold text-[#0e1323] bg-amber-400 hover:bg-amber-300 rounded-lg shadow-lg glow-amber transition-all flex items-center gap-1.5 cursor-pointer font-sans"
          >
            <span className="material-symbols-outlined text-[16px]">add_circle</span>
            <span>Configure New Fault</span>
          </button>
        </div>
      </div>

      {/* Active Running Experiment Banner */}
      {activeToxic?.running && (
        <div className="rounded-xl bg-[#21121d] border-2 border-red-500/80 p-5 glow-red shadow-xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-950/80 border border-red-500/50 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-red-400 text-[26px] animate-pulse">
                bolt
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-red-400 tracking-wider font-mono uppercase">
                  Experiment In Progress
                </span>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                Toxiproxy {activeToxic.type.toUpperCase()} Injection (+{activeToxic.latencyMs}ms)
              </h3>
              <p className="text-xs text-[#849396] font-mono mt-0.5">
                Target: {activeToxic.target} · Jitter: ±{activeToxic.jitterMs}ms · Watchdog Status: Guardrails Armed
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] font-mono text-[#849396] uppercase">Auto-Aborts In</div>
              <div className="text-2xl font-mono font-bold text-red-400">
                {activeToxic.remainingSeconds}s
              </div>
            </div>
            <button
              onClick={stopActiveToxic}
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow transition-all cursor-pointer font-mono"
            >
              STOP EXPERIMENT
            </button>
          </div>
        </div>
      )}

      {/* Experiments Catalog Filter & Grid */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-md">
        <div className="flex items-center justify-between pb-4 border-b border-[#1E2942]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Registered Resilience Tests</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1a1f30] text-[#00e5ff] border border-[#1E2942]">
              {experiments.length} Suites
            </span>
          </div>

          {/* Filter tabs */}
          <div className="flex rounded bg-[#0B1020] p-0.5 border border-[#1E2942] text-[11px] font-mono">
            {(['all', 'ready', 'completed'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded capitalize cursor-pointer transition-colors ${
                  filter === tab
                    ? 'bg-[#00e5ff]/20 text-[#00e5ff] font-semibold'
                    : 'text-[#849396] hover:text-[#dee1f9]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Experiment cards list */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredExperiments.map((exp) => {
            const isCompleted = exp.status === 'completed';

            return (
              <div
                key={exp.id}
                className="rounded-lg bg-[#0B1020] border border-[#1E2942] p-4 flex flex-col justify-between hover:border-[#00e5ff]/40 transition-all group"
              >
                <div>
                  <div className="flex items-center justify-between text-[10px] font-mono mb-2">
                    <span className="text-[#849396]">{exp.id}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded uppercase font-semibold ${
                        isCompleted
                          ? 'bg-blue-950/50 text-[#c3f5ff] border border-[#00e5ff]/30'
                          : 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/40'
                      }`}
                    >
                      {exp.status}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-white group-hover:text-[#00e5ff] transition-colors leading-snug">
                    {exp.name}
                  </h4>

                  <div className="mt-3 space-y-1.5 text-xs text-[#849396] font-mono border-t border-[#1E2942]/60 pt-2.5">
                    <div className="flex justify-between">
                      <span>Target Node:</span>
                      <span className="text-[#dee1f9] font-medium">{exp.targetNodeName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Toxic Type:</span>
                      <span className="text-amber-300 font-medium uppercase">{exp.toxicType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Blast Radius:</span>
                      <span className="text-[#dee1f9] font-medium">{exp.blastRadius}% traffic</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Duration:</span>
                      <span className="text-[#dee1f9] font-medium">{exp.durationSeconds}s</span>
                    </div>
                  </div>

                  {exp.result && (
                    <div className="mt-3 p-2 rounded bg-[#121A2F] border border-[#1E2942] text-[11px] font-mono">
                      <div className="flex justify-between text-[#849396]">
                        <span>Resilience Score:</span>
                        <span className="text-emerald-400 font-bold">{exp.result.resilienceScore}%</span>
                      </div>
                      <div className="flex justify-between text-[#849396] mt-0.5">
                        <span>Max Recorded P95:</span>
                        <span className={exp.result.sloBreached ? 'text-red-400' : 'text-[#00e5ff]'}>
                          {exp.result.maxP95}ms
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-[#1E2942] flex items-center justify-between">
                  <span className="text-[11px] text-[#849396] font-mono">
                    Guardrail: Auto-Abort &gt; 500ms
                  </span>
                  <button
                    onClick={() =>
                      injectToxic(
                        exp.targetNodeId,
                        exp.toxicType,
                        exp.params.latencyMs || 400,
                        exp.params.jitterMs || 40,
                        exp.durationSeconds
                      )
                    }
                    disabled={activeToxic?.running}
                    className={`px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center gap-1 transition-all cursor-pointer ${
                      activeToxic?.running
                        ? 'bg-[#1E2942] text-[#849396] cursor-not-allowed'
                        : 'bg-[#00e5ff]/10 border border-[#00e5ff]/40 text-[#00e5ff] hover:bg-[#00e5ff] hover:text-[#0e1323]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                    <span>Run Suite</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
