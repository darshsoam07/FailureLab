import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Filter,
  Activity,
  Layers,
} from 'lucide-react';
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
  offset,
  limit,
  totalLoaded,
  onPrevPage,
  onNextPage,
  loading = false,
  error = null,
}) {
  return (
    <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-md space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1E2942]">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[#00e5ff]" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
            Audit Trail ({experiments.length} of {totalLoaded} loaded)
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs font-mono">
            <Filter className="h-3.5 w-3.5 text-[#849396]" />
            <select
              aria-label="Filter status of loaded experiments"
              value={statusFilter}
              onChange={(e) => onChangeStatusFilter(e.target.value)}
              className="rounded-lg border border-[#1E2942] bg-[#0B1020] px-2.5 py-1 text-xs text-[#dee1f9] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff] cursor-pointer"
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
            className="flex items-center gap-1 rounded-lg border border-[#1E2942] bg-[#0B1020] px-2.5 py-1 text-xs text-[#849396] hover:text-white font-mono transition-colors cursor-pointer"
            title="Toggle sort direction by start time"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span>{sortDirection === 'desc' ? 'Newest' : 'Oldest'}</span>
          </button>
        </div>
      </div>

      <div className="text-[11px] font-mono text-[#849396]">
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
        <div className="py-12 text-center text-xs font-mono text-[#849396]">
          Loading experiment records…
        </div>
      )}

      {/* Empty State */}
      {!loading && experiments.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No Experiments Found"
          message="No experiment records match the active filter on this loaded page."
        />
      )}

      {/* Desktop Table View (>= 640px) */}
      {experiments.length > 0 && (
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0B1020] text-[#849396] border-b border-[#1E2942] uppercase text-[10px] tracking-wider select-none">
              <tr>
                <th scope="col" className="py-2.5 px-3">Run ID</th>
                <th scope="col" className="py-2.5 px-3">Fault Type</th>
                <th scope="col" className="py-2.5 px-3">Started</th>
                <th scope="col" className="py-2.5 px-3">Duration</th>
                <th scope="col" className="py-2.5 px-3">Peak P95</th>
                <th scope="col" className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2942]/60 text-[#dee1f9]">
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
                    className={`transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#00e5ff] ${
                      isSelected
                        ? 'bg-[#00e5ff]/10 font-semibold'
                        : 'hover:bg-[#0B1020]/70'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-mono text-[#00e5ff] font-medium" title={row.id}>
                      {row.shortId}
                    </td>
                    <td className="py-2.5 px-3 text-white">
                      {row.faultLabel}
                    </td>
                    <td className="py-2.5 px-3 text-[#849396]">
                      {row.startedFormatted}
                    </td>
                    <td className="py-2.5 px-3 text-[#849396]">
                      {row.durationFormatted}
                    </td>
                    <td className="py-2.5 px-3 text-amber-300 font-semibold" title={isSelected ? 'Peak P95 from telemetry snapshots' : 'Select row to inspect peak P95'}>
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
                className={`p-3.5 rounded-xl border text-xs font-mono transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#00e5ff] ${
                  isSelected
                    ? 'bg-[#00e5ff]/10 border-[#00e5ff]'
                    : 'bg-[#0B1020] border-[#1E2942] hover:border-[#22304D]'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[#00e5ff] font-semibold" title={row.id}>
                    {row.shortId}
                  </span>
                  <ExperimentStatusBadge
                    status={row.statusBadge.label}
                    abortReason={exp.abort_reason}
                  />
                </div>
                <div className="text-white font-semibold text-sm mb-1">{row.faultLabel}</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-[#849396] border-t border-[#1E2942]/60 pt-2 mt-2">
                  <div>
                    <span>Started: </span>
                    <span className="text-[#dee1f9]">{row.startedFormatted}</span>
                  </div>
                  <div>
                    <span>Duration: </span>
                    <span className="text-[#dee1f9]">{row.durationFormatted}</span>
                  </div>
                  <div>
                    <span>Peak P95: </span>
                    <span className="text-amber-300 font-semibold">{row.peakP95}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#1E2942] text-xs font-mono text-[#849396]">
        <button
          type="button"
          aria-label="Previous page"
          disabled={offset === 0}
          onClick={onPrevPage}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E2942] bg-[#0B1020] hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Previous</span>
        </button>

        <span>
          Page {Math.floor(offset / limit) + 1} (showing {experiments.length} of loaded)
        </span>

        <button
          type="button"
          aria-label="Next page"
          disabled={totalLoaded <= offset + limit}
          onClick={onNextPage}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E2942] bg-[#0B1020] hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span>Next</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
