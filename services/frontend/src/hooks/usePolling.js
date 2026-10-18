import { useCallback, useEffect, useRef, useState } from 'react';

// Preserve the last successful value, but always expose its freshness separately.
export function usePolling(load, interval = 2000, enabled = true) {
  const [data, setData] = useState(null);
  // Client timestamp of the last successfully received poll response, not server probe execution time.
  const [lastSuccessAt, setLastSuccessAt] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const activeRequest = useRef(null);
  const refresh = useCallback(() => {
    // Invalidate immediately, including responses arriving before React's cleanup.
    activeRequest.current?.abort();
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    let timer;
    async function poll() {
      const started = performance.now();
      try {
        const result = await load(controller.signal);
        if (!controller.signal.aborted) { setData(result); setError(''); setLastSuccessAt(Date.now()); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, Math.max(0, interval - (performance.now() - started)));
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load, interval, revision, enabled]);
  return { data, setData, error, refresh, lastSuccessAt, loading: data === null && !error };
}
