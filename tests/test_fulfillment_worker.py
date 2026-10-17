import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.dialects import postgresql

from services.common.models import Order, OrderStatus
from services.fulfillment_worker import worker as module
from services.fulfillment_worker.resilience import CircuitBreaker, CircuitBreakerOpen, RetryStats


def setup_worker(status=OrderStatus.PENDING):
    order = Order(id=uuid4(), customer_id="c", sku="SKU-PHONE", quantity=2,
                  status=status, latency_ms=12, error_reason=None, created_at=datetime.now(timezone.utc))
    event = module.FulfillmentEvent(order_id=order.id, customer_id=order.customer_id,
                                    sku=order.sku, quantity=order.quantity)
    message = MagicMock(body=event.model_dump_json().encode(), processed=False)
    message.ack, message.nack, message.reject = AsyncMock(), AsyncMock(), AsyncMock()
    session = MagicMock()
    session.scalar = AsyncMock(return_value=order)
    transaction = AsyncMock()
    transaction.__aexit__.return_value = False
    session.begin.return_value = transaction
    context = AsyncMock()
    context.__aenter__.return_value = session
    context.__aexit__.return_value = False
    factory = MagicMock(return_value=context)
    inventory = SimpleNamespace(reserve=AsyncMock(), breaker=CircuitBreaker(), stats=RetryStats())
    worker = module.FulfillmentWorker(factory, inventory, requeue_delay=0.001)
    return worker, message, order, session, transaction


@pytest.mark.asyncio
@pytest.mark.parametrize('running,registered', [(True, True), (True, False), (False, True)])
async def test_readiness_rejects_stale_consumer_even_when_task_is_alive(monkeypatch, running, registered):
    worker, _, _, _, _ = setup_worker()
    worker.inventory.client = SimpleNamespace(is_closed=False)
    task = MagicMock()
    task.done.return_value = not running
    supervisor = SimpleNamespace(healthy=registered, probe=AsyncMock(return_value=registered))
    context = AsyncMock()
    context.__aenter__.return_value = SimpleNamespace(execute=AsyncMock())
    monkeypatch.setattr(module, 'get_session_factory', lambda: MagicMock(return_value=context))
    monkeypatch.setattr(module, 'get_worker_settings', lambda: SimpleNamespace(READINESS_TIMEOUT_SECONDS=1))
    state = SimpleNamespace(ready=True, worker=worker, consumer_task=task, consumer_supervisor=supervisor)
    response = await module.ready(SimpleNamespace(app=SimpleNamespace(state=state)))
    assert response.status_code == (200 if running and registered else 503)


@pytest.mark.asyncio
async def test_success_commits_before_ack_and_records_duration(monkeypatch):
    worker, message, order, session, transaction = setup_worker()
    times = iter([100, 100.2])
    monkeypatch.setattr(module.time, "perf_counter", lambda: next(times))
    sequence = []
    transaction.__aexit__.side_effect = lambda *args: sequence.append("commit") or False
    message.ack.side_effect = lambda: sequence.append("ack")
    await worker.process_message(message)
    assert sequence == ["commit", "ack"]
    assert order.status == OrderStatus.RESERVED and order.error_reason is None
    assert 200 <= order.latency_ms < 250
    worker.inventory.reserve.assert_awaited_once_with(order.id, order.sku, order.quantity)
    sql = str(session.scalar.call_args.args[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in sql
    assert worker.stats.reserved == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,reason", [("timeout", "TimeoutException"), ("breaker", "CircuitBreakerOpen"), ("http", "HTTP_503")])
async def test_expected_failure_is_persisted_then_acked(kind, reason):
    worker, message, order, _, transaction = setup_worker()
    exceptions = {
        "timeout": httpx.ReadTimeout("timeout"),
        "breaker": CircuitBreakerOpen(),
        "http": httpx.HTTPStatusError("503", request=httpx.Request("POST", "http://proxy.test"), response=httpx.Response(503)),
    }
    worker.inventory.reserve.side_effect = exceptions[kind]
    await worker.process_message(message)
    assert order.status == OrderStatus.FAILED and order.error_reason == reason
    assert order.latency_ms >= 0
    transaction.__aexit__.assert_awaited_once_with(None, None, None)
    message.ack.assert_awaited_once()
    assert worker.stats.failed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [OrderStatus.RESERVED, OrderStatus.FAILED])
async def test_terminal_redelivery_skips_http_and_keeps_latency(status):
    worker, message, order, _, _ = setup_worker(status)
    await worker.process_message(message)
    worker.inventory.reserve.assert_not_awaited()
    assert order.status == status and order.latency_ms == 12
    message.ack.assert_awaited_once()
    assert worker.stats.duplicate_messages == 1


@pytest.mark.asyncio
async def test_commit_failure_requeues_without_ack():
    worker, message, _, _, transaction = setup_worker()
    transaction.__aexit__.side_effect = ConnectionError("database lost")
    await worker.process_message(message)
    message.ack.assert_not_awaited()
    message.nack.assert_awaited_once_with(requeue=True)
    assert worker.stats.requeued_messages == 1


@pytest.mark.asyncio
async def test_cancelled_http_rolls_back_and_leaves_delivery_unacked():
    worker, message, _, _, transaction = setup_worker()
    worker.inventory.reserve.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await worker.process_message(message)
    assert transaction.__aexit__.call_args.args[0] is asyncio.CancelledError
    message.ack.assert_not_awaited()
    message.nack.assert_not_awaited()


@pytest.mark.asyncio
async def test_malformed_event_is_rejected_without_database_access():
    worker, message, _, _, _ = setup_worker()
    message.body = b"not json"
    await worker.process_message(message)
    worker.session_factory.assert_not_called()
    message.reject.assert_awaited_once_with(requeue=False)


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [False, True])
async def test_unknown_or_mismatched_event_is_rejected(missing):
    worker, message, order, session, _ = setup_worker()
    if missing:
        session.scalar.return_value = None
    else:
        order.quantity += 1
    await worker.process_message(message)
    worker.inventory.reserve.assert_not_awaited()
    message.reject.assert_awaited_once_with(requeue=False)


@pytest.mark.asyncio
async def test_worker_stats_and_health(monkeypatch):
    worker, _, _, _, _ = setup_worker()
    worker.inventory.stats.retry_count = 2
    monkeypatch.setattr(module.app.state, "worker", worker, raising=False)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=module.app), base_url="http://test") as client:
        response = await client.get("/worker-stats")
        assert response.json()["circuit_breaker_state"] == "CLOSED"
        assert response.json()["retry_count"] == 2
        assert (await client.get("/health")).status_code == 200
        assert (await client.get("/ready")).status_code == 503
