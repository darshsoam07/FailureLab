import React from 'react';
import { ArrowRight, Boxes, Cpu, Database, Network, Zap } from 'lucide-react';
import { deriveTopologyHealth } from '../lib/topologyHealth.js';
import { StatusBadge } from './common/StatusBadge.jsx';

function faultLabel(experiment) {
  const p = experiment?.parameters ?? {};
  switch (experiment?.fault_type) {
    case 'LATENCY':
      return `+${p.latency_ms ?? 0}ms latency (±${p.jitter_ms ?? 0}ms jitter)`;
    case 'TIMEOUT':
      return `${p.timeout_ms ?? 0}ms timeout${p.timeout_ms === 0 ? ' · indefinite drop' : ''}`;
    case 'ERROR_RATE':
      return p.mode === 'reset_peer' ? 'TCP connection reset' : `${p.error_rate_percent}% HTTP 503 errors`;
    case 'BANDWIDTH':
      return `${p.rate_kbps} KB/s bandwidth bottleneck`;
    default:
      return experiment?.fault_type ? `${experiment.fault_type} active` : 'Fault injection active';
  }
}

/**
 * Visual System Topology pipeline banner showing request path,
 * real subsystem health status, fault glow when chaos is active,
 * and navigation on node click.
 *
 * @param {Object} props
 * @param {Object|null} props.experiment - Running experiment
 * @param {boolean} [props.stale=false] - Whether data is stale
 * @param {Object|null} [props.orderReadiness] - Order API readiness probe
 * @param {Object|null} [props.controllerReadiness] - Controller readiness probe
 * @param {(screen: string) => void} [props.onNavigate] - Navigation handler to switch to Topology screen
 */
export default function TopologyBanner({
  experiment = null,
  stale = false,
  orderReadiness = null,
  controllerReadiness = null,
  onNavigate,
}) {
  const running = experiment?.status === 'RUNNING' && !stale;
  const healthMap = deriveTopologyHealth({ orderReadiness, controllerReadiness });

  const nodes = [
    {
      id: 'order_api',
      name: 'Order API',
      detail: 'Accept & persist',
      Icon: Boxes,
      status: healthMap.order_api.status,
    },
    {
      id: 'rabbitmq',
      name: 'RabbitMQ',
      detail: 'Durable delivery',
      Icon: Network,
      status: healthMap.rabbitmq.status,
    },
    {
      id: 'fulfillment_worker',
      name: 'Fulfillment Worker',
      detail: 'Retry & recover',
      Icon: Cpu,
      status: healthMap.fulfillment_worker.status, // always 'unknown'
    },
    {
      id: 'toxiproxy',
      name: 'Toxiproxy',
      detail: running ? faultLabel(experiment) : 'Fault injection point',
      Icon: Zap,
      fault: true,
      status: healthMap.toxiproxy.status === 'simulated' ? 'simulated' : running ? 'degraded' : healthMap.toxiproxy.status,
    },
    {
      id: 'inventory',
      name: 'Inventory Service',
      detail: 'Reserve stock',
      Icon: Database,
      status: healthMap.inventory.status, // always 'unknown'
    },
  ];

  function handleNodeClick() {
    if (onNavigate) {
      onNavigate('topology');
    }
  }

  return (
    <section
      aria-label="Service topology pipeline"
      className="rounded-xl border border-[#1E2942] bg-[#121A2F] p-4 md:p-5 shadow-md select-none"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1E2942]">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-[#00e5ff]" aria-hidden="true" />
          <h3 className="text-[16px] md:text-[17px] font-semibold text-[#dee1f9]">
            System Topology Pipeline
          </h3>
          <span className="text-[11px] font-mono text-[#849396] ml-1">
            end-to-end order flow
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-mono font-medium ${
              stale
                ? 'text-amber-400'
                : running
                ? 'text-red-400 font-bold uppercase animate-pulse'
                : 'text-[#849396]'
            }`}
          >
            {stale ? 'PROBE SIGNALS STALE' : running ? 'CHAOS INJECTION ACTIVE' : 'STEADY STATE'}
          </span>

          {onNavigate && (
            <button
              type="button"
              onClick={handleNodeClick}
              className="text-xs font-mono text-[#00e5ff] hover:underline cursor-pointer"
            >
              View Service Map →
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-[740px] items-center gap-2.5">
          {nodes.map(({ id, name, detail, Icon, fault, status }, index) => {
            const isToxiproxyActive = fault && running;

            return (
              <li key={id} className="flex min-w-0 flex-1 items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleNodeClick}
                  title={status === 'simulated' ? 'Faults are simulated; results are not from a real proxy' : `Click to view ${name} in Topology`}
                  className={`relative flex min-h-[110px] flex-1 flex-col items-center justify-between rounded-xl border p-3 text-center transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff] ${
                    isToxiproxyActive
                      ? 'border-amber-500/80 bg-amber-950/30 glow-amber'
                      : 'border-[#1E2942] bg-[#0B1020] hover:border-[#22304D]'
                  }`}
                >
                  {/* Status Badge in Corner */}
                  <div className="w-full flex items-center justify-between">
                    <span className="text-[9px] font-mono text-[#849396] uppercase">
                      0{index + 1}
                    </span>
                    <StatusBadge
                      status={status}
                      label={status.toUpperCase()}
                      dot={true}
                    />
                  </div>

                  {/* Icon & Name */}
                  <div className="my-1.5 flex flex-col items-center">
                    <Icon
                      size={22}
                      aria-hidden="true"
                      className={`mb-1 transition-colors ${
                        isToxiproxyActive
                          ? 'text-amber-300 motion-safe:animate-pulse'
                          : 'text-[#00e5ff] group-hover:text-[#dee1f9]'
                      }`}
                    />
                    <span className="text-xs font-semibold text-[#dee1f9] group-hover:text-white">
                      {name}
                    </span>
                  </div>

                  {/* Node detail / fault label */}
                  <span
                    className={`text-[10px] font-mono truncate max-w-[150px] ${
                      isToxiproxyActive ? 'text-amber-300 font-bold' : 'text-[#849396]'
                    }`}
                  >
                    {detail}
                  </span>
                </button>

                {index < nodes.length - 1 && (
                  <ArrowRight
                    size={14}
                    aria-hidden="true"
                    className="shrink-0 text-[#1E2942]"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {running && (
        <div className="mt-3 p-3 rounded-lg border border-red-500/50 bg-red-950/30 flex items-center justify-between text-xs font-mono text-red-200">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-400 animate-ping" />
            <span>
              Active Experiment: <strong className="text-white">{experiment.name}</strong> · {faultLabel(experiment)}
            </span>
          </div>
          <span className="text-[#849396] text-[11px] hidden sm:inline">
            Injected via Toxiproxy proxy client
          </span>
        </div>
      )}
    </section>
  );
}
