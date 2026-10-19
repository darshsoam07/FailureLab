import React from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * Mobile-pinned Emergency Stop trigger bar.
 * Pinned at bottom above mobile navigation when an experiment is actively RUNNING.
 *
 * @param {Object} props
 * @param {Object|null} props.experiment - Running experiment
 * @param {() => void} props.onTriggerStop - Handler to open stop modal
 */
export function MobilePinnedStopBar({ experiment, onTriggerStop }) {
  if (!experiment || experiment.status !== 'RUNNING') return null;

  return (
    <div className="md:hidden fixed bottom-14 inset-x-0 z-40 bg-red-950/95 border-t border-red-500/80 px-4 py-2.5 flex items-center justify-between gap-3 shadow-2xl backdrop-blur-md glow-red">
      <div className="flex items-center gap-2 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-wider text-red-300 font-bold truncate">
            Fault in Progress
          </div>
          <div className="text-xs font-semibold text-white truncate font-sans">
            {experiment.name}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onTriggerStop}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-[#b91c1c] hover:bg-[#991b1b] text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <ShieldAlert className="h-4 w-4" />
        <span>ABORT</span>
      </button>
    </div>
  );
}
