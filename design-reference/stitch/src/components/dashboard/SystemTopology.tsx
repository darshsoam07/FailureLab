import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';
import { TopologyNode } from '../../types/chaos.ts';

export const SystemTopology: React.FC = () => {
  const {
    nodes,
    setSelectedNode,
    setIsToxiproxyModalOpen,
    activeToxic,
  } = useChaos();

  const handleNodeClick = (node: TopologyNode) => {
    if (node.id === 'toxiproxy') {
      setIsToxiproxyModalOpen(true);
    } else {
      setSelectedNode(node);
    }
  };

  const healthyCount = nodes.filter((n) => n.status === 'healthy').length;

  return (
    <section className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 md:p-5 shadow-md">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#1E2942] gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#00E5FF] text-[18px]">
            account_tree
          </span>
          <h2 className="text-[17px] font-semibold text-[#dee1f9]">System Topology</h2>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1a1f30] text-[#849396] border border-[#1E2942]">
            PIPELINE: ORDER-PROCESSING-MAIN
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 glow-dot-emerald"></span>
            <span className="text-[#849396]">{healthyCount} Healthy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${activeToxic?.running ? 'bg-red-400 glow-dot-red' : 'bg-amber-400'}`}></span>
            <span className={activeToxic?.running ? 'text-red-300 font-semibold' : 'text-amber-300'}>
              {activeToxic?.running ? '1 Toxic Injected' : '1 Fault Target Ready'}
            </span>
          </div>
        </div>
      </div>

      {/* Node Pipeline Visualization */}
      <div className="mt-4 overflow-x-auto pb-2">
        <div className="min-w-[980px] flex items-center justify-between gap-1.5 relative">
          {nodes.map((node, index) => {
            const isToxi = node.id === 'toxiproxy';
            const isNextToToxi = index === 3; // Fulfillment worker before Toxiproxy

            return (
              <React.Fragment key={node.id}>
                {/* Individual Service Node Card */}
                <div
                  onClick={() => handleNodeClick(node)}
                  className={`flex-1 rounded-lg p-3 flex flex-col gap-2 transition-all cursor-pointer relative group ${
                    isToxi
                      ? activeToxic?.running
                        ? 'bg-[#21121d] border-2 border-red-500 glow-red shadow-lg'
                        : 'bg-[#18223D] border-2 border-amber-500/80 glow-amber shadow-lg hover:border-amber-400'
                      : 'bg-[#0B1020] border border-[#1E2942] hover:border-[#00e5ff]/50 hover:bg-[#0e162d]'
                  }`}
                  title={isToxi ? 'Click to inject or configure chaos faults' : 'Click to inspect node telemetry'}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[10px] font-sans font-semibold uppercase tracking-wider ${
                        isToxi ? (activeToxic?.running ? 'text-red-400' : 'text-amber-400') : 'text-[#849396]'
                      }`}
                    >
                      {node.category}
                    </span>
                    {isToxi ? (
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          activeToxic?.running ? 'bg-red-500 animate-ping' : 'bg-amber-400 animate-pulse'
                        }`}
                      ></span>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 glow-dot-emerald"></span>
                    )}
                  </div>

                  <div
                    className={`font-mono text-[13px] font-semibold truncate ${
                      isToxi
                        ? activeToxic?.running
                          ? 'text-red-300 font-bold'
                          : 'text-amber-300 font-bold'
                        : 'text-[#dee1f9] group-hover:text-[#00E5FF]'
                    }`}
                  >
                    {node.name}
                  </div>

                  <div
                    className={`flex items-center justify-between text-[11px] font-mono pt-1 border-t ${
                      isToxi
                        ? activeToxic?.running
                          ? 'border-red-500/30 text-red-200'
                          : 'border-amber-500/30 text-amber-200'
                        : 'border-[#1E2942]/60 text-[#849396]'
                    }`}
                  >
                    <span className="truncate">{node.subtitle}</span>
                    <span
                      className={`font-semibold shrink-0 ${
                        isToxi
                          ? activeToxic?.running
                            ? 'bg-red-950/80 px-1.5 rounded text-red-400 text-[10px] border border-red-500/40 animate-pulse'
                            : 'bg-amber-950/80 px-1.5 rounded text-amber-400 text-[10px] border border-amber-500/40'
                          : 'text-emerald-400'
                      }`}
                    >
                      {node.stat}
                    </span>
                  </div>
                </div>

                {/* Connector Arrow or Bolt */}
                {index < nodes.length - 1 && (
                  <div
                    className={`shrink-0 flex items-center px-1 ${
                      isNextToToxi ? 'text-amber-400' : 'text-[#00e5ff]/70'
                    }`}
                  >
                    {isNextToToxi ? (
                      <span className="material-symbols-outlined text-[18px] animate-pulse">
                        bolt
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]">
                        arrow_forward
                      </span>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
};
