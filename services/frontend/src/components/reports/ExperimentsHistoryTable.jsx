import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUpDown, Filter, Activity, Layers } from 'lucide-react';
import { ExperimentStatusBadge } from '../common/StatusBadge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { ErrorBanner } from '../common/ErrorBanner.jsx';
import { formatRowData } from '../../lib/reportsLogic.js';

/**
 * Accessible Experiments History Table with pagination, client-side status filtering,
 * and keyboard selection.
 */
export function ExperimentsHistoryTable({
  experiments = [],
  selectedId,
  selectedDetail,
  onSelectExperiment,
  statusFilter,
  onChangeStatusFilter,
  sortDirection,
  onToggleSortDirection,
  pagination,
  offset = 0,
  limit = 10,
  onPrevPage,
  onNextPage,
  loading = false,
  error = null,
}) {
  const pageLabel = pagination?.pageLabel || `Page ${Math.floor(offset / limit) + 1}`;
  const hasPrev = pagination ? pagination.hasPrev : offset > 0;
  const hasNext = pagination ? pagination.hasNext : experiments.length >= limit;

  return (
    <div className="rounded-xl bg-surface border border-border p-5 shadow-md space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-accent-ink" />
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider font-mono">
            Audit Trail ({pageLabel} · {experiments.length} loaded)
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              aria-label="Filter status of loaded experiments"
              value={statusFilter}
              onChange={(e) => onChangeStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer"
            >
              <option value="all">All statuses (loaded page)</option>
              <option value="COMPLETED">Completed</option>
              <option value="ABORTED_SLO_BREACH">Aborted (SLO)</option>
              <option value="MANUAL_STOP">Manually Stopped</option>
              <option value="RUNNING">Running</option>
            </select>
          </div>

          {/* Sort Order Toggle */}
          <button
            type="button"
            onClick={onToggleSortDirection}
            className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground font-mono transition-colors cursor-pointer"
            title="Toggle sort direction by start time"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span>{sortDirection === 'desc' ? 'Newest' : 'Oldest'}</span>
          </button>
        </div>
      </div>

      <div className="text-[11px] font-mono text-muted-foreground">
        Status filter applies to loaded page only. Peak P95 is derived from detail snapshots of the selected drill.
      </div>

      {/* Error Banner */}
      {error && (
        <ErrorBanner
          title="History Refresh Notice"
          message={error}
        />
      )}

      {/* Loading Indicator */}
      {loading && !experiments.length && (
        <div className="py-12 text-center text-xs font-mono text-muted-foreground">
          Loading experiment records…
        </div>
      )}

      {/* Empty State */}
      {!loading && experiments.length === 0 && (
        <EmptyState
          icon={<Activity aria-hidden="true" />}
          title="No Experiments Found"
          description="No experiment records match the active filter on this loaded page."
        />
      )}

      {/* Desktop Table View (>= 640px) */}
      {experiments.length > 0 && (
        <div className="hidden sm:block overflow-x-auto" role="region" aria-label="Experiment history table; scroll horizontally on narrow screens" tabIndex={0}>
          <table className="w-full whitespace-nowrap text-left text-xs font-mono">
            <thead className="bg-background text-muted-foreground border-b border-border uppercase text-[10px] tracking-wider select-none">
              <tr>
                <th scope="col" className="py-2.5 px-3">Run ID</th>
                <th scope="col" className="py-2.5 px-3">Fault Type</th>
                <th scope="col" className="py-2.5 px-3">Started</th>
                <th scope="col" className="py-2.5 px-3">Duration</th>
                <th scope="col" className="py-2.5 px-3">Peak P95</th>
                <th scope="col" className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 text-foreground">
              {experiments.map((exp) => {
                const row = formatRowData(exp, selectedDetail);
                const isSelected = selectedId === row.id;

                return (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={() => onSelectExperiment(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectExperiment(row.id);
                      }
                    }}
                    className={`transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring ${
                      isSelected
                        ? 'bg-primary/10 font-semibold'
                        : 'hover:bg-background/70'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-mono text-accent-ink font-medium" title={row.id}>
                      {row.shortId}
                    </td>
                    <td className="py-2.5 px-3 text-foreground">
                      {row.faultLabel}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {row.startedFormatted}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {row.durationFormatted}
                    </td>
                    <td className="py-2.5 px-3 text-warning font-semibold" title={isSelected ? 'Peak P95 from telemetry snapshots' : 'Select row to inspect peak P95'}>
                      {row.peakP95}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <ExperimentStatusBadge
                        status={row.statusBadge.label}
                        abortReason={exp.abort_reason}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile Stacked Cards (< 640px) */}
      {experiments.length > 0 && (
        <div className="sm:hidden space-y-2.5">
          {experiments.map((exp) => {
            const row = formatRowData(exp, selectedDetail);
            const isSelected = selectedId === row.id;

            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                onClick={() => onSelectExperiment(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectExperiment(row.id);
                  }
                }}
                className={`p-3.5 rounded-xl border text-xs font-mono transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring ${
                  isSelected
                    ? 'bg-primary/10 border-accent-ink'
                    : 'bg-background border-border hover:border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-accent-ink font-semibold" title={row.id}>
                    {row.shortId}
                  </span>
                  <ExperimentStatusBadge
                    status={row.statusBadge.label}
                    abortReason={exp.abort_reason}
                  />
                </div>
                <div className="text-foreground font-semibold text-sm mb-1">{row.faultLabel}</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground border-t border-border/60 pt-2 mt-2">
                  <div>
                    <span>Started: </span>
                    <span className="text-foreground">{row.startedFormatted}</span>
                  </div>
                  <div>
                    <span>Duration: </span>
                    <span className="text-foreground">{row.durationFormatted}</span>
                  </div>
                  <div>
                    <span>Peak P95: </span>
                    <span className="text-warning font-semibold">{row.peakP95}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border text-xs font-mono text-muted-foreground">
        <button
          type="button"
          aria-label="Previous page"
          disabled={!hasPrev}
          onClick={onPrevPage}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Previous</span>
        </button>

        <span className="font-semibold text-foreground">
          {pageLabel}
        </span>

        <button
          type="button"
          aria-label="Next page"
          disabled={!hasNext}
          onClick={onNextPage}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:text-foreground transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span>Next</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
