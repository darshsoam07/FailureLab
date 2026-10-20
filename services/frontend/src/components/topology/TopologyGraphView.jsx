import React, { useState } from 'react';
import { Server, Database, Network, Cpu, Flame, Zap } from 'lucide-react';
import { TOPOLOGY_NODES, TOPOLOGY_EDGES, deriveEdgeHealth } from '../../lib/topologyGraph.js';

const NODE_DIMS = { width: 180, height: 86 };

// Node placement coordinates on a 960 x 530 canvas
const NODE_POSITIONS = {
  experiment_controller: { x: 30, y: 30 },
  order_api: { x: 30, y: 220 },
  postgres: { x: 280, y: 220 },
  rabbitmq: { x: 280, y: 400 },
  fulfillment_worker: { x: 530, y: 400 },
  ai_worker: { x: 530, y: 220 },
  toxiproxy: { x: 530, y: 30 },
  inventory: { x: 760, y: 30 },
};

function getNodeCenter(nodeId) {
  const pos = NODE_POSITIONS[nodeId] || { x: 0, y: 0 };
  return {
    x: pos.x + NODE_DIMS.width / 2,
    y: pos.y + NODE_DIMS.height / 2,
  };
}

// Compute directional SVG curved path between nodes
function calculateEdgePath(edgeId, fromId, toId) {
  const from = NODE_POSITIONS[fromId] || { x: 0, y: 0 };
  const to = NODE_POSITIONS[toId] || { x: 0, y: 0 };

  const fromCenter = getNodeCenter(fromId);
  const toCenter = getNodeCenter(toId);

  switch (edgeId) {
    case 'controller_to_order':
      // Straight down
      return {
        d: `M ${from.x + 90} ${from.y + NODE_DIMS.height} L ${to.x + 90} ${to.y}`,
        midX: from.x + 90,
        midY: (from.y + NODE_DIMS.height + to.y) / 2,
      };

    case 'order_to_postgres':
      // Straight right
      return {
        d: `M ${from.x + NODE_DIMS.width} ${from.y + 43} L ${to.x} ${to.y + 43}`,
        midX: (from.x + NODE_DIMS.width + to.x) / 2,
        midY: from.y + 43,
      };

    case 'postgres_outbox_to_rabbitmq':
      // Straight down
      return {
        d: `M ${from.x + 90} ${from.y + NODE_DIMS.height} L ${to.x + 90} ${to.y}`,
        midX: from.x + 90,
        midY: (from.y + NODE_DIMS.height + to.y) / 2,
      };

    case 'rabbitmq_to_worker':
      // Straight right
      return {
        d: `M ${from.x + NODE_DIMS.width} ${from.y + 43} L ${to.x} ${to.y + 43}`,
        midX: (from.x + NODE_DIMS.width + to.x) / 2,
        midY: from.y + 43,
      };

    case 'worker_to_toxiproxy':
      // Curve up along the right edge of worker/ai_worker
      return {
        d: `M ${from.x + 150} ${from.y} C ${from.x + 200} ${from.y - 100}, ${to.x + 200} ${to.y + NODE_DIMS.height + 60}, ${to.x + 150} ${to.y + NODE_DIMS.height}`,
        midX: from.x + 195,
        midY: (from.y + to.y + NODE_DIMS.height) / 2,
      };

    case 'toxiproxy_to_inventory':
      // Straight right
      return {
        d: `M ${from.x + NODE_DIMS.width} ${from.y + 43} L ${to.x} ${to.y + 43}`,
        midX: (from.x + NODE_DIMS.width + to.x) / 2,
        midY: from.y + 43,
      };

    case 'inventory_to_postgres':
      // Curve back left into top right of postgres
      return {
        d: `M ${from.x + 60} ${from.y + NODE_DIMS.height} C ${from.x + 60} ${from.y + 120}, ${to.x + NODE_DIMS.width + 40} ${to.y - 40}, ${to.x + 130} ${to.y}`,
        midX: (from.x + to.x + NODE_DIMS.width) / 2 + 30,
        midY: (from.y + to.y) / 2 + 35,
      };

    case 'controller_to_toxiproxy':
      // Straight right across top
      return {
        d: `M ${from.x + NODE_DIMS.width} ${from.y + 43} L ${to.x} ${to.y + 43}`,
        midX: (from.x + NODE_DIMS.width + to.x) / 2,
        midY: from.y + 43,
      };

    case 'controller_to_rabbitmq':
      // Curve from controller to left edge of rabbitmq
      return {
        d: `M ${from.x + 130} ${from.y + NODE_DIMS.height} C ${from.x + 170} ${from.y + 180}, ${to.x - 50} ${to.y + 10}, ${to.x} ${to.y + 30}`,
        midX: from.x + 110,
        midY: from.y + 190,
      };

    case 'rabbitmq_to_ai_worker':
      // Diagonal up to bottom left of ai_worker
      return {
        d: `M ${from.x + 130} ${from.y} C ${from.x + 140} ${from.y - 40}, ${to.x + 40} ${to.y + NODE_DIMS.height + 40}, ${to.x + 60} ${to.y + NODE_DIMS.height}`,
        midX: (from.x + to.x) / 2 + 90,
        midY: (from.y + to.y + NODE_DIMS.height) / 2 + 10,
      };

    case 'ai_worker_to_postgres':
      // Straight left
      return {
        d: `M ${from.x} ${from.y + 43} L ${to.x + NODE_DIMS.width} ${to.y + 43}`,
        midX: (from.x + to.x + NODE_DIMS.width) / 2,
        midY: from.y + 43,
      };

    default:
      return {
        d: `M ${fromCenter.x} ${fromCenter.y} L ${toCenter.x} ${toCenter.y}`,
        midX: (fromCenter.x + toCenter.x) / 2,
        midY: (fromCenter.y + toCenter.y) / 2,
      };
  }
}

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

