import React from 'react';
import { Server, Database, Network, Cpu, Flame, Zap, ChevronRight } from 'lucide-react';
import { TOPOLOGY_NODES, groupNodesByLayer } from '../../lib/topologyGraph.js';

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
      return 'bg-simulated/10 text-simulated border-simulated';
    case 'healthy':
      return 'bg-teal-950/60 text-accent-ink border-teal-500/40';
    case 'degraded':
      return 'bg-warning/10 text-warning border-warning/40';
    case 'unhealthy':
      return 'bg-rose-950/60 text-rose-300 border-rose-500/40';
    case 'unknown':
    default:
      return 'bg-muted text-muted-foreground border-border';
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
          <div className="flex items-center justify-between pb-1 border-b border-border/60">
            <div>
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-foreground">
                {layerName} Layer ({nodes.length})
              </h3>
              <p className="text-[11px] font-mono text-muted-foreground">
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
                  className={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                    isSelected
                      ? 'bg-secondary border-accent-ink ring-2 ring-focus-ring/40 shadow-md'
                      : isToxiproxyActive
                      ? 'bg-warning/10 border-warning/60'
                      : 'bg-surface border-border hover:bg-secondary hover:border-border'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        isToxiproxyActive
                          ? 'bg-warning/10 text-warning border border-warning/30'
                          : 'bg-primary/10 text-accent-ink border border-accent-ink/20'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground tracking-tight truncate">
                          {node.name}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          :{node.ports.join(', :')}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {node.role}
                      </div>

                      <div className="text-[10px] font-mono text-foreground/80 truncate mt-0.5">
                        {isToxiproxyActive ? (
                          <span className="text-warning font-semibold">
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
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
