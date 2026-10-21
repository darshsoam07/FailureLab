import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { authClient } from '../../api/auth.js';
import { authReducer, AUTH_SCREENS, INITIAL_AUTH_STATE, maskEmail, otpEdit, secondsRemaining } from '../../lib/auth.js';
import { AuthArtwork } from './AuthArtwork.jsx';
import { startVisiblePolling } from '../../lib/visiblePolling.js';
import { normalizeProviderReadiness } from '../../lib/providerReadiness.js';
import './auth.css';

const TITLES = { SIGNUP: 'Create an Account', LOGIN: 'Log in', FORGOT_PASSWORD: 'Forgot Password', VERIFY_CODE: 'Verification Code', RESET_PASSWORD: 'Reset Password' };

function Field({ label, name, value, onChange, password = false, autoComplete, ...props }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-field"><span>{label}</span><div className="auth-input-wrap">
    <input {...props} name={name} value={value} onChange={onChange} required autoComplete={autoComplete}
      type={password ? visible ? 'text' : 'password' : props.type || 'text'} className={password ? 'auth-input auth-password' : 'auth-input'} />
    {password && <button type="button" className="auth-eye" onClick={() => setVisible(!visible)} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>
      {visible ? <Eye size={16} /> : <EyeOff size={16} />}
    </button>}
  </div></label>;
}

function ProviderIcon({ provider }) {
  return provider === 'google' ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
    <path fill="var(--auth-google-blue)" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"/>
    <path fill="var(--auth-google-green)" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10 10 0 0 0 12 22Z"/>
    <path fill="var(--auth-google-yellow)" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.5H3a10 10 0 0 0 0 9l3.4-2.7Z"/>
    <path fill="var(--auth-google-red)" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.7C7.2 7.8 9.4 6 12 6Z"/>
  </svg> : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.03-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.57 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.33-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.11c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"/></svg>;
}

