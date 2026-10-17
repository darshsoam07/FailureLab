import React from 'react';
import { Network, Server, Database, ArrowRight } from 'lucide-react';
import { Card } from '../common/Card.jsx';
import { SectionHeader } from '../common/SectionHeader.jsx';
import { StatusBadge } from '../common/StatusBadge.jsx';
import { deriveTopologyHealth } from '../../lib/topologyHealth.js';
import TopologyBanner from '../TopologyBanner.jsx';

/**
 * Topology page component showing the distributed system architecture
 * and real health signals derived from /ready checks.
 *
 * @param {Object} props
 * @param {Object|null} props.experiment - Active experiment (for fault banner)
 * @param {boolean} props.stale - Stale flag
 * @param {Object|null} props.orderReadiness - Order API /ready response
 * @param {Object|null} props.controllerReadiness - Controller /ready response
 * @param {(screen: string) => void} props.onNavigate - Navigation handler
 */
export function TopologyOverview({
  experiment,
  stale,
  orderReadiness,
  controllerReadiness,
  onNavigate,
}) {
  const healthMap = deriveTopologyHealth({ orderReadiness, controllerReadiness });

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Distributed System Topology"
        icon={<Network className="h-5 w-5" />}
        subtitle="End-to-end request flow & live subsystem health"
        actions={
          <button
            type="button"
            onClick={() => onNavigate('experiments')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/30 text-xs font-mono font-semibold hover:bg-[#00e5ff]/20 transition-colors cursor-pointer"
          >
            <span>Inject Chaos Fault</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
      />

      {/* Visual Pipeline Banner */}
      <TopologyBanner experiment={experiment} stale={stale} />

      {/* Detailed Services Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(healthMap).map(([id, node]) => {
          const isFaultTarget = experiment?.status === 'RUNNING' && id === 'inventory';

          return (
            <Card
              key={id}
              hover={true}
              glow={isFaultTarget ? 'amber' : 'none'}
              className="flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#849396]">
                    {node.layer}
                  </span>
                  <StatusBadge
                    status={node.status}
                    label={node.status.toUpperCase()}
                    dot={true}
                  />
                </div>

                <h4 className="text-sm font-bold text-[#dee1f9] tracking-tight">
                  {node.name}
                </h4>

                {node.port && (
                  <div className="text-[11px] font-mono text-[#00e5ff] mt-0.5">
                    Port :{node.port}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-[#1E2942] text-[11px] font-mono text-[#849396] leading-relaxed">
                {isFaultTarget ? (
                  <span className="text-amber-300 font-semibold animate-pulse">
                    ⚡ ACTIVE FAULT INJECTION TARGET
                  </span>
                ) : (
                  node.detail
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
