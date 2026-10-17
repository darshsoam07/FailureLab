import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, Terminal } from 'lucide-react';
import { api } from './api/client';
import TopologyBanner from './components/TopologyBanner';
import ExperimentLauncher from './components/ExperimentLauncher';
import ExperimentHistoryAndAIReport from './components/ExperimentHistoryAndAIReport';
import { usePolling } from './hooks/usePolling';
const LiveTelemetryPanel = lazy(() => import('./components/LiveTelemetryPanel'));

export default function App({ client = api }) {
  const [busy, setBusy] = useState(false);
  const loadExperiments = useCallback(signal => client.getExperiments({ limit: 100, signal }), [client]);
  const loadCatalog = useCallback(signal => client.getExperimentCatalog({ signal }), [client]);
  const history = usePolling(loadExperiments, 2000, !busy);
  const catalog = usePolling(loadCatalog, 30000);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const mutation = useRef(null);
  const loaded = history.data !== null;
  const error = history.error || catalog.error;
  const experiment = history.data?.find(row => ['RUNNING', 'PLANNED'].includes(row.status)) ?? null;
  const blocked = !loaded || !catalog.data || Boolean(error) || uncertain;
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => { if (history.data && !history.error) setUncertain(false); }, [history.data, history.error]);
  async function change(action, body) {
    if (mutation.current) throw new Error('Another experiment change is in progress.');
    if (action === 'start' && (blocked || experiment)) throw new Error('Wait for a current control plane with no active experiment.');
    const controller = new AbortController();
    mutation.current = controller; setBusy(true); setNotice('');
    // Cancel older history reads so they cannot overwrite a confirmed mutation.
    history.refresh();
    try {
      const result = action === 'start' ? await client.startExperiment(body, { signal: controller.signal }) : await client.stopExperiment(body, { signal: controller.signal });
      if (controller.signal.aborted) return;
      history.setData(rows => [result, ...(rows ?? []).filter(row => row.id !== result.id)]);
      setNotice(action === 'start' ? `Started ${result.name}.` : `Fault cleanup confirmed for ${result.name}. ${result.abort_reason ?? result.status}`);
    } catch (error) {
      if (!controller.signal.aborted) { setUncertain(true); setNotice(`Change not confirmed: ${error.message} Refreshing control-plane state.`); }
      throw error;
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) { setBusy(false); history.refresh(); setRevision(value => value + 1); }
    }
  }
  const launch = body => change('start', body);
  return <div className="min-h-screen bg-ink text-slate-100">
    <header className="border-b border-edge bg-panel/70">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-5 sm:px-10">
        <a href="#main" className="flex items-center gap-3 font-semibold tracking-tight"><span className="rounded-lg border border-mint/30 bg-mint/10 p-2 text-mint"><FlaskConical size={22} /></span><span>FailureLab<span className="ml-2 font-mono text-xs font-normal text-slate-500">/ RELIABILITY</span></span></a>
        <span className="hidden items-center gap-2 rounded-full border border-edge px-3 py-1.5 font-mono text-[10px] text-slate-400 sm:flex"><Terminal size={12} /> SRE COMMAND CENTER</span>
      </div>
    </header>
    <main id="main" className="mx-auto max-w-[1440px] space-y-7 px-5 py-8 sm:px-10 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow text-mint">Observe. Disrupt. Understand.</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Reliability, under pressure.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Trace the request path. Watch your guardrails. See how the system responds when dependencies fail.</p></div>
        <span className="rounded-lg border border-edge bg-panel px-3 py-2 font-mono text-xs text-slate-300">{!loaded || error ? 'AWAITING CONTROL PLANE' : experiment ? `EXPERIMENT ${experiment.status}` : 'STANDBY'}</span>
      </div>
      {error && <p role="alert" className="text-sm text-amber-300">Control plane: {error}</p>}
      {notice && <p role="status" className="rounded-lg border border-edge bg-panel px-4 py-3 text-sm text-slate-200">{notice}</p>}
      <TopologyBanner experiment={experiment} stale={!loaded || Boolean(error)} />
      <Suspense fallback={<p className="text-sm text-slate-400">Loading telemetry panel…</p>}>
        <LiveTelemetryPanel experiment={experiment} experimentStale={!loaded || Boolean(error)} client={client} />
      </Suspense>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ExperimentLauncher catalog={catalog.data} activeExperiment={experiment} blocked={blocked} busy={busy} onLaunch={launch} onStop={id => change('stop', id)} />
        <ExperimentHistoryAndAIReport catalog={catalog.data} blocked={blocked || Boolean(experiment)} busy={busy} onLaunch={launch} revision={revision} client={client} />
      </div>
      <footer className="flex flex-wrap justify-between gap-3 border-t border-edge pt-5 font-mono text-[10px] uppercase tracking-widest text-slate-500"><span>FailureLab / AI-assisted reliability experiments</span><span>Transactional outbox · Idempotent fulfillment · SLO guardrails</span></footer>
    </main>
  </div>;
}
