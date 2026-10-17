export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}

export function createApiClient({ orderApiUrl, controllerApiUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  async function request(base, path, { signal, method = 'GET', body } = {}) {
    if (!base) throw new ApiError('API URL is not configured. Set the corresponding VITE_*_API_URL.');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
    try {
      const response = await fetchImpl(`${base.replace(/\/$/, '')}${path}`, {
        method, signal: controller.signal, headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const data = response.status === 204 ? null : await response.json().catch(() => {
        throw new ApiError('The API returned an invalid JSON response.', response.status);
      });
      if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : Array.isArray(data?.detail)
          ? data.detail.map(item => `${item.loc?.join('.')}: ${item.msg}`).join('; ') : `Request failed (${response.status})`;
        throw new ApiError(detail, response.status);
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (controller.signal.aborted) throw new ApiError('Request timed out. Refresh status before retrying a change.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('Cannot reach the API. Check connectivity and service configuration.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  const detail = (id, options) => request(controllerApiUrl, `/api/experiments/${encodeURIComponent(id)}`, options);
  return {
    getMetricsSummary: ({ since, windowSeconds, ...options } = {}) => {
      const query = new URLSearchParams();
      if (since) query.set('since', since);
      if (windowSeconds) query.set('window_seconds', windowSeconds);
      return request(orderApiUrl, `/api/orders/metrics-summary${query.size ? `?${query}` : ''}`, options);
    },
    createOrder: (body, options) => request(orderApiUrl, '/api/orders', { ...options, method: 'POST', body }),
    getTrafficStatus: options => request(controllerApiUrl, '/api/traffic/status', options),
    toggleTraffic: (enabled, requestsPerSecond, options) => request(controllerApiUrl, '/api/traffic/toggle', {
      ...options, method: 'POST', body: { enabled, requests_per_second: requestsPerSecond },
    }),
    getExperimentCatalog: options => request(controllerApiUrl, '/api/experiments/catalog', options),
    startExperiment: (body, options) => request(controllerApiUrl, '/api/experiments/start', { ...options, method: 'POST', body }),
    stopExperiment: (id, options) => request(controllerApiUrl, `/api/experiments/${encodeURIComponent(id)}/stop`, { ...options, method: 'POST' }),
    getExperiments: ({ limit = 50, offset = 0, ...options } = {}) => request(controllerApiUrl, `/api/experiments?${new URLSearchParams({ limit, offset })}`, options),
    getExperiment: detail,
    getAIReport: async (id, options) => (await detail(id, options)).ai_report,
    getOrderHealth: options => request(orderApiUrl, '/health', options),
    getOrderReadiness: options => request(orderApiUrl, '/ready', options),
    getControllerHealth: options => request(controllerApiUrl, '/health', options),
    getControllerReadiness: options => request(controllerApiUrl, '/ready', options),
  };
}

export const api = createApiClient({
  orderApiUrl: import.meta.env?.VITE_ORDER_API_URL,
  controllerApiUrl: import.meta.env?.VITE_CONTROLLER_API_URL,
});
