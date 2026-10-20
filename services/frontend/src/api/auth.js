export function createAuthClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  async function request(path, body, signal) {
    if (!baseUrl) throw new Error('Controller API is not configured.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 15000);
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/auth/${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'include',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'X-FailureLab-Auth': '1', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail :
          Array.isArray(data?.detail) ? data.detail.map(item => item.msg).join('; ') : `Authentication unavailable (HTTP ${response.status}).`;
        const error = new Error(message); error.status = response.status; throw error;
      }
      if (!data) throw new Error('Authentication returned an invalid response.');
      return data;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('Request timed out. Check your account before retrying.');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    config: signal => request('config', undefined, signal),
    me: signal => request('me', undefined, signal),
    signup: (body, signal) => request('signup', body, signal),
    login: (body, signal) => request('login', body, signal),
    forgot: (body, signal) => request('forgot-password', body, signal),
    verify: (body, signal) => request('verify-code', body, signal),
    reset: (body, signal) => request('reset-password', body, signal),
    oauth: (body, signal) => request('oauth-mock', body, signal),
    logout: signal => request('logout', {}, signal),
  };
}

export const authClient = createAuthClient({ baseUrl: import.meta.env?.VITE_CONTROLLER_API_URL });
