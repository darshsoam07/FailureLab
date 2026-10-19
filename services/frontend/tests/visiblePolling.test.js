import test from 'node:test';
import assert from 'node:assert/strict';
import { startVisiblePolling } from '../src/lib/visiblePolling.js';

function harness(state = 'visible') {
  const listeners = new Set(), timers = new Map(); let id = 0;
  const visibility = { visibilityState: state, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  return { visibility, timers, listeners, schedule: fn => { timers.set(++id, fn); return id; }, cancel: id => timers.delete(id), now: () => 0,
    change(state) { visibility.visibilityState = state; for (const fn of listeners) fn(); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('polls immediately, serially and cleans up its timer and listener', async () => {
  const h = harness(); let calls = 0;
  const p = startVisiblePolling(async () => { calls++; }, 100, h);
  await flush(); assert.equal(calls, 1); assert.equal(h.timers.size, 1);
  p.stop(); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
});
test('hidden initial tab makes no request and refreshes immediately on return', async () => {
  const h = harness('hidden'); let calls = 0;
  const p = startVisiblePolling(async () => { calls++; }, 100, h);
  assert.equal(calls, 0); h.change('visible'); await flush(); assert.equal(calls, 1); p.stop();
});
test('hiding cancels the timer and aborts an in-flight poll', async () => {
  const h = harness(); let signal, finish;
  const p = startVisiblePolling(s => { signal = s; return new Promise(r => { finish = r; }); }, 100, h);
  h.change('hidden'); assert.equal(signal.aborted, true); finish(); await flush(); assert.equal(h.timers.size, 0); p.stop();
});
test('rapid visibility changes do not overlap slow requests', async () => {
  const h = harness(); let calls = 0, finish;
  const p = startVisiblePolling(() => { calls++; return new Promise(r => { finish = r; }); }, 100, h);
  h.change('hidden'); h.change('visible'); h.change('visible'); assert.equal(calls, 1);
  finish(); await flush(); assert.equal(calls, 2); p.stop(); finish();
});
test('stopped poll cannot reschedule when a late response arrives', async () => {
  const h = harness(); let finish;
  const p = startVisiblePolling(() => new Promise(r => { finish = r; }), 100, h);
  p.stop(); finish(); await flush(); assert.equal(h.timers.size, 0);
});
test('one-shot completion still refreshes when the tab returns', async () => {
  const h = harness(); let calls = 0;
  const p = startVisiblePolling(async () => { calls++; return false; }, 100, h);
  await flush(); assert.equal(h.timers.size, 0); h.change('hidden'); h.change('visible'); await flush(); assert.equal(calls, 2); p.stop();
});
test('failed polling reports the error and schedules recovery', async () => {
  const h = harness(); let error;
  const p = startVisiblePolling(async () => { throw new Error('offline'); }, 100, { ...h, onError: e => { error = e; } });
  await flush(); assert.equal(error.message, 'offline'); assert.equal(h.timers.size, 1); p.stop();
});
