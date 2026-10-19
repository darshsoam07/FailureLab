import React, { useState, useEffect, useRef } from 'react';
import { Network, Layers, Flame, LayoutGrid, GitBranch } from 'lucide-react';
import { SectionHeader } from '../common/SectionHeader.jsx';
import { deriveTopologyHealth } from '../../lib/topologyHealth.js';
import TopologyBanner from '../TopologyBanner.jsx';
import { TopologyGraphView } from './TopologyGraphView.jsx';
import { TopologyLayerList } from './TopologyLayerList.jsx';
import { TopologyDetailPanel } from './TopologyDetailPanel.jsx';

/**
 * Phase 6 System Topology Command Center:
 * - Interactive SVG architectural node graph on desktop
 * - Mobile vertical list grouped by layer (Edge, Data, Messaging, Workers, Chaos)
 * - Real probe signals only via topologyHealth.js
 * - Degraded edges derived from failing dependency checks
 * - Detailed inspection drawer/bottom sheet with exact check names
 *
 * @param {Object} props
 * @param {Object|null} props.experiment - Active experiment
 * @param {boolean} props.stale - Stale telemetry flag
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
  orderLastSuccessAt = null,
  controllerLastSuccessAt = null,
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [desktopViewMode, setDesktopViewMode] = useState('graph'); // 'graph' | 'list'

  const lastActiveElementRef = useRef(null);

  // Derive real node health
  const healthMap = deriveTopologyHealth({ orderReadiness, controllerReadiness });

  // Handle node selection with focus tracking
  function handleSelectNode(nodeId) {
    lastActiveElementRef.current = document.activeElement;
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
  }

  // Handle closing detail panel and returning focus to node
  function handleClosePanel() {
    setSelectedNodeId(null);
    if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === 'function') {
      setTimeout(() => {
        lastActiveElementRef.current?.focus();
      }, 50);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <SectionHeader
        title="Distributed System Topology"
        icon={<Network className="h-5 w-5 text-[#00e5ff]" />}
        subtitle="Live architectural service graph, dependency probes, and fault injection path"
        actions={
          <div className="flex items-center gap-2">
            {/* View Mode Toggle on Desktop */}
            <div className="hidden xl:flex items-center rounded-lg border border-[#1E2942] bg-[#0B1020] p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setDesktopViewMode('graph')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  desktopViewMode === 'graph'
                    ? 'bg-[#1E2942] text-white font-semibold'
                    : 'text-[#9aa9ac] hover:text-white'
                }`}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>Graph</span>
              </button>
              <button
                type="button"
                onClick={() => setDesktopViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  desktopViewMode === 'list'
                    ? 'bg-[#1E2942] text-white font-semibold'
                    : 'text-[#9aa9ac] hover:text-white'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Layers</span>
              </button>
            </div>

            {/* Quick Action to Experiments Studio */}
            <button
              type="button"
              onClick={() => onNavigate('experiments')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/30 text-xs font-mono font-semibold hover:bg-[#00e5ff]/20 transition-colors cursor-pointer"
            >
              <Flame className="h-3.5 w-3.5" />
              <span>Inject Fault</span>
            </button>
          </div>
        }
      />

      {/* Visual Live Fault Pipeline Banner */}
      <TopologyBanner
        experiment={experiment}
        stale={stale}
        orderReadiness={orderReadiness}
        controllerReadiness={controllerReadiness}
        onNavigate={onNavigate}
      />

      {/* Responsive Main Layout (Graph/Layers + Detail Drawer) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Canvas / List Area (7 or 8 columns on large screens when panel open, full width when closed) */}
        <div className={selectedNodeId ? 'lg:col-span-7 xl:col-span-8' : 'lg:col-span-12'}>
          {/* Desktop Graph View */}
          <div className="hidden xl:block">
            {desktopViewMode === 'graph' ? (
              <TopologyGraphView
                nodeHealthMap={healthMap}
                orderReadiness={orderReadiness}
                controllerReadiness={controllerReadiness}
                experiment={experiment}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
              />
            ) : (
              <TopologyLayerList
                nodeHealthMap={healthMap}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                experiment={experiment}
              />
            )}
          </div>

          {/* Mobile Layer List (Collapses to vertical list grouped by layer, no horizontal scroll) */}
          <div className="xl:hidden">
            <TopologyLayerList
              nodeHealthMap={healthMap}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
              experiment={experiment}
            />
          </div>
        </div>

        {/* Selected Node Inspection Drawer (Side drawer on desktop, stacked below on mobile) */}
        {selectedNodeId && (
          <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20">
            <TopologyDetailPanel
              nodeId={selectedNodeId}
              nodeHealthMap={healthMap}
              orderReadiness={orderReadiness}
              controllerReadiness={controllerReadiness}
              experiment={experiment}
              lastProbeTime={selectedNodeId === "order_api" ? (orderLastSuccessAt ? new Date(orderLastSuccessAt).toLocaleTimeString() : "never") : ["experiment_controller", "toxiproxy"].includes(selectedNodeId) ? (controllerLastSuccessAt ? new Date(controllerLastSuccessAt).toLocaleTimeString() : "never") : ["postgres", "rabbitmq"].includes(selectedNodeId) ? `Order API: ${orderLastSuccessAt ? new Date(orderLastSuccessAt).toLocaleTimeString() : "never"}; Controller: ${controllerLastSuccessAt ? new Date(controllerLastSuccessAt).toLocaleTimeString() : "never"}` : "never"}
              onClose={handleClosePanel}
              onNavigate={onNavigate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
