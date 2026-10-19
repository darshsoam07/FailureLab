import { startVisiblePolling } from '../../lib/visiblePolling.js';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrainCircuit, Sparkles, Download, RefreshCw, ArrowRight, ShieldAlert, Info, X } from 'lucide-react';
import { ErrorBanner } from '../common/ErrorBanner.jsx';
import { ExperimentStatusBadge } from '../common/StatusBadge.jsx';
import { formatConfidence, extractReportMeta, buildExportJson } from '../../lib/reportsLogic.js';
import { buildProposal, FAULT_LABELS } from '../../api/experiments.js';

/**
 * AI Post-Mortem Panel for selected experiment.
 * Fetches detail once on selection; gentle poll only if finished without report (60s cap).
 */
export function PostMortemPanel({
  experimentId,
  catalog,
  client,
  onStageProposal,
  onClose,
  onDetail,
}) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pollSeconds, setPollSeconds] = useState(0);
  const [revision, setRevision] = useState(0);
  const fetchDetail = () => setRevision(value => value + 1);
  useEffect(() => {
    setLoading(true); setDetail(null); setError(null); setPollSeconds(0);
    onDetail?.(null);
    let attempts = 0;
    const polling = startVisiblePolling(async signal => {
      try {
        const data = await client.getExperiment(experimentId, { signal });
        if (signal.aborted) return false;
        setDetail(data); onDetail?.(data); setError(null);
        attempts += 1;
        setPollSeconds(Math.min(60, attempts * 3));
        return !data.ai_report && attempts < 20;
      } catch (err) {
        if (!signal.aborted) setError(err.message || 'Failed to fetch experiment detail');
        return false;
      } finally { if (!signal.aborted) setLoading(false); }
    }, 3000);
    return () => polling.stop();
  }, [client, experimentId, revision, onDetail]);

  // Handle Export JSON
  function handleExportJson() {
    if (!detail) return;
    try {
      const { filename, jsonString } = buildExportJson({
        experiment: detail,
        snapshots: detail.telemetry_snapshots || [],
        aiReport: detail.ai_report,
      });

      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    }
  }

  // Handle Loading Proposal into Launcher (Never auto-launches)
  function handleLoadProposal() {
    if (!detail?.ai_report?.next_experiment_proposal || !catalog) return;
    try {
      const proposalBody = buildProposal(
        catalog,
        detail,
        detail.ai_report.next_experiment_proposal
      );
      onStageProposal(proposalBody);
    } catch (err) {
      setError(`Cannot stage proposal: ${err.message}`);
    }
  }

  const report = detail?.ai_report;
  const meta = report ? extractReportMeta(report) : null;
  const isRunning = ['RUNNING', 'PLANNED'].includes(detail?.status);
  const isFinished = ['COMPLETED', 'ABORTED_SLO_BREACH'].includes(detail?.status);
  const confidencePct = report ? formatConfidence(report.confidence_score) : 0;

  return (
    <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-md space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#1E2942]">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <BrainCircuit className="h-5 w-5 text-purple-400" />
            <h3 className="text-base font-bold text-white tracking-tight">
              AI SRE Post-Mortem Panel
            </h3>
            {meta?.reportSource && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950/60 text-purple-300 border border-purple-800/40">
                {meta.reportSource}
              </span>
            )}
          </div>
          {detail && (
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-[#9aa9ac]">
              <span>ID: <strong className="text-white">{detail.id}</strong></span>
              <span>·</span>
              <ExperimentStatusBadge
                experiment={detail}
                status={detail.status}
                abortReason={detail.abort_reason}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {detail && (
            <button
              type="button"
              onClick={handleExportJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E2942] bg-[#0B1020] hover:text-white text-xs font-mono text-[#00e5ff] transition-all cursor-pointer shadow-sm"
              title="Export Experiment Audit JSON (no secrets or URLs)"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export JSON</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close post-mortem panel"
              className="p-1.5 rounded-lg text-[#9aa9ac] hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="space-y-2">
          <ErrorBanner title="Analysis Fetch Failed" message={error} />
          <button
            type="button"
            onClick={() => fetchDetail()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E2942] bg-[#0B1020] text-xs font-mono text-[#dee1f9] hover:text-white cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !detail && (
        <div className="py-12 text-center text-xs font-mono text-[#9aa9ac]">
          Loading experiment post-mortem analysis…
        </div>
      )}

      {/* State 1: Running experiment */}
      {detail && isRunning && (
        <div className="p-4 rounded-xl bg-[#0B1020] border border-[#1E2942] text-xs font-mono text-[#9aa9ac] space-y-1">
          <div className="text-white font-semibold">No report for running experiments</div>
          <p>
            AI post-mortem analysis is synthesized automatically after the experiment finishes and telemetry snapshots are finalized.
          </p>
        </div>
      )}

      {/* State 2: Finished but Report Pending */}
      {detail && isFinished && !report && !loading && (
        <div className="p-5 rounded-xl bg-purple-950/20 border border-purple-500/40 text-xs font-mono space-y-3">
          <div className="flex items-center gap-2 text-purple-300 font-bold uppercase tracking-wider">
            <RefreshCw className={`h-4 w-4 ${pollSeconds < 60 ? 'animate-spin' : ''}`} />
            <span>Report Pending</span>
          </div>
          <p className="text-[#dee1f9]">
            The experiment has ended, and telemetry snapshots are queued for AI worker synthesis.
            {pollSeconds < 60
              ? ` Actively checking for report (${pollSeconds}s / 60s max auto-poll)…`
              : ' Auto-poll window closed.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setPollSeconds(0);
              fetchDetail();
            }}
            className="px-3 py-1.5 rounded-lg bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-500/50 font-semibold cursor-pointer"
          >
            Refresh Now
          </button>
        </div>
      )}

      {/* State 3: Report Loaded */}
      {detail && report && (
        <div className="space-y-5">
          {/* Unconfirmed Circuit-Breaker / Retry Alert */}
          {meta?.isUnconfirmed && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/60 text-xs font-mono text-amber-200 space-y-1.5 shadow-sm">
              <div className="flex items-center gap-2 text-amber-300 font-bold uppercase tracking-wider">
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                <span>Unconfirmed Behavior Note (From Telemetry Facts)</span>
              </div>
              <p className="leading-relaxed text-[#dee1f9]">
                {meta.unconfirmedText}
              </p>
            </div>
          )}

          {/* Root Cause Assessment */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-[#9aa9ac]">
              Root Cause Assessment
            </h4>
            <div className="p-4 rounded-xl bg-[#0B1020] border border-[#1E2942] text-xs font-mono text-[#dee1f9] leading-relaxed">
              {report.root_cause_summary}
            </div>
          </div>

          {/* Heuristic Confidence Gauge */}
          <div className="p-4 rounded-xl bg-[#0B1020] border border-[#1E2942] space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#9aa9ac] font-semibold uppercase tracking-wider">
                Heuristic Confidence
              </span>
              <span className="text-white font-bold">{confidencePct}%</span>
            </div>
            <progress
              value={confidencePct}
              max="100"
              aria-label="Heuristic confidence score"
              className="h-2 w-full rounded-full overflow-hidden bg-[#1E2942] accent-[#00e5ff]"
            />
            <p className="text-[10px] font-mono text-[#9aa9ac]">
              Model assessment, not a probability guarantee. Bounded by verified telemetry facts.
            </p>
          </div>

          {/* Evidence Bullets */}
          {meta?.regularBullets && meta.regularBullets.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-[#9aa9ac]">
                Verified Evidence ({meta.regularBullets.length} points)
              </h4>
              <div className="space-y-1.5">
                {meta.regularBullets.map((bullet, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942] text-[11px] font-mono text-[#dee1f9] flex items-start gap-2"
                  >
                    <span className="text-[#00e5ff] font-bold mt-0.5">•</span>
                    <span className="break-words leading-relaxed">{bullet}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Fix */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-[#9aa9ac]">
              Recommended Fix
            </h4>
            <pre className="p-4 rounded-xl bg-[#080d1d] border border-[#1E2942] text-xs font-mono text-[#00e5ff] overflow-x-auto whitespace-pre-wrap leading-relaxed">
              <code>{report.recommended_fix}</code>
            </pre>
          </div>

          {/* Next Proposed Experiment */}
          {report.next_experiment_proposal && (
            <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-500/40 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-400" />
                  <span className="text-xs font-bold font-mono text-purple-200 uppercase tracking-wider">
                    Next Proposed Experiment
                  </span>
                </div>
                <span className="text-[10px] font-mono text-purple-300 bg-purple-900/60 px-2 py-0.5 rounded border border-purple-500/40">
                  {FAULT_LABELS[report.next_experiment_proposal.fault_type] || report.next_experiment_proposal.fault_type}
                </span>
              </div>

              <p className="text-xs text-[#dee1f9] font-mono leading-relaxed">
                {report.next_experiment_proposal.rationale}
              </p>

              {report.next_experiment_proposal.suggested_parameters && (
                <div className="p-2.5 rounded-lg bg-[#0B1020] border border-[#1E2942] text-[11px] font-mono text-[#9aa9ac]">
                  Suggested: {JSON.stringify(report.next_experiment_proposal.suggested_parameters)}
                </div>
              )}

              <button
                type="button"
                onClick={handleLoadProposal}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white px-4 py-2.5 text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer shadow-md"
              >
                <span>Load Proposal into Launcher</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1.5 text-[10px] font-mono text-purple-300/80 pt-1">
                <Info className="h-3 w-3 shrink-0" />
                <span>AI suggestions are advisory and need your approval. Never launches directly.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
