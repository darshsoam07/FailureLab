import { useEffect, useRef, useState } from 'react';
import App from '../../App.jsx';
import { authClient } from '../../api/auth.js';
import { startVisiblePolling } from '../../lib/visiblePolling.js';
import { AuthPortal } from './AuthPortal.jsx';

/** initialUser is an explicit component-test seam; the production entry never sets it. */
export function AuthenticatedApp({ client = authClient, dashboardClient, initialUser }) {
  const [user, setUser] = useState(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const mutation = useRef(null);
  const generation = useRef(0);
  useEffect(() => {
    if (initialUser !== undefined) return;
    const poller = startVisiblePolling(async signal => {
      const version = generation.current;
      try {
        const data = await client.me(signal);
        if (!signal.aborted && version === generation.current) { setUser(data.user); setError(''); }
      } catch (failure) {
        if (!signal.aborted && version === generation.current) {
          if (failure.status === 401) { setUser(null); setError(''); }
          else setError('Unable to check your session. Verify the controller connection and try again.');
        }
      } finally { if (!signal.aborted) setLoading(false); }
    }, 60000);
    return () => poller.stop();
  }, [client, initialUser, revision]);
  useEffect(() => () => mutation.current?.abort(), []);
  function signedIn(value) { generation.current += 1; setUser(value); setError(''); setRevision(value => value + 1); }
  async function logout() {
    if (mutation.current) return;
    const controller = new AbortController(); mutation.current = controller; setBusy(true); setError('');
    generation.current += 1;
    try {
      await client.logout(controller.signal);
      if (!controller.signal.aborted) { setUser(null); setRevision(value => value + 1); }
    } catch (failure) { if (!controller.signal.aborted) setError('Sign out could not be confirmed. Please try again.'); }
    finally { mutation.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  if (loading) return <main className="auth-session"><h1>FailureLab</h1><p role="status">Checking your session…</p></main>;
  return <>
    {error && <div role="alert" className="bg-surface border-b border-destructive p-3 text-sm text-destructive flex flex-wrap items-center justify-center gap-3">{error}<button className="underline p-2" onClick={() => setRevision(value => value + 1)}>Retry session check</button></div>}
    {user ? <App client={dashboardClient} user={user} onLogout={logout} logoutBusy={busy} /> : <AuthPortal client={client} onAuthenticated={signedIn} />}
  </>;
}
