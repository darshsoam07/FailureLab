/**
 * Topology Graph Data & Derivation Helpers for FailureLab.
 *
 * Adheres strictly to the architectural contracts:
 * - 8 system services (Order API, Controller, PostgreSQL, RabbitMQ, Toxiproxy, Inventory, Fulfillment Worker, AI Worker)
 * - Directed architectural edges derived from FailureLab README architecture
 * - Real readiness signals only; affected edges are marked "degraded (derived)" when checks fail
 * - Never shows green without a confirmed probe signal
 * - Pure data and calculations testable with node --test
 */

export const TOPOLOGY_NODES = [
  {
    id: 'experiment_controller',
    name: 'Experiment Controller',
    role: 'Chaos Watchdog & Traffic Generator',
    layer: 'Chaos',
    ports: [8003],
    description: 'Orchestrates chaos drill lifecycle, manages Toxiproxy fault configurations, drives synthetic customer load, and executes deterministic SLO watchdog evaluations.',
    checkKey: 'experiment_controller',
    probeSource: 'controller',
    coords: { x: 120, y: 110 },
  },
  {
    id: 'order_api',
    name: 'Order API',
    role: 'Entrypoint / REST API',
    layer: 'Edge',
    ports: [8000],
    description: 'FastAPI public HTTP entrypoint handling checkout requests, idempotent order reservations, and transactional outbox event creation.',
    checkKey: 'order_api',
    probeSource: 'order',
    coords: { x: 120, y: 270 },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    role: 'Transactional Store & Outbox',
    layer: 'Data',
    ports: [5432],
    description: 'Primary ACID datastore containing orders, stock inventory balances, and transactional outbox events awaiting broker relay.',
    checkKey: 'database',
    probeSource: 'both',
    coords: { x: 370, y: 270 },
  },
  {
    id: 'rabbitmq',
    name: 'RabbitMQ',
    role: 'AMQP Message Broker',
    layer: 'Messaging',
    ports: [5672],
    description: 'Robust AMQP 0-9-1 event broker routing fulfillment outbox messages and experiment completion notifications.',
    checkKey: 'rabbitmq',
    probeSource: 'both',
    coords: { x: 370, y: 430 },
  },
  {
    id: 'fulfillment_worker',
    name: 'Fulfillment Worker',
    role: 'Async Order Consumer',
    layer: 'Workers',
    ports: [8002],
    description: 'Background worker consuming pending order events from RabbitMQ and reserving item stock with the Inventory Service through Toxiproxy.',
    checkKey: null,
    probeSource: null,
    coords: { x: 620, y: 430 },
  },
  {
    id: 'toxiproxy',
    name: 'Toxiproxy',
    role: 'Chaos Fault Injection Proxy',
    layer: 'Chaos',
    ports: [8474, 8475],
    description: 'Network-level resilience testing proxy intercepting downstream calls to the Inventory Service (HTTP 8474 management API, 8475 TCP proxy).',
    checkKey: 'toxiproxy',
    probeSource: 'controller',
    coords: { x: 620, y: 110 },
  },
  {
    id: 'inventory',
    name: 'Inventory Service',
    role: 'Stock Reservation Upstream',
    layer: 'Edge',
    ports: [8001],
    description: 'Downstream microservice verifying inventory SKU availability and locking stock for pending orders.',
    checkKey: null,
    probeSource: null,
    coords: { x: 840, y: 110 },
  },
  {
    id: 'ai_worker',
    name: 'AI Analysis Worker',
    role: 'Post-Mortem Analyzer',
    layer: 'Workers',
    ports: [8004],
    description: 'Asynchronously consumes finished experiment events, processes telemetry snapshots, and synthesizes root-cause post-mortem analyses.',
    checkKey: null,
    probeSource: null,
    coords: { x: 620, y: 270 },
  },
];

