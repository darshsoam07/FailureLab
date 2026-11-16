const allowedSettings = new Set(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'AUTH_PUBLIC_BASE_URL', 'AUTH_FRONTEND_URL']);

/** Never interpret omitted fields or truthy strings as a configured provider. */
export function normalizeProviderReadiness(data, origin) {
  if (!data?.providers || ['google', 'github'].some(name => typeof data.providers[name] !== 'boolean')) {
    throw new Error('The controller is running an older authentication API. Restart it to load OAuth support.');
  }
  if (origin && data.frontend_origin && origin !== data.frontend_origin) {
    throw new Error('This browser address does not match AUTH_FRONTEND_URL. Use the configured host and port consistently (localhost and 127.0.0.1 differ).');
  }
  const messages = ['google', 'github'].filter(name => !data.providers[name]).map(name => {
    const status = data.provider_status?.[name];
    const label = name === 'google' ? 'Google' : 'GitHub';
    const missing = (status?.missing || []).filter(key => allowedSettings.has(key));
    if (missing.length) return `${label}: configure ${missing.join(', ')} on the backend.`;
    if (status?.reason === 'invalid_urls') return `${label}: OAuth URLs are invalid or use different origins.`;
    if (status?.reason === 'secure_cookie_required') return `${label}: HTTPS requires AUTH_COOKIE_SECURE=true.`;
    return `${label}: provider is not configured by the operator.`;
  });
  return { providers: data.providers, message: messages.join(' ') ||
    'You will be redirected to your provider to sign in securely.' };
}
