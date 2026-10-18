/**
 * Derives the health status of system services and dependencies
 * based on readiness probes and checks from Order API and Experiment Controller.
 *
 * Adheres strictly to the rule: "Never show green without a real signal."
 * Only services with confirmed positive signals are marked 'healthy'.
 * Unprobed services (Inventory, Fulfillment Worker, AI Worker) are always 'unknown'.
 */

export const SYSTEM_NODES = [
  { id: 'order_api', name: 'Order API', role: 'Entrypoint / REST API', layer: 'service', port: 8000 },
  { id: 'experiment_controller', name: 'Experiment Controller', role: 'Watchdog & Orchestration', layer: 'control', port: 8003 },
  { id: 'postgres', name: 'PostgreSQL', role: 'Transactional Order Store', layer: 'datastore', port: 5432 },
  { id: 'rabbitmq', name: 'RabbitMQ', role: 'Event Broker / Outbox Queue', layer: 'datastore', port: 5672 },
  { id: 'toxiproxy', name: 'Toxiproxy', role: 'Chaos Fault Injection Proxy', layer: 'proxy', port: 8474 },
  { id: 'inventory', name: 'Inventory Service', role: 'Upstream Dependency', layer: 'service', port: 8001 },
  { id: 'fulfillment_worker', name: 'Fulfillment Worker', role: 'Async Queue Consumer', layer: 'worker' },
  { id: 'ai_worker', name: 'AI Worker', role: 'Post-Mortem Analyzer', layer: 'worker' },
];

/**
 * Derives health for PostgreSQL from checks in Order API and Controller.
 */
function derivePostgresHealth(orderReadiness, controllerReadiness) {
  const orderCheck = orderReadiness?.checks?.database;
  const ctrlCheck = controllerReadiness?.checks?.database;

  const signals = [orderCheck, ctrlCheck].filter(v => typeof v === 'boolean');
  if (signals.length === 0) {
    return { status: 'unknown', detail: 'Awaiting readiness check signal' };
  }
  if (signals.some(v => v === false)) {
    return {
      status: signals.every(v => v === false) ? 'unhealthy' : 'degraded',
      detail: 'Database readiness probe failing',
    };
  }
  return { status: 'healthy', detail: 'Connected & active across services' };
}

/**
 * Derives health for RabbitMQ from checks in Order API and Controller.
 */
function deriveRabbitMQHealth(orderReadiness, controllerReadiness) {
  const orderCheck = orderReadiness?.checks?.rabbitmq;
  const ctrlCheck = controllerReadiness?.checks?.rabbitmq;

  const signals = [orderCheck, ctrlCheck].filter(v => typeof v === 'boolean');
  if (signals.length === 0) {
    return { status: 'unknown', detail: 'Awaiting readiness check signal' };
  }
  if (signals.some(v => v === false)) {
    return {
      status: signals.every(v => v === false) ? 'unhealthy' : 'degraded',
      detail: 'RabbitMQ readiness probe failing',
    };
  }
  return { status: 'healthy', detail: 'Broker connected & queues declared' };
}

/**
 * Derives health for Toxiproxy from Controller readiness check.
 */
function deriveToxiproxyHealth(controllerReadiness) {
  const toxiCheck = controllerReadiness?.checks?.toxiproxy;
  if (typeof toxiCheck !== 'boolean') {
    return { status: 'unknown', detail: 'Awaiting controller readiness signal' };
  }
  if (!toxiCheck) {
    return { status: 'unhealthy', detail: 'Toxiproxy daemon unreachable' };
  }
  const mode = controllerReadiness?.toxiproxy_mode;
  return {
    status: 'healthy',
    detail: mode === 'simulated' ? 'Simulated proxy mode' : 'Real proxy connected',
  };
}

/**
 * Derives health for Order API itself.
 */
function deriveOrderApiHealth(orderReadiness) {
  if (!orderReadiness || typeof orderReadiness.status !== 'string') {
    return { status: 'unknown', detail: 'Awaiting readiness signal' };
  }
  if (orderReadiness.status === 'ready') {
    return { status: 'healthy', detail: 'Serving traffic (port 8000)' };
  }
  return { status: 'unhealthy', detail: 'Order API reports not_ready' };
}

/**
 * Derives health for Experiment Controller itself.
 */
function deriveControllerHealth(controllerReadiness) {
  if (!controllerReadiness || typeof controllerReadiness.status !== 'string') {
    return { status: 'unknown', detail: 'Awaiting readiness signal' };
  }
  if (controllerReadiness.status === 'ready') {
    return { status: 'healthy', detail: 'Watchdog active (port 8003)' };
  }
  return { status: 'unhealthy', detail: 'Controller reports not_ready' };
}

/**
 * Derives full topology health map for all services.
 *
 * @param {Object} probes
 * @param {Object|null} [probes.orderReadiness] - /ready response from Order API
 * @param {Object|null} [probes.controllerReadiness] - /ready response from Controller
 * @returns {Record<string, { status: 'healthy'|'degraded'|'unhealthy'|'unknown', name: string, detail: string, layer: string, port?: number }>}
 */
export function deriveTopologyHealth({ orderReadiness = null, controllerReadiness = null } = {}) {
  return {
    order_api: {
      name: 'Order API',
      layer: 'service',
      port: 8000,
      ...deriveOrderApiHealth(orderReadiness),
    },
    experiment_controller: {
      name: 'Experiment Controller',
      layer: 'control',
      port: 8003,
      ...deriveControllerHealth(controllerReadiness),
    },
    postgres: {
      name: 'PostgreSQL',
      layer: 'datastore',
      port: 5432,
      ...derivePostgresHealth(orderReadiness, controllerReadiness),
    },
    rabbitmq: {
      name: 'RabbitMQ',
      layer: 'datastore',
      port: 5672,
      ...deriveRabbitMQHealth(orderReadiness, controllerReadiness),
    },
    toxiproxy: {
      name: 'Toxiproxy',
      layer: 'proxy',
      port: 8474,
      ...deriveToxiproxyHealth(controllerReadiness),
    },
    inventory: {
      name: 'Inventory Service',
      layer: 'service',
      port: 8001,
      status: 'unknown',
      detail: 'No readiness probe is reachable from the browser',
    },
    fulfillment_worker: {
      name: 'Fulfillment Worker',
      layer: 'worker',
      status: 'unknown',
      detail: 'No readiness probe is reachable from the browser',
    },
    ai_worker: {
      name: 'AI Worker',
      layer: 'worker',
      status: 'unknown',
      detail: 'No readiness probe is reachable from the browser',
    },
  };
}
