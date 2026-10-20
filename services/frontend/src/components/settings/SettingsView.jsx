import { catalogBounds, safeProxyPrefix } from '../../lib/settings.js';
import { Card } from '../common/Card.jsx';

function ProbeTable({ name, data, error, lastSuccessAt }) {
  const checks = Object.entries(data?.checks ?? {}).filter(([, value]) => typeof value === 'boolean');
  return <Card>
    <h3>{name} probes</h3>
    <p className="text-sm text-muted-foreground">Last probe (client successful poll): {lastSuccessAt ? new Date(lastSuccessAt).toLocaleString() : 'never'}</p>
    {error ? <p role="alert">Probe unavailable. Last successful response may be stale.</p> : !data ? <p role="status">Loading readiness…</p> : <p>Status: {data.status}</p>}
    {checks.length ? <table className="w-full text-sm mt-3"><caption className="sr-only">{name} readiness checks</caption><thead><tr><th scope="col" className="text-left">Check</th><th scope="col">Result</th></tr></thead><tbody>{checks.map(([key, value]) => <tr key={key}><th scope="row" className="text-left font-normal py-2">{key}</th><td className="text-center">{value ? 'PASS' : 'FAIL'}</td></tr>)}</tbody></table> : <p className="text-sm text-muted-foreground">No probe checks available.</p>}
  </Card>;
}

export function SettingsView({ controllerReadiness, orderReadiness, catalog, controllerError, orderError, catalogError, controllerLastSuccessAt, orderLastSuccessAt, apiPrefixes }) {
  const bounds = catalogBounds(catalog);
  return <section className="space-y-6" aria-labelledby="settings-title">
    <h2 id="settings-title" className="text-xl font-semibold">Read-only system settings</h2>
    <p className="text-muted-foreground">Values come from the catalog and readiness responses. This page does not change server configuration.</p>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><h3>Server-controlled auto-abort rule</h3><p className="mt-3">3 consecutive snapshots with error rate or P95 strictly above the experiment ceiling trigger abort and fault cleanup.</p><p className="text-sm text-muted-foreground mt-3">This is the server's fixed policy, not a client setting. Global SLO configuration is not exposed.</p><p className="mt-3">Toxiproxy mode: <strong>{controllerReadiness?.toxiproxy_mode ?? 'unknown'}</strong></p></Card>
      <Card><h3>Configured API proxy prefixes</h3><dl className="mt-3 space-y-3 text-sm"><dt>Order API</dt><dd><code>{safeProxyPrefix(apiPrefixes?.order)}</code></dd><dt>Controller</dt><dd><code>{safeProxyPrefix(apiPrefixes?.controller)}</code></dd></dl><p className="text-sm text-muted-foreground mt-3">Only relative prefixes are displayed. Upstream URLs and credentials are omitted.</p></Card>
      <ProbeTable name="Controller" data={controllerReadiness} error={controllerError} lastSuccessAt={controllerLastSuccessAt} />
      <ProbeTable name="Order API" data={orderReadiness} error={orderError} lastSuccessAt={orderLastSuccessAt} />
    </div>
    <Card><h3>Allowlisted catalog limits</h3>
      {catalogError && <p role="alert">Catalog unavailable. Retained limits may be stale.</p>}
      {!catalog && !catalogError && <p role="status">Loading catalog…</p>}
      <p className="text-sm mt-3">Target: {catalog?.target_service ?? 'unknown'}. Duration: {catalog?.duration_seconds ? `${catalog.duration_seconds.minimum}–${catalog.duration_seconds.maximum} seconds` : 'unknown'}.</p>
      {bounds.length ? <ul className="grid gap-3 sm:grid-cols-2 mt-4">{bounds.map(row => <li key={`${row.fault}-${row.name}`} className="rounded border border-border p-3 text-sm"><strong>{row.fault} / {row.name}</strong><p>{row.limits}</p></li>)}</ul> : <p className="text-muted-foreground mt-3">No catalog limits available.</p>}
    </Card>
  </section>;
}
