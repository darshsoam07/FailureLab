import { useState } from 'react';
import { OctagonX, Play, SlidersHorizontal } from 'lucide-react';
import { buildExperiment, DEFAULT_PARAMETERS, FAULT_LABELS } from '../api/experiments';

const inputClass = 'mt-2 w-full rounded-lg border border-edge bg-ink px-3 py-2.5 text-sm text-slate-100 disabled:opacity-50';

export default function ExperimentLauncher({ catalog, activeExperiment, blocked, busy, onLaunch, onStop }) {
  const [kind, setKind] = useState('LATENCY');
  const [name, setName] = useState('Inventory latency experiment');
  const [parameters, setParameters] = useState({ ...DEFAULT_PARAMETERS.LATENCY });
  const [duration, setDuration] = useState(60);
  const [errorPercent, setErrorPercent] = useState(10);
  const [p95, setP95] = useState(500);
  const [error, setError] = useState('');
  const available = catalog?.experiments?.filter(item => FAULT_LABELS[item.fault_type]) ?? [];
  const schema = available.find(item => item.fault_type === kind)?.parameters_schema;
  async function submit(event) {
    event.preventDefault(); setError('');
    try {
      await onLaunch(buildExperiment(catalog, { name, fault_type: kind, parameters,
        duration_seconds: Number(duration), slo_max_error_rate: Number(errorPercent) / 100, slo_max_p95_ms: Number(p95) }));
    } catch (error) { setError(error.message); }
  }
  async function stop() {
    setError('');
    try { await onStop(activeExperiment.id); } catch (error) { setError(error.message); }
  }
  return <section aria-labelledby="launcher-title" className="rounded-2xl border border-edge bg-panel p-5 sm:p-7">
    <div className="mb-5 flex items-center justify-between"><h2 id="launcher-title" className="eyebrow">03 / Experiment launcher</h2><SlidersHorizontal size={18} className="text-mint" aria-hidden="true" /></div>
    {activeExperiment && <div className="mb-6 rounded-xl border border-red-400/40 bg-red-400/5 p-4">
      <p className="mb-3 text-sm text-slate-200">{activeExperiment.name} · {activeExperiment.status}</p>
      <button type="button" onClick={stop} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"><OctagonX size={22} aria-hidden="true" />{busy ? 'APPLYING CHANGE…' : 'EMERGENCY ABORT / KILL SWITCH'}</button>
      <p className="mt-3 text-xs leading-5 text-slate-400">Removes injected faults immediately. Background traffic stays on. If cleanup cannot be confirmed, retry the kill switch.</p>
    </div>}
    <form onSubmit={submit}>
      <fieldset disabled={blocked || busy || Boolean(activeExperiment)} className="space-y-4 disabled:opacity-60">
        <label className="block text-xs text-slate-400">Experiment name<input required maxLength={255} value={name} onChange={e => setName(e.target.value)} className={inputClass} /></label>
        <label className="block text-xs text-slate-400">Allowlisted fault<select value={kind} onChange={e => { setKind(e.target.value); setParameters({ ...DEFAULT_PARAMETERS[e.target.value] }); }} className={inputClass}>
          {!catalog && <option value="LATENCY">Loading catalog…</option>}
          {available.map(item => <option key={item.fault_type} value={item.fault_type}>{FAULT_LABELS[item.fault_type]}</option>)}
        </select></label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Object.entries(schema?.properties ?? {}).map(([key, rule]) => <label key={key} className="block text-xs text-slate-400">{key.replaceAll('_', ' ')}
            {rule.enum ? <select value={parameters[key] ?? rule.default} onChange={e => setParameters(p => ({ ...p, [key]: e.target.value }))} className={inputClass}>{rule.enum.map(value => <option key={value} value={value}>{value === 'reset_peer' ? 'Connection reset' : 'HTTP 503 storm'}</option>)}</select>
              : <input type="number" required min={rule.minimum ?? (rule.exclusiveMinimum !== undefined ? rule.exclusiveMinimum + 0.01 : undefined)} max={rule.maximum} step={rule.type === 'integer' ? 1 : 'any'} value={parameters[key] ?? ''} onChange={e => setParameters(p => ({ ...p, [key]: e.target.value === '' ? '' : Number(e.target.value) }))} className={inputClass} />}
          </label>)}
          <label className="block text-xs text-slate-400">Duration (seconds)<input type="number" required min={catalog?.duration_seconds.minimum ?? 1} max={catalog?.duration_seconds.maximum ?? 3600} step="1" value={duration} onChange={e => setDuration(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs text-slate-400">SLO maximum error rate (%)<input type="number" required min="0" max="100" step="any" value={errorPercent} onChange={e => setErrorPercent(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs text-slate-400">SLO maximum P95 (ms)<input type="number" required min="0.001" step="any" value={p95} onChange={e => setP95(e.target.value)} className={inputClass} /></label>
        </div>
        {kind === 'TIMEOUT' && <p className="text-xs leading-5 text-slate-400">A 0ms timeout drops traffic until the toxic is removed.</p>}
        {kind === 'ERROR_RATE' && <p className="text-xs leading-5 text-slate-400">Reset percentage applies to TCP connections; HTTP 503 percentage applies to inventory requests.</p>}
        <button type="submit" disabled={!schema} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-mint px-4 py-3 text-sm font-semibold text-ink hover:bg-emerald-200 disabled:opacity-50"><Play size={16} aria-hidden="true" />Launch experiment</button>
      </fieldset>
    </form>
    {blocked && <p className="mt-3 text-xs text-amber-300">Waiting for a current catalog and control-plane state before launching.</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
  </section>;
}
