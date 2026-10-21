import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProviderReadiness } from '../src/lib/providerReadiness.js';

test('stale controller responses are not misreported as missing credentials', () => {
  assert.throws(() => normalizeProviderReadiness({ demo_mode: true }), /older authentication API/);
  assert.throws(() => normalizeProviderReadiness({ providers: { google: 'true', github: true } }), /older/);
});
test('configured providers enable independently and report missing variable names only', () => {
  const result = normalizeProviderReadiness({
    providers: { google: true, github: false },
    provider_status: { github: { missing: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'secret-value'] } },
  });
  assert.equal(result.providers.google, true);
  assert.equal(result.providers.github, false);
  assert.match(result.message, /GITHUB_CLIENT_SECRET/);
  assert.doesNotMatch(result.message, /secret-value/);
});
test('incorrect browser origin and secure-cookie setup fail closed', () => {
  assert.throws(() => normalizeProviderReadiness({
    providers: { google: true, github: true }, frontend_origin: 'http://127.0.0.1:5173',
  }, 'http://localhost:5173'), /does not match/);
  const result = normalizeProviderReadiness({
    providers: { google: false, github: false },
    provider_status: { google: { reason: 'secure_cookie_required' }, github: { reason: 'invalid_urls' } },
  });
  assert.match(result.message, /AUTH_COOKIE_SECURE=true/);
  assert.match(result.message, /different origins/);
});
test('a later successful readiness response replaces disabled state', () => {
  const missing = normalizeProviderReadiness({ providers: { google: false, github: false } });
  const configured = normalizeProviderReadiness({ providers: { google: true, github: true } });
  assert.equal(missing.providers.google, false);
  assert.equal(configured.providers.google, true);
  assert.match(configured.message, /redirected/);
});
