import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPOLOGY_NODES,
  TOPOLOGY_EDGES,
  deriveEdgeHealth,
  deriveNodeDetails,
  groupNodesByLayer,
} from '../src/lib/topologyGraph.js';

test('topology graph definition: exactly 8 core nodes exist', () => {
  assert.equal(TOPOLOGY_NODES.length, 8);
  const ids = TOPOLOGY_NODES.map((n) => n.id);
  assert.ok(ids.includes('order_api'));
  assert.ok(ids.includes('experiment_controller'));
  assert.ok(ids.includes('postgres'));
  assert.ok(ids.includes('rabbitmq'));
  assert.ok(ids.includes('fulfillment_worker'));
  assert.ok(ids.includes('toxiproxy'));
  assert.ok(ids.includes('inventory'));
  assert.ok(ids.includes('ai_worker'));
});

test('topology graph integrity: every edge references an existing node and no node is isolated', () => {
  const nodeIds = new Set(TOPOLOGY_NODES.map((n) => n.id));
  const connectedNodes = new Set();

  for (const edge of TOPOLOGY_EDGES) {
    // 1. Every edge references an existing source and target
    assert.ok(
      nodeIds.has(edge.from),
      `Edge ${edge.id} references non-existent source node: ${edge.from}`
    );
    assert.ok(
      nodeIds.has(edge.to),
      `Edge ${edge.id} references non-existent target node: ${edge.to}`
    );
    connectedNodes.add(edge.from);
    connectedNodes.add(edge.to);
  }

  // 2. No node is isolated
  for (const nodeId of nodeIds) {
    assert.ok(
      connectedNodes.has(nodeId),
      `Node ${nodeId} is isolated with no incoming or outgoing connections`
    );
  }
});

test('deriveEdgeHealth marks edges degraded when dependency checks fail and labels derivation', () => {
  const nodeHealthMap = {
    order_api: { status: 'healthy' },
    experiment_controller: { status: 'healthy' },
    postgres: { status: 'healthy' },
    rabbitmq: { status: 'healthy' },
    toxiproxy: { status: 'healthy' },
    inventory: { status: 'unknown' },
    fulfillment_worker: { status: 'unknown' },
    ai_worker: { status: 'unknown' },
  };

  // Case 1: Order API DB check fails
  const edgesDbFail = deriveEdgeHealth({
    nodeHealthMap,
    orderReadiness: {
      status: 'not_ready',
      checks: { database: false, rabbitmq: true, outbox_relay: true },
    },
  });
  const orderToPg = edgesDbFail.find((e) => e.id === 'order_to_postgres');
  assert.equal(orderToPg.status, 'degraded');
  assert.ok(orderToPg.derivation.includes('Order API database probe check is failing'));

  // Case 2: Outbox relay check fails
  const edgesOutboxFail = deriveEdgeHealth({
    nodeHealthMap,
    orderReadiness: {
      status: 'not_ready',
      checks: { database: true, rabbitmq: true, outbox_relay: false },
    },
  });
  const pgToRabbit = edgesOutboxFail.find((e) => e.id === 'postgres_outbox_to_rabbitmq');
  assert.equal(pgToRabbit.status, 'degraded');
  assert.ok(pgToRabbit.derivation.includes('outbox relay probe check is failing'));

  // Case 3: Toxiproxy check fails on Controller
  const edgesToxiFail = deriveEdgeHealth({
    nodeHealthMap,
    controllerReadiness: {
      toxiproxy_mode: 'real',
      status: 'not_ready',
      checks: { database: true, rabbitmq: true, toxiproxy: false },
    },
  });
  const ctrlToToxi = edgesToxiFail.find((e) => e.id === 'controller_to_toxiproxy');
  assert.equal(ctrlToToxi.status, 'degraded');
  assert.ok(ctrlToToxi.derivation.includes('Toxiproxy daemon check is failing'));
});

