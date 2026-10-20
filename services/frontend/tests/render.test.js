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
    AuthPortal: 'auth/AuthPortal', AuthenticatedApp: 'auth/AuthenticatedApp',
  };
  const entry = Object.entries(entries).map(([name, path]) => `export { ${name} } from ${JSON.stringify(fileURLToPath(new URL(`../src/components/${path}.jsx`, import.meta.url)))};`).join('\n');
  const result = await build({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, logLevel: 'silent',
    plugins: [{ name: 'render-test-entry', resolveId: id => id.endsWith('render-test-entry') ? '\0render-test-entry' : null, load: id => id === '\0render-test-entry' ? entry : null }, react()],
    build: { ssr: 'render-test-entry', write: false, rollupOptions: { output: { inlineDynamicImports: true, paths: id => import.meta.resolve(id) } } },
  });
  components = await import(`data:text/javascript;base64,${Buffer.from(result.output.find(item => item.type === 'chunk' && item.isEntry).code).toString('base64')}`);
});
async function html(path, name, props) { return render(React.createElement(components[name], props)); }
test('auth screens render labelled fields and recovery navigation', async () => {
  for (const [screen, title] of [['LOGIN', 'Log in'], ['SIGNUP', 'Create an Account'], ['FORGOT_PASSWORD', 'Forgot Password']]) {
    const markup = await html('', 'AuthPortal', { initialScreen: screen });
    assert.match(markup, new RegExp(title));
    assert.match(markup, /Email Address/);
    assert.equal((markup.match(/<h1/g) || []).length, 1);
    assert.doesNotMatch(markup, /type="password"[^>]*value="[^"]+"/);
  }
});
test('production gate checks session and explicit signed-out seam shows login', async () => {
  assert.match(await html('', 'AuthenticatedApp', {}), /Checking your session/);
  const markup = await html('', 'AuthenticatedApp', { initialUser: null });
  assert.match(markup, /Log in/);
  assert.doesNotMatch(markup, /EMERGENCY ABORT/);
});
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
test('launcher default duration and SLO are valid native input steps', async () => {
  const markup = await html('experiments/ExperimentsView', 'ExperimentsView', {
    catalog: { duration_seconds: { minimum: 1, maximum: 3600 }, experiments: [] },
    activeExperiment: null, latestExperiment: null, blocked: false,
  });
  const duration = markup.match(/<input[^>]*id="duration-input"[^>]*>/)[0];
  const ceiling = markup.match(/<input[^>]*id="slo-p95"[^>]*>/)[0];
  assert.match(duration, /step="1"/);
  assert.match(duration, /value="60"/);
  assert.match(ceiling, /step="any"/);
  assert.match(ceiling, /value="500"/);
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

