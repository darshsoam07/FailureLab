import { startVisiblePolling } from '../lib/visiblePolling.js';
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
    const polling = startVisiblePolling(async signal => {
      try {
        const result = await load(signal);
        if (!signal.aborted) { setData(result); setError(''); setLastSuccessAt(Date.now()); }
      } catch (error) { if (!signal.aborted) setError(error.message); }
    }, interval);
    activeRequest.current = { abort: () => polling.stop() };
    return () => polling.stop();
  }, [load, interval, revision, enabled]);
  return { data, setData, error, refresh, lastSuccessAt, loading: data === null && !error };
}
