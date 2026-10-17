import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTopologyHealth, SYSTEM_NODES } from '../src/lib/topologyHealth.js';

test('topology system nodes definition includes all 8 core services', () => {
  assert.equal(SYSTEM_NODES.length, 8);
  const ids = SYSTEM_NODES.map(n => n.id);
  assert.ok(ids.includes('order_api'));
  assert.ok(ids.includes('experiment_controller'));
  assert.ok(ids.includes('postgres'));
  assert.ok(ids.includes('rabbitmq'));
  assert.ok(ids.includes('toxiproxy'));
  assert.ok(ids.includes('inventory'));
  assert.ok(ids.includes('fulfillment_worker'));
  assert.ok(ids.includes('ai_worker'));
});

test('never shows green without a real signal: empty probes return unknown for all dependencies', () => {
  const health = deriveTopologyHealth({});
  assert.equal(health.postgres.status, 'unknown');
  assert.equal(health.rabbitmq.status, 'unknown');
  assert.equal(health.toxiproxy.status, 'unknown');
  assert.equal(health.order_api.status, 'unknown');
  assert.equal(health.experiment_controller.status, 'unknown');
  assert.equal(health.inventory.status, 'unknown');
  assert.equal(health.fulfillment_worker.status, 'unknown');
  assert.equal(health.ai_worker.status, 'unknown');
});

test('unprobed services (inventory, fulfillment, ai worker) are always unknown', () => {
  const fullReadiness = {
    orderReadiness: { status: 'ready', checks: { database: true, rabbitmq: true, outbox_relay: true } },
    controllerReadiness: {
      status: 'ready',
      checks: { database: true, rabbitmq: true, toxiproxy: true, background_tasks: true, safety_engine: true },
      toxiproxy_mode: 'real',
    },
  };
  const health = deriveTopologyHealth(fullReadiness);
  assert.equal(health.inventory.status, 'unknown');
  assert.equal(health.fulfillment_worker.status, 'unknown');
  assert.equal(health.ai_worker.status, 'unknown');
});

test('derives healthy status when readiness probes report positive checks', () => {
  const probes = {
    orderReadiness: { status: 'ready', checks: { database: true, rabbitmq: true, outbox_relay: true } },
    controllerReadiness: {
      status: 'ready',
      checks: { database: true, rabbitmq: true, toxiproxy: true, background_tasks: true, safety_engine: true },
      toxiproxy_mode: 'real',
    },
  };
  const health = deriveTopologyHealth(probes);
  assert.equal(health.order_api.status, 'healthy');
  assert.equal(health.experiment_controller.status, 'healthy');
  assert.equal(health.postgres.status, 'healthy');
  assert.equal(health.rabbitmq.status, 'healthy');
  assert.equal(health.toxiproxy.status, 'healthy');
  assert.equal(health.toxiproxy.detail, 'Real proxy connected');
});

test('derives degraded or unhealthy status when checks fail', () => {
  // DB check fails in order API but passes in controller -> degraded
  const degradedDb = deriveTopologyHealth({
    orderReadiness: { status: 'not_ready', checks: { database: false, rabbitmq: true, outbox_relay: true } },
    controllerReadiness: { status: 'ready', checks: { database: true, rabbitmq: true, toxiproxy: true } },
  });
  assert.equal(degradedDb.postgres.status, 'degraded');
  assert.equal(degradedDb.order_api.status, 'unhealthy');

  // Both report DB false -> unhealthy
  const unhealthyDb = deriveTopologyHealth({
    orderReadiness: { status: 'not_ready', checks: { database: false, rabbitmq: true } },
    controllerReadiness: { status: 'not_ready', checks: { database: false, rabbitmq: true, toxiproxy: true } },
  });
  assert.equal(unhealthyDb.postgres.status, 'unhealthy');

  // Toxiproxy reports false in controller -> unhealthy
  const badProxy = deriveTopologyHealth({
    controllerReadiness: { status: 'not_ready', checks: { toxiproxy: false } },
  });
  assert.equal(badProxy.toxiproxy.status, 'unhealthy');
});
