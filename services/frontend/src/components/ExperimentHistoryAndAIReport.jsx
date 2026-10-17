import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BrainCircuit, Play, X } from 'lucide-react';
import { api } from '../api/client';
import { buildProposal } from '../api/experiments';
import { usePolling } from '../hooks/usePolling';

export function StatusBadge({ experiment }) {
  const style = experiment.status === 'ABORTED_SLO_BREACH' ? 'border-red-400/30 bg-red-400/10 text-red-300'
    : experiment.status === 'COMPLETED' && !experiment.abort_reason ? 'border-mint/30 bg-mint/10 text-mint'
      : 'border-amber-400/30 bg-amber-400/10 text-amber-200';
  return <span className={`inline-block rounded-md border px-2 py-1 font-mono text-[10px] ${style}`}>{experiment.status}{experiment.abort_reason && experiment.status === 'COMPLETED' ? ' / STOPPED' : ''}</span>;
}

function PostMortem({ id, catalog, blocked, busy, onLaunch, onClose, client }) {
  const load = useCallback(signal => client.getExperiment(id, { signal }), [client, id]);
  const { data: detail, error } = usePolling(load);
  const [launchError, setLaunchError] = useState('');
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const report = detail?.ai_report;
  let proposalBody = null;
  let proposalError = '';
  if (report && catalog) {
    try { proposalBody = buildProposal(catalog, detail, report.next_experiment_proposal); }
    catch (error) { proposalError = error.message; }
  }
  async function launchProposal() {
    setLaunchError('');
    try { await onLaunch(proposalBody); } catch (error) { setLaunchError(error.message); }
  }
  const confidence = Math.min(100, Math.max(0, Number(report?.confidence_score ?? 0) * 100));
  return <section aria-labelledby="postmortem-title" className="mt-6 min-w-0 rounded-xl border border-mint/25 bg-ink/60 p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-mint">AI SRE analysis</p><h3 ref={heading} tabIndex={-1} id="postmortem-title" className="mt-2 text-lg font-semibold">AI SRE Post-Mortem Panel</h3></div><button type="button" onClick={onClose} aria-label="Close AI report" className="rounded p-2 text-slate-400 hover:text-white"><X size={18} /></button></div>
    {error && <p role="alert" className="mt-4 text-sm text-amber-300">Report refresh failed: {error}</p>}
    {!detail && !error && <p role="status" className="mt-4 text-sm text-slate-400">Loading experiment…</p>}
    {detail && <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3"><span className="break-words text-sm">{detail.name}</span><StatusBadge experiment={detail} /></div>
      {detail.abort_reason && <p className="break-words rounded-lg border border-amber-400/20 p-3 text-xs text-amber-200">Stop reason: {detail.abort_reason}</p>}
      {!report ? <p role="status" className="text-sm leading-6 text-slate-400">{['RUNNING', 'PLANNED'].includes(detail.status) ? 'Analysis is generated after the experiment finishes.' : 'AI analysis is pending. This panel refreshes automatically; if it remains pending, check the AI worker and analysis queue.'}</p> : <>
        <div><h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Root cause assessment</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{report.root_cause_summary}</p></div>
        <div><label htmlFor="confidence" className="flex justify-between text-xs text-slate-400"><span>Analysis confidence</span><span>{confidence.toFixed(0)}%</span></label><progress id="confidence" max="100" value={confidence} className="mt-2 h-2 w-full accent-mint" /><p className="mt-1 text-[11px] text-slate-500">Model assessment, not a probability guarantee.</p></div>
        <div><h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Evidence</h4><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">{report.evidence_bullets.map((bullet, index) => <li key={index} className="break-words">{bullet}</li>)}</ul></div>
        <div><h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recommended fix</h4><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-edge bg-ink p-4 font-mono text-xs leading-6 text-mint"><code>{report.recommended_fix}</code></pre></div>
        <div className="rounded-lg border border-edge p-4">
          <h4 className="text-sm font-semibold">Next proposed experiment</h4><p className="mt-2 break-words text-sm leading-6 text-slate-400">{report.next_experiment_proposal?.rationale}</p>
          {proposalBody && <><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{proposalBody.fault_type} {JSON.stringify(proposalBody.parameters, null, 2)}</pre><p className="my-3 text-xs leading-5 text-slate-400">Retains {proposalBody.duration_seconds}s duration, {(proposalBody.slo_max_error_rate * 100).toFixed(2)}% maximum errors, and {proposalBody.slo_max_p95_ms}ms P95.</p></>}
          <button type="button" onClick={launchProposal} disabled={blocked || busy || Boolean(error) || !proposalBody} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-mint/40 bg-mint/10 px-3 py-3 text-sm font-semibold text-mint hover:bg-mint/20 disabled:cursor-not-allowed disabled:opacity-50"><Play size={16} aria-hidden="true" />Run AI's Next Proposed Experiment</button>
          {(blocked || busy) && <p className="mt-2 text-xs text-slate-400">Available when the control plane is current and no experiment is active.</p>}
          {proposalError && <p role="alert" className="mt-3 text-sm text-amber-300">Proposal cannot run: {proposalError}</p>}
          {launchError && <p role="alert" className="mt-3 text-sm text-red-300">{launchError}</p>}
        </div>
      </>}
    </div>}
  </section>;
}