export const TOPOLOGY_EDGES = [
  {
    id: 'controller_to_order',
    from: 'experiment_controller',
    to: 'order_api',
    label: 'Synthetic traffic',
    protocol: 'HTTP',
    description: 'Offers continuous load to Order API /api/orders during experiment execution.',
  },
  {
    id: 'order_to_postgres',
    from: 'order_api',
    to: 'postgres',
    label: 'Order persistence & outbox',
    protocol: 'SQL',
    description: 'Persists order records and commits transactional outbox events.',
  },
  {
    id: 'postgres_outbox_to_rabbitmq',
    from: 'postgres',
    to: 'rabbitmq',
    label: 'Outbox relay',
    protocol: 'AMQP',
    description: 'Background relay reads processed=false outbox events and publishes to RabbitMQ.',
  },
  {
    id: 'rabbitmq_to_worker',
    from: 'rabbitmq',
    to: 'fulfillment_worker',
    label: 'Fulfillment queue',
    protocol: 'AMQP',
    description: 'Dispatches fulfillment tasks to async worker consumer pool.',
  },
  {
    id: 'worker_to_toxiproxy',
    from: 'fulfillment_worker',
    to: 'toxiproxy',
    label: 'Downstream inventory call',
    protocol: 'HTTP',
    description: 'HTTP reservation requests routed through Toxiproxy proxy port 8475.',
  },
  {
    id: 'toxiproxy_to_inventory',
    from: 'toxiproxy',
    to: 'inventory',
    label: 'Injected proxy traffic',
    protocol: 'HTTP',
    description: 'Pass-through or fault-manipulated traffic forwarded to Inventory Service on port 8001.',
  },
  {
    id: 'inventory_to_postgres',
    from: 'inventory',
    to: 'postgres',
    label: 'Stock reservation store',
    protocol: 'SQL',
    description: 'Queries and updates stock availability tables with positive quantities.',
  },
  {
    id: 'controller_to_toxiproxy',
    from: 'experiment_controller',
    to: 'toxiproxy',
    label: 'Fault injection API',
    protocol: 'HTTP',
    description: 'Manipulates toxic configurations (latency, bandwidth, timeout, reset) via port 8474.',
  },
  {
    id: 'controller_to_rabbitmq',
    from: 'experiment_controller',
    to: 'rabbitmq',
    label: 'AI queue event',
    protocol: 'AMQP',
    description: 'Publishes experiment_finished lifecycle event to analysis queue.',
  },
  {
    id: 'rabbitmq_to_ai_worker',
    from: 'rabbitmq',
    to: 'ai_worker',
    label: 'AI analysis queue',
    protocol: 'AMQP',
    description: 'Delivers finished experiment tasks to AI post-mortem analyzer.',
  },
  {
    id: 'ai_worker_to_postgres',
    from: 'ai_worker',
    to: 'postgres',
    label: 'AI report persistence',
    protocol: 'SQL',
    description: 'Saves synthesized AI report with confidence score and evidence bullets.',
  },
];

/**
 * Derives health for all architectural edges based on probe checks.
 *
 * Adheres to:
 * - "Never show green without a real signal."
 * - "If a dependency check fails, mark the affected edges 'degraded (derived)' and label the derivation."
 *
 * @param {Object} options
 * @param {Array<Object>} [options.edges=TOPOLOGY_EDGES]
 * @param {Record<string, { status: string }>} [options.nodeHealthMap={}]
 * @param {Object|null} [options.orderReadiness=null]
 * @param {Object|null} [options.controllerReadiness=null]
 * @returns {Array<Object>}
 */