test('deriveEdgeHealth never colors unprobed dependencies green without a real signal', () => {
  const nodeHealthMap = {
    order_api: { status: 'healthy' },
    experiment_controller: { status: 'healthy' },
    postgres: { status: 'healthy' },
    rabbitmq: { status: 'healthy' },
    toxiproxy: { status: 'healthy' },
    inventory: { status: 'unknown' },
    fulfillment_worker: { status: 'unknown' },
    ai_worker: { status: 'unknown' },
  };

  const edges = deriveEdgeHealth({
    nodeHealthMap,
    orderReadiness: { status: 'ready', checks: { database: true, rabbitmq: true, outbox_relay: true } },
    controllerReadiness: { toxiproxy_mode: 'real', status: 'ready', checks: { database: true, rabbitmq: true, toxiproxy: true } },
  });

  // Edge to worker or inventory must be unknown (never green)
  const workerToToxi = edges.find((e) => e.id === 'worker_to_toxiproxy');
  assert.equal(workerToToxi.status, 'unknown');
  assert.ok(workerToToxi.derivation.includes('No readiness probe is reachable'));

  const toxiToInv = edges.find((e) => e.id === 'toxiproxy_to_inventory');
  assert.equal(toxiToInv.status, 'unknown');

  // Fully probed edge between healthy nodes is healthy
  const ctrlToOrder = edges.find((e) => e.id === 'controller_to_order');
  assert.equal(ctrlToOrder.status, 'healthy');
});

test('deriveNodeDetails extracts connections, exact check names, and active fault vs proxy mode', () => {
  const nodeHealthMap = {
    toxiproxy: { status: 'healthy', detail: 'Real proxy connected' },
    inventory: { status: 'unknown', detail: 'No readiness probe is reachable from the browser' },
  };

  // 1. Unprobed node (Inventory)
  const invDetails = deriveNodeDetails({
    nodeId: 'inventory',
    nodeHealthMap,
  });
  assert.equal(invDetails.status, 'unknown');
  assert.equal(invDetails.unprobedReason, 'No readiness probe is reachable from the browser');
  assert.ok(invDetails.incoming.some((c) => c.from === 'toxiproxy'));
  assert.ok(invDetails.outgoing.some((c) => c.to === 'postgres'));

  // 2. Toxiproxy when experiment is RUNNING
  const runningExperiment = {
    status: 'RUNNING',
    fault_type: 'LATENCY',
    target_service: 'inventory_service',
    parameters: { latency_ms: 300, jitter_ms: 20 },
  };
  const toxiRunning = deriveNodeDetails({
    nodeId: 'toxiproxy',
    nodeHealthMap,
    experiment: runningExperiment,
    controllerReadiness: { checks: { toxiproxy: true }, toxiproxy_mode: 'real' },
  });
  assert.equal(toxiRunning.status, 'healthy');
  assert.equal(toxiRunning.toxiproxyActiveFault.faultType, 'LATENCY');
  assert.deepEqual(toxiRunning.toxiproxyActiveFault.parameters, { latency_ms: 300, jitter_ms: 20 });
  assert.equal(toxiRunning.probeChecks[0].checkName, 'checks.toxiproxy');

  // 3. Toxiproxy when no experiment is running
  const toxiIdle = deriveNodeDetails({
    nodeId: 'toxiproxy',
    nodeHealthMap,
    experiment: null,
    controllerReadiness: { checks: { toxiproxy: true }, toxiproxy_mode: 'simulated' },
  });
  assert.equal(toxiIdle.toxiproxyActiveFault, null);
  assert.equal(toxiIdle.toxiproxyMode, 'simulated');
});

test('groupNodesByLayer groups nodes into all 5 layers with no dropped nodes', () => {
  const grouped = groupNodesByLayer(TOPOLOGY_NODES, {});
  assert.ok(Array.isArray(grouped.Edge));
  assert.ok(Array.isArray(grouped.Data));
  assert.ok(Array.isArray(grouped.Messaging));
  assert.ok(Array.isArray(grouped.Workers));
  assert.ok(Array.isArray(grouped.Chaos));

  const total =
    grouped.Edge.length +
    grouped.Data.length +
    grouped.Messaging.length +
    grouped.Workers.length +
    grouped.Chaos.length;
  assert.equal(total, 8);
});


test('non-real proxy edges are simulated, never healthy', () => {
  for (const mode of ['simulated', 'fallback', undefined]) {
    const edges = deriveEdgeHealth({ controllerReadiness: { toxiproxy_mode: mode, checks: { toxiproxy: true } } });
    for (const edge of edges.filter(e => e.from === 'toxiproxy' || e.to === 'toxiproxy')) {
      assert.equal(edge.status, 'simulated');
      assert.equal(edge.derivation, 'Faults are simulated; results are not from a real proxy');
    }
  }
});

test('last probe defaults to never and preserves the client successful-poll label', () => {
  assert.equal(deriveNodeDetails({ nodeId: 'toxiproxy' }).lastProbeTime, 'never');
  assert.equal(deriveNodeDetails({ nodeId: 'order_api', lastProbeTime: '12:34:56' }).lastProbeTime, '12:34:56');
});
