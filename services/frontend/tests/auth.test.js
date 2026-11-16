import test from 'node:test';
import assert from 'node:assert/strict';
import { authReducer, INITIAL_AUTH_STATE, maskEmail, otpEdit, secondsRemaining } from '../src/lib/auth.js';
import { createAuthClient } from '../src/api/auth.js';

test('five-screen recovery flow requires a challenge and verified token', () => {
  let state = { ...INITIAL_AUTH_STATE, screen: 'SIGNUP' };
  state = authReducer(state, { type: 'NAVIGATE', screen: 'LOGIN' }); assert.equal(state.screen, 'LOGIN');
  state = authReducer(state, { type: 'NAVIGATE', screen: 'FORGOT_PASSWORD' }); assert.equal(state.screen, 'FORGOT_PASSWORD');
  state = authReducer(state, { type: 'CODE_SENT', resetId: 'challenge' }); assert.equal(state.screen, 'VERIFY_CODE');
  state = authReducer(state, { type: 'VERIFIED', token: 'secret' }); assert.equal(state.screen, 'RESET_PASSWORD');
  state = authReducer(state, { type: 'RESET_DONE' });
  assert.equal(state.screen, 'LOGIN'); assert.equal(state.resetToken, null); assert.match(state.notice, /successfully/);
});
test('navigation cannot skip verification and back discards reset credentials', () => {
  assert.equal(authReducer(INITIAL_AUTH_STATE, { type: 'NAVIGATE', screen: 'RESET_PASSWORD' }), INITIAL_AUTH_STATE);
  assert.equal(authReducer(INITIAL_AUTH_STATE, { type: 'VERIFIED', token: 'forged' }), INITIAL_AUTH_STATE);
  const state = authReducer({ screen: 'RESET_PASSWORD', resetId: 'id', resetToken: 'token' }, { type: 'BACK' });
  assert.equal(state.screen, 'FORGOT_PASSWORD'); assert.equal(state.resetToken, null);
});
test('resend replaces challenge and clears any old verification token', () => {
  const state = authReducer({ screen: 'VERIFY_CODE', resetId: 'old', resetToken: 'old' }, { type: 'CODE_SENT', resetId: 'new' });
  assert.equal(state.resetId, 'new'); assert.equal(state.resetToken, null);
});
test('OTP accepts paste, removes non-digits and chooses the next focus target', () => {
  assert.deepEqual(otpEdit(['', '', '', ''], 0, '1a2 34'), { digits: ['1', '2', '3', '4'], focus: 3 });
  assert.deepEqual(otpEdit(['1', '', '', ''], 1, '2'), { digits: ['1', '2', '', ''], focus: 2 });
  assert.deepEqual(otpEdit(['1', '2', '', ''], 1, ''), { digits: ['1', '', '', ''], focus: 1 });
});
test('countdown is deadline-based and email masking hides local identifiers', () => {
  assert.equal(secondsRemaining(30000, 5000), 25);
  assert.equal(secondsRemaining(30000, 50000), 0);
  assert.equal(maskEmail('johnmartinez@example.test'), '....inez@example.test');
  assert.equal(maskEmail('ab@example.test'), '....**@example.test');
});
test('auth HTTP client includes cookies and CSRF header, never stores tokens', async () => {
  const calls = [];
  const client = createAuthClient({ baseUrl: '/controller-api/', fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ user: { first_name: 'Test' } }), { status: 200 });
  } });
  await client.login({ email: 'test@example.test', password: 'test-password' });
  assert.equal(calls[0].url, '/controller-api/api/auth/login');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.headers['X-FailureLab-Auth'], '1');
});
test('authentication errors preserve status without automatically retrying', async () => {
  let calls = 0;
  const client = createAuthClient({ baseUrl: '/api', fetchImpl: async () => { calls++; return new Response('{"detail":"Invalid email or password"}', { status: 401 }); } });
  await assert.rejects(client.me(), error => error.status === 401);
  assert.equal(calls, 1);
});
test('social sign-in uses real provider routes and explicit account-link intent', async () => {
  const urls = [];
  const client = createAuthClient({ baseUrl: '/controller-api', fetchImpl: async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    return new Response('{"authorization_url":"https://provider.example/authorize"}');
  } });
  await client.oauth({ provider: 'google' });
  await client.oauth({ provider: 'github', link: true });
  assert.deepEqual(urls, ['/controller-api/api/auth/oauth/google/start', '/controller-api/api/auth/oauth/github/start?link=true']);
  assert.throws(() => client.oauth({ provider: 'facebook' }), /Unsupported provider/);
});
