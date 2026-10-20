import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const NodeDetailModal: React.FC = () => {
  const { selectedNode, setSelectedNode, setIsToxiproxyModalOpen } = useChaos();

  if (!selectedNode) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg rounded-xl bg-[#121A2F] border border-[#1E2942] p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={() => setSelectedNode(null)}
          className="absolute top-4 right-4 text-[#849396] hover:text-white transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#1E2942]">
          <div className="w-10 h-10 rounded-lg bg-[#00e5ff]/10 border border-[#00e5ff]/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-[#00e5ff] text-[22px]">dns</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white font-sans">{selectedNode.name}</h3>
              <span className="w-2 h-2 rounded-full bg-emerald-400 glow-dot-emerald"></span>
            </div>
            <p className="text-xs text-[#849396] font-mono">
              Layer: {selectedNode.category} · {selectedNode.subtitle}
            </p>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-4">
          <div className="p-3 rounded-lg bg-[#0B1020] border border-[#1E2942] text-center">
            <div className="text-[10px] font-sans text-[#849396] uppercase">Latency</div>
            <div className="text-[15px] font-mono font-bold text-emerald-400 mt-0.5">
              {selectedNode.latencyMs} ms
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#0B1020] border border-[#1E2942] text-center">
            <div className="text-[10px] font-sans text-[#849396] uppercase">CPU Load</div>
            <div className="text-[15px] font-mono font-bold text-[#dee1f9] mt-0.5">
              {selectedNode.cpuPercent}%
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#0B1020] border border-[#1E2942] text-center">
            <div className="text-[10px] font-sans text-[#849396] uppercase">Memory</div>
            <div className="text-[15px] font-mono font-bold text-[#dee1f9] mt-0.5">
              {selectedNode.memoryMb} MB
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#0B1020] border border-[#1E2942] text-center">
            <div className="text-[10px] font-sans text-[#849396] uppercase">Replicas</div>
            <div className="text-[15px] font-mono font-bold text-[#00e5ff] mt-0.5">
              {selectedNode.replicas ?? 1} pods
            </div>
          </div>
        </div>

        {/* Description & Invariants */}
        <div className="space-y-3 bg-[#0B1020] p-4 rounded-lg border border-[#1E2942] text-xs">
          <div>
            <span className="text-[#849396] block text-[10px] uppercase font-semibold mb-0.5">
              Service Role
            </span>
            <p className="text-[#dee1f9]/90 leading-relaxed">{selectedNode.description}</p>
          </div>

          <div className="pt-2 border-t border-[#1E2942]/60 flex items-center justify-between text-[11px] font-mono text-[#849396]">
            <span>Guardrail Protection:</span>
            <span className="text-emerald-400 font-semibold">Active (SLO Tripwire &lt; 500ms)</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 mt-5 pt-3 border-t border-[#1E2942]">
          <button
            onClick={() => setSelectedNode(null)}
            className="px-4 py-2 text-xs font-semibold text-[#849396] hover:text-[#dee1f9] transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={() => {
              setSelectedNode(null);
              setIsToxiproxyModalOpen(true);
            }}
            className="px-4 py-2 text-xs font-bold text-[#0e1323] bg-[#00e5ff] hover:bg-[#00daf3] rounded-lg shadow-lg glow-cyan transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer font-sans"
          >
            <span className="material-symbols-outlined text-[16px]">bolt</span>
            <span>Inject Chaos Fault</span>
          </button>
        </div>
      </div>
    </div>
  );
};