function getStatusColor(status) {
  switch (status) {
    case 'simulated':
      return 'var(--simulated)';
    case 'healthy':
      return 'var(--accent-ink)';
    case 'degraded':
      return 'var(--warning)';
    case 'unhealthy':
      return 'var(--destructive)';
    case 'unknown':
    default:
      return 'var(--muted-foreground)';
  }
}

/**
 * Interactive SVG System Topology Node Graph.
 *
 * Adheres strictly to:
 * - Directional arrows and labels for all architecture edges
 * - No moving dashed animations (respects prefers-reduced-motion and does not fake throughput)
 * - Accessible button semantics on every node
 * - Real signals only: degraded edges labelled "(derived)", unprobed nodes marked unknown
 */
export function TopologyGraphView({
  nodeHealthMap = {},
  orderReadiness = null,
  controllerReadiness = null,
  experiment = null,
  selectedNodeId = null,
  onSelectNode,
}) {
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);

  const edgesWithHealth = deriveEdgeHealth({
    edges: TOPOLOGY_EDGES,
    nodeHealthMap,
    orderReadiness,
    controllerReadiness,
  });

  return (
    <div className="terminal-panel relative w-full rounded-lg bg-surface-dark border border-border p-4 shadow-sm">
      {/* Legend & Guidance Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border/70 text-xs font-mono">
        <div className="flex items-center gap-3">
          <span className="text-foreground font-semibold flex items-center gap-1.5">
            <Network className="h-4 w-4 text-accent-ink" />
            Architecture Graph
          </span>
          <span className="text-muted-foreground text-[11px] hidden sm:inline">
            Click any service node to inspect probe checks and dependencies
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Healthy
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-warning" />
            Degraded (derived)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-muted" />
            Unknown (unprobed)
          </span>
        </div>
      </div>

      {/* SVG Canvas (960 x 515) */}
      <div className="relative w-full">
        <svg
          viewBox="0 0 960 515"
          className="w-full h-auto select-none"
          role="img"
          aria-label="FailureLab Distributed System Topology Diagram"
        >
          {/* Arrowhead Markers for Edge States */}
          <defs>
            <marker id="arrow-simulated" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="var(--simulated)" /></marker>
            <marker
              id="arrow-healthy"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent-ink)" />
            </marker>

            <marker
              id="arrow-degraded"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--warning)" />
            </marker>

            <marker
              id="arrow-unhealthy"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--destructive)" />
            </marker>

            <marker
              id="arrow-unknown"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>

          {/* 1. Architectural Edges (Static, Directional, No moving dashes) */}
          <g className="edges-layer">
            {edgesWithHealth.map((edge) => {
              const pathData = calculateEdgePath(edge.id, edge.from, edge.to);
              const color = getStatusColor(edge.status);
              const isHovered = hoveredEdgeId === edge.id;
              const isDegraded = edge.status === 'degraded';
              const markerId = `url(#arrow-${edge.status})`;

              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdgeId(edge.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                  className="cursor-pointer group"
                >
                  {/* Invisible thicker stroke for easier hover */}
                  <path
                    d={pathData.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="14"
                  />

                  {/* Visible Static Line */}
                  <path
                    d={pathData.d}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? 2.5 : 1.75}
                    strokeDasharray={edge.status === 'unknown' ? '4 4' : 'none'}
                    markerEnd={markerId}
                    opacity={isHovered ? 1 : 0.75}
                    className="transition-all"
                  />

                  {/* Edge Label Badge on Midpoint */}
                  <foreignObject
                    x={pathData.midX - 65}
                    y={pathData.midY - 11}
                    width={130}
                    height={22}
                    className="overflow-visible pointer-events-none"
                  >
                    <div
                      className={`text-[9px] font-mono text-center px-1.5 py-0.5 rounded border leading-tight truncate shadow-sm transition-all ${
                        isDegraded
                          ? 'bg-muted text-warning border-warning/60'
                          : edge.status === 'unknown'
                          ? 'bg-background/90 text-muted-foreground border-border'
                          : 'bg-background/90 text-foreground border-border'
                      } ${isHovered ? 'ring-1 ring-focus-ring scale-105' : ''}`}
                      title={`${edge.label} (${edge.protocol}) - ${edge.derivation}`}
                    >
                      {isDegraded ? `⚠️ ${edge.label} (derived)` : edge.label}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>

          {/* 2. System Service Nodes (Accessible Buttons via foreignObject) */}
          <g className="nodes-layer">
            {TOPOLOGY_NODES.map((node) => {
              const pos = NODE_POSITIONS[node.id] || { x: 0, y: 0 };
              const health = nodeHealthMap[node.id] || { status: 'unknown', detail: 'Unknown' };
              const isSelected = selectedNodeId === node.id;
              const Icon = getNodeIcon(node.id);
              const isToxiproxyActive =
                node.id === 'toxiproxy' && experiment && experiment.status === 'RUNNING';

              const statusColor = getStatusColor(health.status);

              return (
                <foreignObject
                  key={node.id}
                  x={pos.x}
                  y={pos.y}
                  width={NODE_DIMS.width}
                  height={NODE_DIMS.height}
                  className="overflow-visible"
                >
                  <button
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    title={health.detail}
                    aria-label={`${node.name}, ${health.status}, ${node.role}`}
                    aria-expanded={isSelected}
                    className={`w-full h-full p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      isSelected
                        ? 'bg-secondary border-accent-ink ring-2 ring-focus-ring/40 shadow-lg shadow-accent-ink/10 scale-[1.02]'
                        : isToxiproxyActive
                        ? 'bg-warning/10 border-warning/70 shadow-md shadow-warning/10'
                        : 'bg-surface border-border hover:border-border hover:bg-secondary'
                    }`}
                  >
                    {/* Top Row: Icon, Layer, Status Pill */}
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            isToxiproxyActive ? 'text-warning' : 'text-accent-ink'
                          }`}
                        />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground truncate">
                          {node.layer}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: statusColor }}
                        />
                        <span className="text-[9px] font-mono text-foreground uppercase">
                          {health.status}
                        </span>
                      </div>
                    </div>

                    {/* Middle: Service Name & Ports */}
                    <div className="my-0.5">
                      <div className="text-xs font-bold text-foreground tracking-tight truncate">
                        {node.name}
                      </div>
                      <div className="text-[10px] font-mono text-accent-ink/80">
                        {node.ports.length > 1
                          ? `Ports :${node.ports.join(', :')}`
                          : `Port :${node.ports[0]}`}
                      </div>
                    </div>

                    {/* Bottom: Active Fault Glow or Check Detail */}
                    <div className="text-[9px] font-mono truncate text-muted-foreground border-t border-border/60 pt-1 w-full">
                      {isToxiproxyActive ? (
                        <span className="text-warning font-semibold truncate block">
                          ⚡ FAULT: {experiment.fault_type}
                        </span>
                      ) : (
                        <span className="truncate block">{health.detail}</span>
                      )}
                    </div>
                  </button>
                </foreignObject>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