export function deriveEdgeHealth({
  edges = TOPOLOGY_EDGES,
  nodeHealthMap = {},
  orderReadiness = null,
  controllerReadiness = null,
} = {}) {
  const orderChecks = orderReadiness?.checks || {};
  const controllerChecks = controllerReadiness?.checks || {};

  return edges.map((edge) => {
    const sourceHealth = nodeHealthMap[edge.from]?.status || 'unknown';
    const targetHealth = nodeHealthMap[edge.to]?.status || 'unknown';

    // 1. Check for explicit failing dependency probes (derived degradation)
    if (edge.id === 'order_to_postgres' && orderChecks.database === false) {
      return {
        ...edge,
        status: 'degraded',
        derivation: 'Derived: Order API database probe check is failing',
      };
    }

    if (edge.id === 'postgres_outbox_to_rabbitmq' && orderChecks.outbox_relay === false) {
      return {
        ...edge,
        status: 'degraded',
        derivation: 'Derived: Order API outbox relay probe check is failing',
      };
    }

    if (
      (edge.from === 'rabbitmq' || edge.to === 'rabbitmq') &&
      (orderChecks.rabbitmq === false || controllerChecks.rabbitmq === false)
    ) {
      return {
        ...edge,
        status: 'degraded',
        derivation: 'Derived: RabbitMQ broker readiness check is failing',
      };
    }

    if (
      (edge.from === 'toxiproxy' || edge.to === 'toxiproxy') &&
      controllerChecks.toxiproxy === false
    ) {
      return {
        ...edge,
        status: 'degraded',
        derivation: 'Derived: Toxiproxy daemon check is failing on Controller',
      };
    }

    // 2. If either endpoint node is explicitly degraded or unhealthy
    if (sourceHealth === 'unhealthy' || targetHealth === 'unhealthy') {
      return {
        ...edge,
        status: 'unhealthy',
        derivation: `Derived: Endpoint unhealthy (${sourceHealth === 'unhealthy' ? edge.from : edge.to})`,
      };
    }

    if (sourceHealth === 'degraded' || targetHealth === 'degraded') {
      return {
        ...edge,
        status: 'degraded',
        derivation: `Derived: Endpoint degraded (${sourceHealth === 'degraded' ? edge.from : edge.to})`,
      };
    }

    // 3. Unprobed endpoints (Worker, Inventory, AI Worker): rule "Never color anything green without a signal"
    if (sourceHealth === 'unknown' || targetHealth === 'unknown') {
      const unprobedNode = sourceHealth === 'unknown' ? edge.from : edge.to;
      return {
        ...edge,
        status: 'unknown',
        derivation: `Derived: No readiness probe is reachable from the browser for ${unprobedNode}`,
      };
    }

    // 4. Confirmed healthy signal on both source and target with passing checks
    return {
      ...edge,
      status: 'healthy',
      derivation: 'Verified: Endpoints reporting passing readiness checks',
    };
  });
}

/**
 * Builds detail presentation data for a selected topology node.
 * Contains only real probe check names, timestamps, and actual connections.
 * No fabricated metrics (CPU, memory, replicas).
 *
 * @param {Object} options
 * @param {string} options.nodeId
 * @param {Record<string, Object>} options.nodeHealthMap
 * @param {Object|null} [options.experiment]
 * @param {Object|null} [options.orderReadiness]
 * @param {Object|null} [options.controllerReadiness]
 * @param {string|null} [options.lastProbeTime]
 * @returns {Object|null}
 */
