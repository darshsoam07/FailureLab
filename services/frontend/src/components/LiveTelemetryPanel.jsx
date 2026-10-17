import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCheck, Gauge, Radio, ShieldCheck } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';

const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function Card({ title, value, caption, Icon, color = 'text-slate-100' }) {
  return <div className="rounded-xl border border-edge bg-panel p-5">
    <div className="flex items-center justify-between gap-2 text-xs text-slate-400"><span>{title}</span><Icon size={17} aria-hidden="true" /></div>
    <p className={`mt-4 font-mono text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
    <p className="mt-2 text-xs text-slate-400">{caption}</p>
  </div>;
}

export default function LiveTelemetryPanel({ experiment = null, experimentStale = false, client = api }) {
  const [metrics, setMetrics] = useState(null);
  const [traffic, setTraffic] = useState(null);
  const [points, setPoints] = useState([]);
  const [errors, setErrors] = useState({});
  const [rps, setRps] = useState(5);
  const [busy, setBusy] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const [updated, setUpdated] = useState(null);
  const mutation = useRef(false);
  const version = useRef(0);
  const operation = useRef(null);
  const mounted = useRef(false);
  const metricsSince = experiment?.status === 'RUNNING' ? experiment.started_at : undefined;

  useEffect(() => {
    mounted.current = true;
    setPoints([]);
    setMetrics(null);
    const controller = new AbortController();
    let timer;
    async function poll() {
      const started = performance.now();
      const generation = version.current;
      await Promise.all([
        client.getMetricsSummary({ signal: controller.signal, since: metricsSince }).then(data => {
          if (controller.signal.aborted) return;
          const now = Date.now();
          setMetrics(data); setUpdated(now);
          setErrors(previous => ({ ...previous, metrics: null }));
          setPoints(previous => [...previous, { timestamp: now, p95: data.p95_latency_ms }].slice(-90));
        }).catch(error => {
          if (controller.signal.aborted) return;
          setErrors(previous => ({ ...previous, metrics: error.message }));
          setPoints(previous => [...previous, { timestamp: Date.now(), p95: null }].slice(-90));
        }),
        client.getTrafficStatus({ signal: controller.signal }).then(data => {
          if (controller.signal.aborted || mutation.current || generation !== version.current) return;
          setTraffic(data);
          setErrors(previous => ({ ...previous, traffic: null }));
        }).catch(error => {
          if (!controller.signal.aborted && !mutation.current && generation === version.current)
            setErrors(previous => ({ ...previous, traffic: error.message }));
        }),
      ]);
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.max(0, 2000 - (performance.now() - started)));
    }
    poll();
    return () => { mounted.current = false; controller.abort(); operation.current?.abort(); clearTimeout(timer); };
  }, [client, metricsSince]);

  async function toggle() {
    if (mutation.current || !traffic || errors.traffic) return;
    mutation.current = true; version.current += 1;
    setBusy(true); setToggleError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await client.toggleTraffic(!traffic.active, traffic.active ? traffic.requests_per_second : rps, { signal: controller.signal });
      if (mounted.current) { setTraffic(result); setErrors(previous => ({ ...previous, traffic: null })); }
    } catch (error) {
      if (mounted.current) {
        setToggleError(error.message);
        setErrors(previous => ({ ...previous, traffic: 'Refreshing traffic state after an unconfirmed change…' }));
      }
    } finally {
      mutation.current = false; version.current += 1;
      if (mounted.current) setBusy(false);
    }
  }

  const fresh = metrics && !errors.metrics;
  const running = experiment?.status === 'RUNNING' && !experimentStale;
  const threshold = running ? experiment.slo_max_p95_ms : null;
  const breach = running && fresh && (metrics.error_rate > experiment.slo_max_error_rate || metrics.p95_latency_ms > threshold);
  const slo = !fresh || experimentStale ? 'UNKNOWN' : !running ? 'NOT ARMED' : metrics.total_orders === 0 ? 'NO TRAFFIC' : breach ? 'BREACHED' : 'WITHIN SLO';

  return <section aria-label="Live telemetry" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="eyebrow">02 / Live telemetry</h2><p className="mt-2 text-sm text-slate-400">{metricsSince ? 'Experiment-only metrics · up to last 60 seconds' : 'Rolling 60-second metrics'} · sampled every 2 seconds</p></div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-panel px-4 py-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">Target RPS
          <select aria-label="Target requests per second" value={traffic?.active ? traffic.requests_per_second : rps} onChange={event => setRps(Number(event.target.value))} disabled={busy || traffic?.active} className="rounded border border-edge bg-ink px-2 py-1 text-slate-100 disabled:opacity-60">
            {Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
          </select>
        </label>
        <button type="button" role="switch" aria-checked={Boolean(traffic?.active)} aria-label="Background Traffic" disabled={busy || !traffic || Boolean(errors.traffic)} onClick={toggle} className="flex items-center gap-3 rounded-lg px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">
          <span>Background Traffic {busy ? 'UPDATING' : !traffic || errors.traffic ? 'UNKNOWN' : traffic.active ? 'ON' : 'OFF'}</span>
          <span aria-hidden="true" className={`flex h-6 w-10 items-center rounded-full p-1 transition-colors ${traffic?.active ? 'bg-mint' : 'bg-slate-600'}`}><span className={`h-4 w-4 rounded-full bg-ink transition-transform ${traffic?.active ? 'translate-x-4' : ''}`} /></span>
        </button>
      </div>
    </div>
    {(errors.metrics || errors.traffic || toggleError) && <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
      <AlertTriangle className="mr-2 inline" size={16} aria-hidden="true" />
      {[errors.metrics && `Telemetry: ${errors.metrics}`, errors.traffic && `Traffic: ${errors.traffic}`, toggleError].filter(Boolean).join(' ')}
    </div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card title="Live P95 Latency" Icon={Gauge} value={fresh ? `${number(metrics.p95_latency_ms)} ms` : '—'} caption={threshold !== null ? `SLO ceiling ${number(threshold)} ms` : 'Completed orders in the last 60s'} />
      <Card title="Error Rate" Icon={Activity} value={fresh ? `${number(metrics.error_rate * 100)}%` : '—'} caption={running ? `SLO ceiling ${number(experiment.slo_max_error_rate * 100)}%` : 'Failed / all orders in the last 60s'} color={breach ? 'text-amber-300' : 'text-slate-100'} />
      <Card title="Orders Succeeded / Failed" Icon={CheckCheck} value={fresh ? `${number(metrics.succeeded)} / ${number(metrics.failed)}` : '—'} caption={fresh ? `${number(metrics.pending_count)} pending · ${number(metrics.total_orders)} total` : 'Waiting for Order API'} />
      <Card title="SLO Status" Icon={ShieldCheck} value={<span className="inline-flex rounded-md border border-current/30 px-2 py-1 text-sm">{slo}</span>} caption="Auto-abort after 3 consecutive breaches" color={slo === 'WITHIN SLO' ? 'text-mint' : slo === 'BREACHED' ? 'text-amber-300' : 'text-slate-400'} />
    </div>
    <div className="rounded-2xl border border-edge bg-panel p-5 sm:p-7">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Latency over time</h3><p className="mt-1 text-xs text-slate-400">P95 response latency / milliseconds</p></div>
        <div className="flex items-center gap-5 text-xs"><span className="text-mint">● P95 latency</span><span className="text-amber-300">┄ {threshold === null ? 'SLO not armed' : `SLO ${number(threshold)} ms`}</span></div>
      </div>
      <div className="h-72 w-full" role="img" aria-label="Live P95 latency chart with the current experiment SLO threshold">
        {points.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={points} margin={{ top: 8, right: 15, bottom: 8, left: 0 }} accessibilityLayer>
            <CartesianGrid stroke="#253244" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={time} minTickGap={65} stroke="#94a3b8" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 'auto']} width={48} />
            <Tooltip labelFormatter={time} formatter={value => [`${number(value)} ms`, 'P95 latency']} contentStyle={{ background: '#101722', border: '1px solid #253244', borderRadius: 10, color: '#e2e8f0' }} />
            {threshold !== null && <ReferenceLine y={threshold} stroke="#fbbf24" strokeDasharray="6 5" ifOverflow="extendDomain" />}
            <Line type="linear" dataKey="p95" stroke="#71e4c2" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-400">Waiting for the first telemetry sample…</div>}
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-edge pt-4 font-mono text-[11px] text-slate-400">
        <span className="flex items-center gap-2"><Radio size={13} aria-hidden="true" className={fresh ? 'text-mint' : 'text-amber-300'} />{errors.metrics ? 'TELEMETRY UNAVAILABLE' : updated ? `UPDATED ${time(updated)}` : 'CONNECTING'}</span>
        <span>{traffic ? `${number(traffic.total_orders_sent)} synthetic POST attempts · ${number(traffic.accepted_orders)} accepted` : 'Traffic counters unavailable'}</span>
      </div>
    </div>
  </section>;
}
