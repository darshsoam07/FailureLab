import React from 'react';
import {
  Server,
  Database,
  Network,
  Cpu,
  Flame,
  Zap,
  ChevronRight,
  HelpCircle,
} from 'lucide-react';
import {
  TOPOLOGY_NODES,
  groupNodesByLayer,
} from '../../lib/topologyGraph.js';

function getNodeIcon(id) {
  switch (id) {
    case 'order_api':
      return Server;
    case 'experiment_controller':
      return Flame;
    case 'postgres':
      return Database;
    case 'rabbitmq':
      return Network;
    case 'toxiproxy':
      return Zap;
    case 'inventory':
      return Server;
    case 'fulfillment_worker':
    case 'ai_worker':
      return Cpu;
    default:
      return Server;
  }
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'simulated':
      return 'bg-violet-950 text-violet-200 border-violet-400';
    case 'healthy':
      return 'bg-teal-950/60 text-[#00e5ff] border-teal-500/40';
    case 'degraded':
      return 'bg-amber-950/60 text-amber-300 border-amber-500/40';
    case 'unhealthy':
      return 'bg-rose-950/60 text-rose-300 border-rose-500/40';
    case 'unknown':
    default:
      return 'bg-slate-900 text-[#849396] border-slate-700';
  }
}

/**
 * Mobile-first stacked vertical list grouped by layer:
 * - Edge
 * - Data
 * - Messaging
 * - Workers
 * - Chaos
 *
 * Guaranteed no horizontal scroll on narrow mobile screens.
 */
export function TopologyLayerList({
  nodeHealthMap = {},
  selectedNodeId = null,
  onSelectNode,
  experiment = null,
}) {
  const grouped = groupNodesByLayer(TOPOLOGY_NODES, nodeHealthMap);

  const layerDescriptions = {
    Edge: 'Public API ingress and upstream stock endpoints',
    Data: 'Transactional persistence and relational outbox storage',
    Messaging: 'Asynchronous event queue routing and task delivery',
    Workers: 'Background execution workers and AI post-mortem synthesis',
    Chaos: 'Chaos injection proxy and watchdog orchestration',
  };

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([layerName, nodes]) => (
        <div key={layerName} className="space-y-2">
          {/* Layer Header */}
          <div className="flex items-center justify-between pb-1 border-b border-[#1E2942]/60">
            <div>
              <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-white">
                {layerName} Layer ({nodes.length})
              </h4>
              <p className="text-[11px] font-mono text-[#849396]">
                {layerDescriptions[layerName] || ''}
              </p>
            </div>
          </div>

          {/* Stacked Cards */}
          <div className="grid grid-cols-1 gap-2.5">
            {nodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const Icon = getNodeIcon(node.id);
              const isToxiproxyActive =
                node.id === 'toxiproxy' && experiment && experiment.status === 'RUNNING';

              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  title={node.detail}
                  aria-label={`${node.name}, ${node.status}, ${node.role}`}
                  aria-expanded={isSelected}
                  className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff] ${
                    isSelected
                      ? 'bg-[#18233C] border-[#00e5ff] ring-2 ring-[#00e5ff]/40 shadow-md'
                      : isToxiproxyActive
                      ? 'bg-amber-950/20 border-amber-500/60'
                      : 'bg-[#121A2F] border-[#1E2942] hover:bg-[#15203B] hover:border-[#2D3F65]'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        isToxiproxyActive
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white tracking-tight truncate">
                          {node.name}
                        </span>
                        <span className="text-[10px] font-mono text-[#849396]">
                          :{node.ports.join(', :')}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-[#849396] truncate">
                        {node.role}
                      </div>

                      <div className="text-[10px] font-mono text-[#dee1f9]/80 truncate mt-0.5">
                        {isToxiproxyActive ? (
                          <span className="text-amber-300 font-semibold">
                            ⚡ Fault active: {experiment.fault_type}
                          </span>
                        ) : (
                          node.healthDetail
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase font-semibold border ${getStatusBadgeClass(
                        node.status
                      )}`}
                    >
                      {node.status}
                    </span>
                    <ChevronRight className="h-4 w-4 text-[#849396]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
