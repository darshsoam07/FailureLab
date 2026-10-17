import { ArrowRight, Boxes, Cpu, Database, Network, Zap } from 'lucide-react';

function faultLabel(experiment) {
  const p = experiment?.parameters ?? {};
  switch (experiment?.fault_type) {
    case 'LATENCY': return `+${p.latency_ms ?? 0}ms latency · ±${p.jitter_ms ?? 0}ms jitter`;
    case 'TIMEOUT': return `${p.timeout_ms ?? 0}ms timeout${p.timeout_ms === 0 ? ' · indefinite' : ''}`;
    case 'ERROR_RATE': return p.mode === 'reset_peer' ? 'Connection reset' : `${p.error_rate_percent}% HTTP 503`;
    case 'BANDWIDTH': return `${p.rate_kbps} KB/s bandwidth cap`;
    default: return 'Fault injection active';
  }
}

export default function TopologyBanner({ experiment = null, stale = false }) {
  const running = experiment?.status === 'RUNNING' && !stale;
  const nodes = [
    { name: 'Order API', detail: 'Accept & persist', Icon: Boxes },
    { name: 'RabbitMQ', detail: 'Durable delivery', Icon: Network },
    { name: 'Fulfillment Worker', detail: 'Retry & recover', Icon: Cpu },
    { name: 'Toxiproxy', detail: 'Fault point', Icon: Zap, fault: true },
    { name: 'Inventory Service', detail: 'Reserve stock', Icon: Database },
  ];
  return <section aria-label="Service topology" className="rounded-2xl border border-edge bg-panel p-5 sm:p-7">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 className="eyebrow">01 / System topology</h2>
      <span className={`text-xs ${stale ? 'text-amber-300' : running ? 'text-amber-300' : 'text-slate-400'}`}>
        {stale ? 'Experiment status unavailable' : running ? 'Experiment in progress' : 'No active experiment'}
      </span>
    </div>
    <div className="overflow-x-auto pb-2">
      <ol className="flex min-w-[780px] items-center gap-3">
        {nodes.map(({ name, detail, Icon, fault }, index) => <li key={name} className="flex min-w-0 flex-1 items-center gap-3">
          <div className={`relative flex min-h-32 flex-1 flex-col items-center justify-center rounded-xl border px-2 py-4 text-center ${fault && running ? 'border-amber-500/60 bg-amber-500/10' : 'border-edge bg-ink/40'}`}>
            {fault && running && <span aria-hidden="true" className="absolute right-3 top-3 h-2 w-2 rounded-full bg-red-400 motion-safe:animate-pulse" />}
            <Icon aria-hidden="true" size={23} className={`mb-3 ${fault ? running ? 'text-amber-300 motion-safe:animate-pulse' : 'text-amber-300/70' : 'text-mint'}`} />
            <span className="text-xs font-semibold text-slate-100">{name}</span>
            <span className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">{detail}</span>
          </div>
          {index < nodes.length - 1 && <ArrowRight aria-hidden="true" size={16} className="shrink-0 text-slate-600" />}
        </li>)}
      </ol>
    </div>
    {running && <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 font-mono text-xs text-amber-200">
      {experiment.name} / {faultLabel(experiment)}
      {experiment.fault_type === 'ERROR_RATE' && experiment.parameters?.mode !== 'reset_peer' && ' · injected at Inventory Service'}
    </p>}
  </section>;
}
