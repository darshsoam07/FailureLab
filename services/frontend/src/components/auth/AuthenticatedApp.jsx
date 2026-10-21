import { useEffect, useRef, useState } from 'react';
import App from '../../App.jsx';
import { authClient } from '../../api/auth.js';
import { startVisiblePolling } from '../../lib/visiblePolling.js';
import { AuthPortal } from './AuthPortal.jsx';

/** initialUser is an explicit component-test seam; the production entry never sets it. */
export function AuthenticatedApp({ client = authClient, dashboardClient, initialUser }) {
  const [user, setUser] = useState(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);
  const [notice, setNotice] = useState(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    const reason = url.searchParams.get('auth_error');
    if (!reason) return '';
    return ({ cancelled: 'Sign-in was cancelled. You can try again.', account_conflict: 'This email or provider belongs to an existing account. Sign in using that account, then link the provider below.' })[reason] || 'Social sign-in failed or expired. Please try again.';
  });
  const [error, setError] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('auth_error')) {
      url.searchParams.delete('auth_error'); window.history.replaceState({}, '', url);
    }
  }, []);
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
          if (failure.status === 401) { setUser(null); }
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
  async function linkProvider(provider) {
    if (mutation.current) return;
    const controller = new AbortController(); mutation.current = controller; setBusy(true);
    try {
      const data = await client.oauth({ provider, link: true }, controller.signal);
      if (!controller.signal.aborted) window.location.assign(data.authorization_url);
    } catch { setError('Could not start account linking. Check provider configuration and try again.'); }
    finally { mutation.current = null; setBusy(false); }
  }
  if (loading) return <main className="auth-session"><h1>FailureLab</h1><p role="status">Checking your session…</p></main>;
  return <>
    {notice && <div role="alert" className="bg-surface border-b border-border p-3 text-sm flex flex-wrap justify-center gap-3">{notice}<button className="underline p-2" onClick={() => setNotice('')}>Dismiss</button></div>}
    {error && <div role="alert" className="bg-surface border-b border-destructive p-3 text-sm text-destructive flex flex-wrap items-center justify-center gap-3">{error}<button className="underline p-2" onClick={() => setRevision(value => value + 1)}>Retry session check</button></div>}
    {user && <aside className="bg-surface p-3 md:ml-16 lg:ml-64 flex flex-wrap gap-3 items-center text-sm" aria-label="Account connections"><span>Account access: {user.role || 'viewer'}</span>{['google', 'github'].map(provider => <button className="rounded-full border border-border px-4 py-2" key={provider} disabled={busy} onClick={() => linkProvider(provider)}>Link {provider === 'google' ? 'Google' : 'GitHub'}</button>)}</aside>}
    {user ? <App client={dashboardClient} user={user} onLogout={logout} logoutBusy={busy} /> : <AuthPortal client={client} onAuthenticated={signedIn} />}
  </>;
}