export function AuthPortal({ client = authClient, onAuthenticated, initialScreen = 'LOGIN' }) {
  const [state, dispatch] = useReducer(authReducer, { ...INITIAL_AUTH_STATE, screen: ['LOGIN', 'SIGNUP', 'FORGOT_PASSWORD'].includes(initialScreen) ? initialScreen : 'LOGIN' });
  const [fields, setFields] = useState({ first_name: '', last_name: '', email: '', password: '', confirm: '' });
  const [terms, setTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [digits, setDigits] = useState(['', '', '', '']);
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState({});
  const [providerMessage, setProviderMessage] = useState('Checking social sign-in availability…');
  const providerPoller = useRef(null);
  const active = useRef(null);
  const otpRefs = useRef([]);
  const heading = useRef(null);
  const firstRender = useRef(true);
  const screen = state.screen;
  const credentials = screen === 'SIGNUP' || screen === 'LOGIN';
  useEffect(() => {
    const polling = startVisiblePolling(async signal => {
      const data = await client.config(signal);
      if (signal.aborted) return;
      const status = normalizeProviderReadiness(data, window.location.origin);
      setProviders(status.providers); setProviderMessage(status.message);
    }, 15000, { onError: failure => {
      setProviders({});
      setProviderMessage(failure.status ? 'Cannot check social sign-in. Check the controller connection and retry.' : failure.message);
    } });
    providerPoller.current = polling;
    return () => { polling.stop(); providerPoller.current = null; active.current?.abort(); };
  }, [client]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [screen]);
  useEffect(() => {
    if (screen !== 'VERIFY_CODE') return;
    const update = () => setRemaining(secondsRemaining(deadline));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [screen, deadline]);

  function navigate(event) {
    if (active.current) return;
    setError(''); setDevCode(''); setDigits(['', '', '', '']);
    setFields(previous => ({ ...previous, password: '', confirm: '' }));
    dispatch(event);
  }
  const change = event => setFields(previous => ({ ...previous, [event.target.name]: event.target.value }));
  async function perform(action) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try { await action(controller.signal); }
    catch (failure) { if (!controller.signal.aborted) setError(failure.message || 'Unable to connect. Please try again.'); }
    finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }
  async function sendCode(signal) {
    const data = await client.forgot({ email: fields.email }, signal);
    if (signal.aborted) return;
    setDigits(['', '', '', '']);
    setDevCode(data.dev_code || '');
    setDeadline(Date.now() + Math.max(30, data.retry_after_seconds || 30) * 1000);
    dispatch({ type: 'CODE_SENT', resetId: data.reset_id });
  }
  function submit(event) {
    event.preventDefault();
    if (credentials && !terms) { setError('Please agree to the Terms & Condition.'); return; }
    if (screen === 'RESET_PASSWORD' && fields.password !== fields.confirm) { setError('Passwords must match.'); return; }
    perform(async signal => {
      if (screen === 'SIGNUP' || screen === 'LOGIN') {
        const body = { email: fields.email, password: fields.password };
        const data = screen === 'SIGNUP' ? await client.signup({ ...body, first_name: fields.first_name, last_name: fields.last_name, terms_accepted: terms }, signal) : await client.login(body, signal);
        if (!signal.aborted) onAuthenticated(data.user);
      } else if (screen === 'FORGOT_PASSWORD') await sendCode(signal);
      else if (screen === 'VERIFY_CODE') {
        const data = await client.verify({ reset_id: state.resetId, code: digits.join('') }, signal);
        if (!signal.aborted) { dispatch({ type: 'VERIFIED', token: data.reset_token }); setDevCode(''); setFields(prev => ({ ...prev, password: '', confirm: '' })); }
      } else {
        await client.reset({ reset_id: state.resetId, reset_token: state.resetToken, password: fields.password }, signal);
        if (!signal.aborted) { dispatch({ type: 'RESET_DONE' }); setFields(prev => ({ ...prev, password: '', confirm: '' })); }
      }
    });
  }
  function editOtp(index, value) {
    const next = otpEdit(digits, index, value);
    setDigits(next.digits); otpRefs.current[next.focus]?.focus();
  }
  return <main className={`auth-portal auth-${screen.toLowerCase()}`}>
    <div className="auth-ambient" aria-hidden="true">{AUTH_SCREENS.map(name => <div key={name} className={`auth-backdrop auth-backdrop-${name.toLowerCase()} ${screen === name ? 'is-active' : ''}`} />)}</div>
    <div className="auth-card">
      <AuthArtwork screen={screen} />
      <section className="auth-form-panel" aria-labelledby="auth-title">
        <button className="auth-back" type="button" aria-label="Back to previous authentication screen" disabled={busy} onClick={() => navigate({ type: 'BACK' })}><ArrowLeft size={20} /></button>
        <h1 id="auth-title" ref={heading} tabIndex={-1}>{TITLES[screen]}</h1>
        <div className="auth-subtitle">
          {screen === 'SIGNUP' && <>Already have an account? <button type="button" disabled={busy} onClick={() => navigate({ type: 'NAVIGATE', screen: 'LOGIN' })}>Log in</button></>}
          {screen === 'LOGIN' && <>Don't have an account? <button type="button" disabled={busy} onClick={() => navigate({ type: 'NAVIGATE', screen: 'SIGNUP' })}>Create an Account</button></>}
          {screen === 'FORGOT_PASSWORD' && <>We'll send a verification code to your email address</>}
          {screen === 'VERIFY_CODE' && <>We sent you verification code on <strong>{maskEmail(fields.email)}</strong></>}
          {screen === 'RESET_PASSWORD' && <>Your new password must be different from your previous passwords.</>}
        </div>
        {state.notice && <p className="auth-success" role="status">{state.notice}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {devCode && <p className="auth-demo" role="status">Local demo verification code: <strong>{devCode}</strong>. No email was sent.</p>}
        <form onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy} className="auth-fields">
            {screen === 'SIGNUP' && <div className="auth-name-row">
              <Field label="First Name" name="first_name" value={fields.first_name} onChange={change} placeholder="John" autoComplete="given-name" maxLength={100} />
              <Field label="Last Name" name="last_name" value={fields.last_name} onChange={change} placeholder="Last Name" autoComplete="family-name" maxLength={100} />
            </div>}
            {['SIGNUP', 'LOGIN', 'FORGOT_PASSWORD'].includes(screen) && <Field label="Email Address" name="email" type="email" value={fields.email} onChange={change} placeholder="Email Address" autoComplete="email" maxLength={254} />}
            {credentials && <Field label="Password" name="password" password value={fields.password} onChange={change} placeholder="Password" minLength={screen === 'SIGNUP' ? 12 : 1} maxLength={128} autoComplete={screen === 'SIGNUP' ? 'new-password' : 'current-password'} />}
            {screen === 'SIGNUP' && <p className="auth-hint">Use at least 12 characters.</p>}
            {screen === 'LOGIN' && <button className="auth-forgot" type="button" onClick={() => navigate({ type: 'NAVIGATE', screen: 'FORGOT_PASSWORD' })}>Forgot Password?</button>}
            {screen === 'VERIFY_CODE' && <div>
              <div className="auth-otp" role="group" aria-label="Four-digit verification code">
                {digits.map((digit, index) => <input key={index} ref={el => { otpRefs.current[index] = el; }} aria-label={`Digit ${index + 1}`} value={digit} inputMode="numeric" pattern="[0-9]" required autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  onChange={event => editOtp(index, event.target.value)}
                  onPaste={event => { event.preventDefault(); editOtp(index, event.clipboardData.getData('text')); }}
                  onKeyDown={event => { if (event.key === 'Backspace' && !digit && index > 0) { event.preventDefault(); const next = [...digits]; next[index - 1] = ''; setDigits(next); otpRefs.current[index - 1]?.focus(); } }} />)}
              </div>
              <div className="auth-resend">{remaining > 0 ? <>Resend Code in: <strong>00:{String(remaining).padStart(2, '0')}</strong></> : <button type="button" onClick={() => perform(sendCode)}>Resend Code</button>}</div>
            </div>}
            {screen === 'RESET_PASSWORD' && <>
              <Field label="New Password" name="password" password value={fields.password} onChange={change} placeholder="New Password" minLength={12} maxLength={128} autoComplete="new-password" />
              <Field label="Confirm Password" name="confirm" password value={fields.confirm} onChange={change} placeholder="Confirm Password" minLength={12} maxLength={128} autoComplete="new-password" />
            </>}
            <button className="auth-primary" type="submit">{busy ? 'Please wait…' : { SIGNUP: 'Create Account', LOGIN: 'Log in', FORGOT_PASSWORD: 'Send Verification Code', VERIFY_CODE: 'Verify Code', RESET_PASSWORD: 'Reset Password' }[screen]}</button>
            {credentials && <div className="auth-terms-row">
              <label><input type="checkbox" checked={terms} onChange={event => setTerms(event.target.checked)} required /> <span>I agree to the </span></label>
              <button type="button" className="auth-link" onClick={() => setShowTerms(!showTerms)} aria-expanded={showTerms}>Terms &amp; Condition</button>
            </div>}
          </fieldset>
        </form>
        {showTerms && <aside className="auth-terms" aria-label="Terms and conditions"><strong>FailureLab usage terms</strong><p>Use only systems you own or are authorized to test. Faults can disrupt services. This application is an experimentation tool; you are responsible for the targets and safety limits you choose.</p><button type="button" className="auth-link" onClick={() => setShowTerms(false)}>Close terms</button></aside>}
        {credentials && <>
          <div className="auth-divider"><span>or</span></div>
          <div className="auth-providers">{['google', 'github'].map(provider => <button key={provider} type="button" disabled={busy || !providers[provider]} title={providers[provider] ? `Sign in securely with ${provider}` : 'Provider is not configured by the operator'}
            onClick={() => { if (!terms) { setError('Please agree to the Terms & Condition.'); return; } perform(async signal => { const data = await client.oauth({ provider }, signal); if (!signal.aborted) { window.location.assign(data.authorization_url); await new Promise(() => {}); } }); }}>
            <ProviderIcon provider={provider} /><span>Continue with {provider === 'google' ? 'Google' : 'GitHub'}</span>
          </button>)}</div>
          <p className="auth-provider-note" role="status">{providerMessage} Email/password remains available.</p>
          <button type="button" className="auth-link" disabled={busy} onClick={() => providerPoller.current?.refresh()}>Refresh sign-in availability</button>
        </>}
      </section>
    </div>
  </main>;
}
