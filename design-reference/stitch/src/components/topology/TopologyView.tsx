import React, { useState } from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';
import { TopologyNode } from '../../types/chaos.ts';

export const TopologyView: React.FC = () => {
  const { nodes, setSelectedNode, setIsToxiproxyModalOpen, activeToxic } = useChaos();
  const [activeLayer, setActiveLayer] = useState<'all' | 'edge' | 'messaging' | 'storage' | 'chaos'>('all');

  const filteredNodes = nodes.filter((node) => {
    if (activeLayer === 'all') return true;
    if (activeLayer === 'edge') return node.category === 'Gateway' || node.category === 'Async Worker';
    if (activeLayer === 'messaging') return node.category === 'Message Queue';
    if (activeLayer === 'storage') return node.category === 'Persistence';
    if (activeLayer === 'chaos') return node.category === 'Chaos Proxy';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#00e5ff] text-[20px]">
              hub
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Distributed System Topology Map
            </h2>
          </div>
          <p className="text-xs text-[#849396] mt-1">
            Real-time inter-service dependencies, communication protocols, and fault injection points.
          </p>
        </div>

        {/* Layer Selector */}
        <div className="flex rounded bg-[#0B1020] p-0.5 border border-[#1E2942] text-[11px] font-mono">
          {(['all', 'edge', 'messaging', 'storage', 'chaos'] as const).map((layer) => (
            <button
              key={layer}
              onClick={() => setActiveLayer(layer)}
              className={`px-3 py-1 rounded capitalize cursor-pointer transition-colors ${
                activeLayer === layer
                  ? 'bg-[#00e5ff]/20 text-[#00e5ff] font-semibold'
                  : 'text-[#849396] hover:text-[#dee1f9]'
              }`}
            >
              {layer}
            </button>
          ))}
        </div>
      </div>

      {/* Architecture Canvas */}
      <div className="rounded-xl bg-[#0e1323] border border-[#1E2942] p-6 shadow-md relative min-h-[460px]">
        {/* Layer Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono pb-4 border-b border-[#1E2942]/60 text-[#849396]">
          <span className="text-white font-semibold">Protocols:</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-cyan-400"></span> HTTPS/ASGI</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-purple-400"></span> AMQP 0-9-1</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-emerald-400"></span> PostgreSQL Wire</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-blue-400"></span> gRPC HTTP/2</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded bg-amber-400"></span> Toxiproxy Interceptor</span>
        </div>

        {/* Nodes Grid */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredNodes.map((node: TopologyNode) => {
            const isToxi = node.id === 'toxiproxy';

            return (
              <div
                key={node.id}
                onClick={() => {
                  if (isToxi) setIsToxiproxyModalOpen(true);
                  else setSelectedNode(node);
                }}
                className={`rounded-xl p-5 border transition-all cursor-pointer relative shadow-lg ${
                  isToxi
                    ? activeToxic?.running
                      ? 'bg-[#21121d] border-2 border-red-500 glow-red'
                      : 'bg-[#18223D] border-2 border-amber-500/80 glow-amber hover:border-amber-400'
                    : 'bg-[#121A2F] border-[#1E2942] hover:border-[#00e5ff]/50'
                }`}
              >
                {/* Node Header */}
                <div className="flex items-center justify-between pb-3 border-b border-[#1E2942]/60">
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                    isToxi ? (activeToxic?.running ? 'text-red-400' : 'text-amber-400') : 'text-[#849396]'
                  }`}>
                    {node.category}
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span className={`w-2 h-2 rounded-full ${
                      isToxi
                        ? activeToxic?.running ? 'bg-red-400 glow-dot-red animate-ping' : 'bg-amber-400 animate-pulse'
                        : 'bg-emerald-400 glow-dot-emerald'
                    }`}></span>
                    <span className="text-[#849396]">{isToxi ? (activeToxic?.running ? 'ACTIVE TOXIC' : 'ARMED') : 'HEALTHY'}</span>
                  </div>
                </div>

                {/* Node Title & Subtitle */}
                <div className="my-3">
                  <h4 className={`text-base font-bold font-mono ${
                    isToxi
                      ? activeToxic?.running ? 'text-red-300' : 'text-amber-300'
                      : 'text-white'
                  }`}>
                    {node.name}
                  </h4>
                  <div className="text-xs text-[#849396] font-mono mt-0.5">
                    {node.subtitle} · Port {node.port}
                  </div>
                </div>

                {/* Telemetry Stats */}
                <div className="grid grid-cols-3 gap-2 bg-[#0B1020] p-2.5 rounded-lg border border-[#1E2942] text-center font-mono">
                  <div>
                    <div className="text-[9px] text-[#849396] uppercase">Latency</div>
                    <div className="text-xs font-bold text-emerald-400 mt-0.5">
                      {node.latencyMs}ms
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#849396] uppercase">CPU</div>
                    <div className="text-xs font-bold text-[#dee1f9] mt-0.5">
                      {node.cpuPercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#849396] uppercase">Mem</div>
                    <div className="text-xs font-bold text-[#dee1f9] mt-0.5">
                      {node.memoryMb}M
                    </div>
                  </div>
                </div>

                {/* Quick Action Button */}
                <div className="mt-4 pt-3 border-t border-[#1E2942]/60 flex items-center justify-between text-xs font-mono">
                  <span className="text-[#849396] text-[11px]">
                    {node.replicas ? `${node.replicas} Pods Active` : 'Cluster Managed'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isToxi) setIsToxiproxyModalOpen(true);
                      else setSelectedNode(node);
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                      isToxi
                        ? 'bg-amber-400 text-[#0e1323] hover:bg-amber-300'
                        : 'bg-[#00e5ff]/10 text-[#00e5ff] hover:bg-[#00e5ff]/20 border border-[#00e5ff]/30'
                    }`}
                  >
                    <span>{isToxi ? 'Configure Toxic' : 'Inspect Telemetry'}</span>
                    <span className="material-symbols-outlined text-[12px]">chevron_right</span>
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