export default function ExperimentHistoryAndAIReport({ catalog, blocked, busy, onLaunch, revision = 0, client = api }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const selectedButton = useRef(null);
  const load = useCallback(async signal => ({ offset, rows: await client.getExperiments({ limit: 11, offset, signal }) }), [client, offset, revision]);
  const { data, error } = usePolling(load);
  const rows = data?.offset === offset ? data.rows : null;
  return <section aria-labelledby="history-title" className="min-w-0 rounded-2xl border border-edge bg-panel p-5 sm:p-7">
    <div className="mb-5 flex items-center justify-between"><h2 id="history-title" className="eyebrow">04 / Experiment history & AI reports</h2><BrainCircuit size={20} className="text-mint" aria-hidden="true" /></div>
    {error && <p role="alert" className="mb-4 text-sm text-amber-300">History refresh failed: {error}</p>}
    {!rows && !error && <p className="text-sm text-slate-400">Loading experiment history…</p>}
    {rows?.length === 0 && <p className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-slate-400">No experiments yet. Enable background traffic, then launch your first fault.</p>}
    <ul className="divide-y divide-edge">{rows?.slice(0, 10).map(row => <li key={row.id}>
      <button type="button" aria-expanded={selected === row.id} onClick={event => { selectedButton.current = event.currentTarget; setSelected(row.id); }} className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-4 text-left hover:bg-slate-800/50 ${selected === row.id ? 'bg-slate-800/50 ring-1 ring-mint/30' : ''}`}>
        <span className="min-w-0"><span className="block break-words text-sm font-medium">{row.name}</span><span className="mt-1 block text-xs text-slate-400">{row.fault_type} · {row.started_at ? new Date(row.started_at).toLocaleString() : 'Preparing'}</span></span><StatusBadge experiment={row} />
      </button>
    </li>)}</ul>
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-400">
      <button type="button" aria-label="Previous history page" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 10))} className="rounded border border-edge p-2 disabled:opacity-30"><ArrowLeft size={16} /></button><span>Page {offset / 10 + 1}</span><button type="button" aria-label="Next history page" disabled={!rows || rows.length <= 10 || Boolean(error)} onClick={() => setOffset(value => value + 10)} className="rounded border border-edge p-2 disabled:opacity-30"><ArrowRight size={16} /></button>
    </div>
    {selected && <PostMortem key={selected} id={selected} catalog={catalog} blocked={blocked} busy={busy} onLaunch={onLaunch} client={client} onClose={() => { setSelected(null); selectedButton.current?.focus(); }} />}
  </section>;
}
