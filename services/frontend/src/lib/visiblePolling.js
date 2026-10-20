// Serial polling: hidden tabs abort work and stop timers; return triggers an immediate refresh.
// Dependencies are injectable so visibility, cancellation and timing are testable without a DOM.
export function startVisiblePolling(run, interval = 2000, {
  visibility = document, schedule = setTimeout, cancel = clearTimeout, now = Date.now,
  onError = () => {},
} = {}) {
  let stopped = false, timer, controller, inFlight = false, refreshPending = false;
  const visible = () => visibility.visibilityState !== 'hidden';
  async function poll() {
    if (stopped || !visible()) return;
    if (inFlight) { refreshPending = true; return; }
    inFlight = true;
    controller = new AbortController();
    const current = controller;
    const started = now();
    let again = true;
    try { again = await run(current.signal); }
    catch (error) { if (!current.signal.aborted) onError(error); }
    finally {
      inFlight = false;
      if (!stopped && visible()) {
        if (refreshPending) { refreshPending = false; void poll(); }
        else if (!current.signal.aborted && again !== false) timer = schedule(poll, Math.max(0, interval - (now() - started)));
      }
    }
  }
  function refresh() {
    cancel(timer);
    controller?.abort();
    refreshPending = visible();
    if (!inFlight && visible()) { refreshPending = false; void poll(); }
  }
  visibility.addEventListener('visibilitychange', refresh);
  void poll();
  return { refresh, stop() { stopped = true; cancel(timer); controller?.abort(); visibility.removeEventListener('visibilitychange', refresh); } };
}
