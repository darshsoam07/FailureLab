import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/api/client.js';

test('traffic and detail use existing backend contracts', async () => {
  const calls = [];
  const client = createApiClient({ orderApiUrl: '/orders', controllerApiUrl: '/controller/', fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ ai_report: { root_cause_summary: 'Evidence' } }));
  } });
  await client.toggleTraffic(true, 7);
  assert.equal(calls[0].url, '/controller/api/traffic/toggle');
  assert.deepEqual(JSON.parse(calls[0].body), { enabled: true, requests_per_second: 7 });
  assert.equal((await client.getAIReport('a/b')).root_cause_summary, 'Evidence');
  assert.equal(calls[1].url, '/controller/api/experiments/a%2Fb');
  await client.getMetricsSummary();
  assert.equal(calls[2].url, '/orders/api/orders/metrics-summary');
});

test('validation errors are readable and failed writes are not retried', async () => {
  let count = 0;
  const client = createApiClient({ controllerApiUrl: '/controller', fetchImpl: async () => {
    count++;
    return new Response(JSON.stringify({ detail: [{ loc: ['body', 'name'], msg: 'Required' }] }), { status: 422 });
  } });
  await assert.rejects(client.startExperiment({}), error => error instanceof ApiError && error.status === 422 && error.message.includes('body.name: Required'));
  assert.equal(count, 1);
});

test('missing configuration fails before sending a request', async () => {
  const client = createApiClient({ fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(client.getMetricsSummary(), /not configured/);
});

test('timeouts abort fetch and report uncertain write status', async () => {
  const client = createApiClient({ controllerApiUrl: '/controller', timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  await assert.rejects(client.toggleTraffic(true, 1), /Refresh status/);
});

test('caller cancellation propagates to fetch', async () => {
  const abort = new AbortController();
  const client = createApiClient({ orderApiUrl: '/orders', fetchImpl: async (_, { signal }) => {
    assert.equal(signal.aborted, true);
    throw signal.reason;
  } });
  abort.abort();
  await assert.rejects(client.getMetricsSummary({ signal: abort.signal }), { name: 'AbortError' });
});