export function deriveNodeDetails({
  nodeId,
  nodeHealthMap = {},
  experiment = null,
  orderReadiness = null,
  controllerReadiness = null,
  lastProbeTime = null,
} = {}) {
  const node = TOPOLOGY_NODES.find((n) => n.id === nodeId);
  if (!node) return null;

  const health = nodeHealthMap[nodeId] || { status: 'unknown', detail: 'Unknown' };

  // Calculate incoming and outgoing connections
  const incoming = TOPOLOGY_EDGES.filter((e) => e.to === nodeId).map((e) => ({
    from: e.from,
    fromName: TOPOLOGY_NODES.find((n) => n.id === e.from)?.name || e.from,
    label: e.label,
    protocol: e.protocol,
  }));

  const outgoing = TOPOLOGY_EDGES.filter((e) => e.from === nodeId).map((e) => ({
    to: e.to,
    toName: TOPOLOGY_NODES.find((n) => n.id === e.to)?.name || e.to,
    label: e.label,
    protocol: e.protocol,
  }));

  // Determine specific probe checks for this node
  const probeChecks = [];
  if (node.probeSource === 'order' || node.probeSource === 'both') {
    if (orderReadiness?.checks) {
      if (node.checkKey && typeof orderReadiness.checks[node.checkKey] === 'boolean') {
        probeChecks.push({
          source: 'Order API /ready',
          checkName: `checks.${node.checkKey}`,
          passing: orderReadiness.checks[node.checkKey],
        });
      }
      if (nodeId === 'order_api') {
        probeChecks.push({
          source: 'Order API /ready',
          checkName: 'status: ready',
          passing: orderReadiness.status === 'ready',
        });
      }
    }
  }

  if (node.probeSource === 'controller' || node.probeSource === 'both') {
    if (controllerReadiness?.checks) {
      if (node.checkKey && typeof controllerReadiness.checks[node.checkKey] === 'boolean') {
        probeChecks.push({
          source: 'Controller /ready',
          checkName: `checks.${node.checkKey}`,
          passing: controllerReadiness.checks[node.checkKey],
        });
      }
      if (nodeId === 'experiment_controller') {
        probeChecks.push({
          source: 'Controller /ready',
          checkName: 'status: ready',
          passing: controllerReadiness.status === 'ready',
        });
        if (typeof controllerReadiness.checks.background_tasks === 'boolean') {
          probeChecks.push({
            source: 'Controller /ready',
            checkName: 'checks.background_tasks',
            passing: controllerReadiness.checks.background_tasks,
          });
        }
        if (typeof controllerReadiness.checks.safety_engine === 'boolean') {
          probeChecks.push({
            source: 'Controller /ready',
            checkName: 'checks.safety_engine',
            passing: controllerReadiness.checks.safety_engine,
          });
        }
      }
    }
  }

  // Toxiproxy-specific active state
  let toxiproxyActiveFault = null;
  let toxiproxyMode = null;
  if (nodeId === 'toxiproxy') {
    toxiproxyMode = controllerReadiness?.toxiproxy_mode || 'real';
    if (experiment && experiment.status === 'RUNNING') {
      toxiproxyActiveFault = {
        faultType: experiment.fault_type,
        targetService: experiment.target_service,
        parameters: experiment.parameters || {},
      };
    }
  }

  const unprobedReason = !node.checkKey
    ? 'No readiness probe is reachable from the browser'
    : null;

  return {
    ...node,
    status: health.status,
    healthDetail: health.detail,
    unprobedReason,
    probeChecks,
    lastProbeTime: lastProbeTime || (health.status !== 'unknown' ? 'Active' : 'Unprobed'),
    incoming,
    outgoing,
    toxiproxyActiveFault,
    toxiproxyMode,
  };
}

/**
 * Groups topology nodes by layer for mobile vertical layout.
 *
 * @param {Array<Object>} [nodes=TOPOLOGY_NODES]
 * @param {Record<string, Object>} [nodeHealthMap={}]
 * @returns {Record<string, Array<Object>>}
 */
export function groupNodesByLayer(nodes = TOPOLOGY_NODES, nodeHealthMap = {}) {
  const layers = {
    Edge: [],
    Data: [],
    Messaging: [],
    Workers: [],
    Chaos: [],
  };

  for (const node of nodes) {
    const health = nodeHealthMap[node.id] || { status: 'unknown', detail: 'Unknown' };
    const enriched = {
      ...node,
      status: health.status,
      healthDetail: health.detail,
    };
    if (layers[node.layer]) {
      layers[node.layer].push(enriched);
    } else {
      layers.Edge.push(enriched);
    }
  }

  return layers;
}
