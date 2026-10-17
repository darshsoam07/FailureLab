import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Download,
  CheckCircle2,
  AlertTriangle,
  PowerOff,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ExperimentsHistoryTable } from './ExperimentsHistoryTable.jsx';
import { PostMortemPanel } from './PostMortemPanel.jsx';
import {
  calculateReportsKpis,
  filterAndSortExperiments,
} from '../../lib/reportsLogic.js';

/**
 * Phase 5 Reports & Audit View:
 * - Summary KPIs computed strictly from loaded data
 * - Paginated, searchable history table with mobile stacked cards
 * - AI Post-Mortem panel for selected experiment with gentle polling
 * - JSON export without env/secrets
 */
export function ReportsView({
  client,
  catalog,
  onStageProposal,
  revision = 0,
}) {
  const [offset, setOffset] = useState(0);
  const limit = 10;
  const [loadedExperiments, setLoadedExperiments] = useState([]);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [sortDirection, setSortDirection] = useState('desc');

  // Load paginated experiments from GET /api/experiments
  const fetchExperiments = useCallback(async (signal) => {
    try {
      setLoading(true);
      const rows = await client.getExperiments({ limit: 100, offset, signal });
      if (!signal?.aborted) {
        setLoadedExperiments(rows || []);
        setTotalLoaded((rows || []).length);
        setError(null);
        // Default select first item if none selected
        if (!selectedId && rows && rows.length > 0) {
          setSelectedId(rows[0].id);
        }
      }
    } catch (err) {
      if (!signal?.aborted) {
        // Keep last good page on failed refresh
        setError(err.message || 'Failed to refresh experiment history');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [client, offset, selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchExperiments(controller.signal);
    return () => controller.abort();
  }, [fetchExperiments, revision]);

  // Fetch selected detail to display Peak P95 in table without N+1 calls
  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    const controller = new AbortController();
    client.getExperiment(selectedId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setSelectedDetail(data);
      })
      .catch(() => {
        // detail failure handled inside panel
      });
    return () => controller.abort();
  }, [client, selectedId]);

  // Compute KPIs strictly from loaded experiments
  const kpis = useMemo(() => {
    return calculateReportsKpis(loadedExperiments);
  }, [loadedExperiments]);

  // Apply status filter and sorting to loaded page
  const processedExperiments = useMemo(() => {
    return filterAndSortExperiments(loadedExperiments, { statusFilter, sortDirection });
  }, [loadedExperiments, statusFilter, sortDirection]);

  // Export Entire Loaded Page JSON
  function handleExportLoadedPage() {
    if (!loadedExperiments.length) return;
    const exportData = {
      export_metadata: {
        generated_at: new Date().toISOString(),
        total_records: loadedExperiments.length,
        source: 'FailureLab Audit Trail',
      },
      experiments: loadedExperiments.map(exp => ({
        id: exp.id,
        name: exp.name,
        fault_type: exp.fault_type,
        target_service: exp.target_service,
        parameters: exp.parameters,
        slo_max_p95_ms: exp.slo_max_p95_ms,
        slo_max_error_rate: exp.slo_max_error_rate,
        status: exp.status,
        abort_reason: exp.abort_reason ?? null,
        started_at: exp.started_at ?? null,
        ended_at: exp.ended_at ?? null,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `failurelab-audit-log-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Studio Header Banner */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div>
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-[#00e5ff]" />
            <h2 className="text-xl font-bold text-white tracking-tight">
              Resilience Audit & Post-Mortem Reports
            </h2>
          </div>
          <p className="text-xs text-[#849396] mt-1">
            Historical resilience validation records, telemetry snapshots, and automated AI SRE root-cause assessments.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportLoadedPage}
          disabled={!loadedExperiments.length}
          className="px-3.5 py-2 rounded-lg bg-[#00e5ff]/10 border border-[#00e5ff]/30 text-[#00e5ff] hover:bg-[#00e5ff] hover:text-[#0e1323] transition-all text-xs font-mono font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          <span>Export Audit Trail JSON</span>
        </button>
      </div>

      {/* Summary KPI Cards (From Loaded Data Only) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Loaded */}
        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider flex items-center justify-between">
            <span>Loaded Experiments</span>
            <Layers className="h-3.5 w-3.5 text-[#00e5ff]" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-white">{kpis.loadedCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1E2942] text-[#00e5ff] border border-[#1E2942]">
              ARCHIVED
            </span>
          </div>
          <p className="text-[11px] font-mono text-[#849396]">of loaded experiments</p>
        </div>

        {/* KPI 2: Completed */}
        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider flex items-center justify-between">
            <span>Completed Drills</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-emerald-400">{kpis.completedCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
              NORMAL
            </span>
          </div>
          <p className="text-[11px] font-mono text-[#849396]">of loaded experiments</p>
        </div>

        {/* KPI 3: Aborted by SLO */}
        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider flex items-center justify-between">
            <span>Aborted by SLO</span>
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-red-400">{kpis.abortedSloCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950/60 text-red-300 border border-red-800/60 font-bold">
              WATCHDOG
            </span>
          </div>
          <p className="text-[11px] font-mono text-[#849396]">of loaded experiments</p>
        </div>

        {/* KPI 4: Manually Stopped */}
        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider flex items-center justify-between">
            <span>Manually Stopped</span>
            <PowerOff className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-amber-300">{kpis.manuallyStoppedCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 text-amber-300 border border-amber-800/60">
              OPERATOR
            </span>
          </div>
          <p className="text-[11px] font-mono text-[#849396]">of loaded experiments</p>
        </div>
      </div>

      {/* Two Column Layout: Left Table, Right Post-Mortem Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* History Table */}
        <ExperimentsHistoryTable
          experiments={processedExperiments}
          selectedId={selectedId}
          selectedDetail={selectedDetail}
          onSelectExperiment={setSelectedId}
          statusFilter={statusFilter}
          onChangeStatusFilter={setStatusFilter}
          sortDirection={sortDirection}
          onToggleSortDirection={() => setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc')}
          offset={offset}
          limit={limit}
          totalLoaded={totalLoaded}
          onPrevPage={() => setOffset(prev => Math.max(0, prev - limit))}
          onNextPage={() => setOffset(prev => prev + limit)}
          loading={loading}
          error={error}
        />

        {/* AI Post-Mortem Panel */}
        {selectedId ? (
          <PostMortemPanel
            key={selectedId}
            experimentId={selectedId}
            catalog={catalog}
            client={client}
            onStageProposal={onStageProposal}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-8 shadow-md text-center">
            <Sparkles className="h-8 w-8 text-purple-400 mx-auto mb-3 opacity-60" />
            <h4 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
              No Experiment Selected
            </h4>
            <p className="text-xs text-[#849396] mt-1 max-w-sm mx-auto">
              Select an experiment from the audit trail to inspect post-mortem findings, heuristic confidence, and AI recommendations.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
