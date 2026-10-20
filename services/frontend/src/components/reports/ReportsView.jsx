import { startVisiblePolling } from '../../lib/visiblePolling.js';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FileText, Download, CheckCircle2, AlertTriangle, PowerOff, Layers, Sparkles } from 'lucide-react';
import { ExperimentsHistoryTable } from './ExperimentsHistoryTable.jsx';
import { PostMortemPanel } from './PostMortemPanel.jsx';
import { calculateReportsKpis, filterAndSortExperiments, calculatePagination } from '../../lib/reportsLogic.js';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [sortDirection, setSortDirection] = useState('desc');

  // Load paginated experiments from GET /api/experiments using real limit/offset
  const fetchExperiments = useCallback(async (signal) => {
    try {
      setLoading(true);
      const rows = await client.getExperiments({ limit, offset, signal });
      if (!signal?.aborted) {
        setLoadedExperiments(rows || []);
        setError(null);
        // Default select first item if none selected
        if (rows && rows.length > 0) {
          setSelectedId(current => current ?? rows[0].id);
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
  }, [client, limit, offset]);

  useEffect(() => {
    const polling = startVisiblePolling(async signal => { await fetchExperiments(signal); return false; });
    return () => polling.stop();
  }, [fetchExperiments, revision]);

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

  // Compute pure pagination
  const pagination = useMemo(() => {
    return calculatePagination({ offset, limit, currentCount: loadedExperiments.length });
  }, [offset, limit, loadedExperiments.length]);

  return (
    <div className="space-y-6">
      {/* Studio Header Banner */}
      <div className="rounded-xl bg-surface border border-border p-5 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div>
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-accent-ink" />
            <h2 className="text-xl font-bold text-foreground tracking-tight">
              Resilience Audit & Post-Mortem Reports
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Historical resilience validation records, telemetry snapshots, and automated AI SRE root-cause assessments.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportLoadedPage}
          disabled={!loadedExperiments.length}
          className="px-3.5 py-2 rounded-lg bg-primary/10 border border-accent-ink/30 text-accent-ink hover:bg-primary hover:text-primary-foreground transition-all text-xs font-mono font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          <span>Export Audit Trail JSON</span>
        </button>
      </div>

      {/* Summary KPI Cards (From Loaded Data Only) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Loaded */}
        <div className="rounded-xl bg-surface border border-border p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Loaded Experiments</span>
            <Layers className="h-3.5 w-3.5 text-accent-ink" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-foreground">{kpis.loadedCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-border text-accent-ink border border-border">
              ARCHIVED
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">of loaded experiments</p>
        </div>

        {/* KPI 2: Completed */}
        <div className="rounded-xl bg-surface border border-border p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Completed Drills</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-success">{kpis.completedCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-success/10 text-success border border-success/60">
              NORMAL
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">of loaded experiments</p>
        </div>

        {/* KPI 3: Aborted by SLO */}
        <div className="rounded-xl bg-surface border border-border p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Aborted by SLO</span>
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-destructive">{kpis.abortedSloCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-destructive/10 text-destructive border border-destructive/60 font-bold">
              WATCHDOG
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">of loaded experiments</p>
        </div>

        {/* KPI 4: Manually Stopped */}
        <div className="rounded-xl bg-surface border border-border p-4 shadow-sm">
          <div className="text-[10px] font-sans font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Manually Stopped</span>
            <PowerOff className="h-3.5 w-3.5 text-warning" />
          </div>
          <div className="my-2 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-bold text-warning">{kpis.manuallyStoppedCount}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-warning/10 text-warning border border-warning/60">
              OPERATOR
            </span>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">of loaded experiments</p>
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
          pagination={pagination}
          offset={offset}
          limit={limit}
          onPrevPage={() => setOffset(pagination.prevOffset)}
          onNextPage={() => setOffset(pagination.nextOffset)}
          loading={loading}
          error={error}
        />

        {/* AI Post-Mortem Panel */}
        {selectedId ? (
          <PostMortemPanel
            key={selectedId}
            experimentId={selectedId}
            onDetail={setSelectedDetail}
            catalog={catalog}
            client={client}
            onStageProposal={onStageProposal}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="rounded-xl bg-surface border border-border p-8 shadow-md text-center">
            <Sparkles className="h-8 w-8 text-simulated mx-auto mb-3 opacity-60" />
            <h4 className="text-sm font-bold text-foreground font-mono uppercase tracking-wider">
              No Experiment Selected
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Select an experiment from the audit trail to inspect post-mortem findings, heuristic confidence, and AI recommendations.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
