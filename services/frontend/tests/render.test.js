import { fileURLToPath } from 'node:url';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
let components;
before(async () => {
  const entries = {
    ExperimentsHistoryTable: 'reports/ExperimentsHistoryTable', SettingsView: 'settings/SettingsView',
    DashboardView: 'dashboard/DashboardView', ExperimentsView: 'experiments/ExperimentsView',
    TopologyOverview: 'topology/TopologyOverview', AppErrorBoundary: 'common/AppErrorBoundary',
  };
  const entry = Object.entries(entries).map(([name, path]) => `export { ${name} } from ${JSON.stringify(fileURLToPath(new URL(`../src/components/${path}.jsx`, import.meta.url)))};`).join('\n');
  const result = await build({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, logLevel: 'silent',
    plugins: [{ name: 'render-test-entry', resolveId: id => id.endsWith('render-test-entry') ? '\0render-test-entry' : null, load: id => id === '\0render-test-entry' ? entry : null }, react()],
    build: { ssr: 'render-test-entry', write: false, rollupOptions: { output: { paths: id => import.meta.resolve(id) } } },
  });
  components = await import(`data:text/javascript;base64,${Buffer.from(result.output.find(item => item.type === 'chunk' && item.isEntry).code).toString('base64')}`);
});
async function html(path, name, props) { return render(React.createElement(components[name], props)); }
test('history empty and error states render without crashing', async () => {
  const markup = await html('reports/ExperimentsHistoryTable', 'ExperimentsHistoryTable', { experiments: [], loading: false, error: 'offline', onSelect: () => {} });
  assert.match(markup, /No Experiments Found/); assert.match(markup, /offline/);
});
test('Settings renders missing data as unknown, never, and unavailable', async () => {
  const markup = await html('settings/SettingsView', 'SettingsView', { controllerError: 'offline', orderError: 'offline', catalogError: 'offline' });
  assert.match(markup, /never/); assert.match(markup, /unknown/); assert.match(markup, /No catalog limits available/);
  assert.doesNotMatch(markup, /inventory_service|3600|ACTIVE/);
});
test('Settings exposes failed dependency probes without secrets', async () => {
  const markup = await html('settings/SettingsView', 'SettingsView', { controllerReadiness: { status: 'not_ready', checks: { database: false, rabbitmq: false } }, apiPrefixes: { order: 'https://user:secret@example.test/api' } });
  assert.match(markup, /FAIL/); assert.doesNotMatch(markup, /secret|example.test/);
});
test('dashboard handles null metrics and backend errors', async () => {
  const markup = await html('dashboard/DashboardView', 'DashboardView', { metrics: null, buffer: [], metricsError: 'offline', traffic: null, trafficError: 'offline', onNavigate: () => {} });
  assert.match(markup, /offline/); assert.match(markup, /UNKNOWN/);
});
test('experiments handles unavailable catalog and no experiment', async () => {
  const markup = await html('experiments/ExperimentsView', 'ExperimentsView', { catalog: null, activeExperiment: null, latestExperiment: null, blocked: true });
  assert.match(markup, /unknown/);
});
test('topology handles missing probes without healthy claims', async () => {
  const markup = await html('topology/TopologyOverview', 'TopologyOverview', { stale: true, onNavigate: () => {} });
  assert.match(markup, /unknown/i); assert.doesNotMatch(markup, /Real proxy connected/);
});
test('boundary fallback includes a heading and reload control', async () => {
  const { AppErrorBoundary } = components;
  const boundary = new AppErrorBoundary({}); boundary.state = { failed: true };
  const markup = render(boundary.render()); assert.match(markup, /<h1/); assert.match(markup, /Reload dashboard/);
});

