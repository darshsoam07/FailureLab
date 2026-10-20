/**
 * Navigation items, titles, health-pill derivation, and stop button logic
 * for the FailureLab App Shell.
 */

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'experiments', label: 'Experiments' },
  { id: 'reports', label: 'Reports' },
  { id: 'topology', label: 'Topology' },
  { id: 'settings', label: 'Settings' },
];

export const PAGE_TITLES = {
  dashboard: 'Command Center Dashboard',
  experiments: 'Chaos Experiments Studio',
  reports: 'Resilience Reports & Post-Mortems',
  topology: 'Distributed System Topology',
  settings: 'System & Guardrail Settings',
};

/**
 * Returns the human-readable page title for the active screen.
 *
 * @param {string} screenId
 * @returns {string}
 */
export function getPageTitle(screenId) {
  return PAGE_TITLES[screenId] || 'Command Center Dashboard';
}

/**
 * Determines whether the Emergency Stop button is enabled.
 * Rule: Enabled ONLY when an experiment has status RUNNING.
 *
 * @param {Object|null} experiment - Active experiment object
 * @returns {{ enabled: boolean, label: string, reason: string, experimentId: string|null, experimentName: string|null }}
 */
export function canEmergencyStop(experiment) {
  if (!experiment || experiment.status !== 'RUNNING' || !experiment.id) {
    return {
      enabled: false,
      label: 'STANDBY',
      reason: 'No running fault injection to abort',
      experimentId: null,
      experimentName: null,
    };
  }
  return {
    enabled: true,
    label: 'EMERGENCY STOP',
    reason: `Running fault: ${experiment.name || experiment.fault_type}`,
    experimentId: experiment.id,
    experimentName: experiment.name,
  };
}

/**
 * Derives the state of the controller readiness health pill.
 *
 * States:
 * - 'ready' (green): all checks passing
 * - 'degraded' (amber): one or more checks failing
 * - 'unreachable' (red): network error / fetch failure
 * - 'loading' (neutral): probe in-flight, awaiting first signal
 *
 * @param {Object} params
 * @param {Object|null} [params.data] - Controller /ready JSON response
 * @param {Error|string|null} [params.error] - Fetch error if any
 * @param {boolean} [params.loading=false]
 * @returns {{ state: 'ready'|'degraded'|'unreachable'|'loading', label: string, detail: string, failingChecks: string[], toxiproxyMode: string|null }}
 */
export function deriveHealthPillState({ data = null, error = null, loading = false } = {}) {
  if (error) {
    const errorMsg = typeof error === 'string' ? error : error?.message || 'Connection failed';
    return {
      state: 'unreachable',
      label: 'Controller Unreachable',
      detail: `Control plane offline: ${errorMsg}`,
      failingChecks: [],
      toxiproxyMode: null,
    };
  }

  if (loading && !data) {
    return {
      state: 'loading',
      label: 'Connecting...',
      detail: 'Awaiting controller readiness signal',
      failingChecks: [],
      toxiproxyMode: null,
    };
  }

  if (!data) {
    return {
      state: 'loading',
      label: 'Standby',
      detail: 'No readiness data received',
      failingChecks: [],
      toxiproxyMode: null,
    };
  }

  const checks = data.checks && typeof data.checks === 'object' ? data.checks : {};
  const failingChecks = Object.entries(checks)
    .filter(([, ok]) => ok === false)
    .map(([name]) => name);

  const toxiproxyMode = typeof data.toxiproxy_mode === 'string' ? data.toxiproxy_mode : null;
  const isReady = data.status === 'ready' && failingChecks.length === 0;

  if (isReady) {
    return {
      state: 'ready',
      label: 'All services ready',
      detail: `All ${Object.keys(checks).length} subsystem checks passing`,
      failingChecks: [],
      toxiproxyMode,
    };
  }

  return {
    state: 'degraded',
    label: failingChecks.length > 0 ? `Degraded (${failingChecks.length} failing)` : 'Control plane degraded',
    detail: failingChecks.length > 0
      ? `Failing checks: ${failingChecks.join(', ')}`
      : 'Controller reports not_ready',
    failingChecks,
    toxiproxyMode,
  };
}

/**
 * Classifies an error from stopExperiment to detect if the experiment
 * has already ended (due to watchdog auto-abort or completion race).
 *
 * @param {Error|string|null} error
 * @returns {boolean}
 */
export function isExperimentAlreadyEndedError(error) {
  if (!error) return false;
  const msg = (typeof error === 'string' ? error : error?.message || '').toLowerCase();
  return (
    msg.includes('already finished') ||
    msg.includes('already ended') ||
    msg.includes('not found') ||
    msg.includes('404') ||
    msg.includes('no active experiment') ||
    msg.includes('not running') ||
    msg.includes('not in active')
  );
}

