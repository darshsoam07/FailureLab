"""Contract and failure-path checks; no external services are required."""

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import aio_pika
import httpx
import pytest
from pamqp.commands import Basic
from sqlalchemy.dialects import postgresql

from services.common.models import Order, OrderStatus, OutboxEvent
from services.common.schemas import OrderCreate
from services.order_api import main, outbox_relay as relay


def fake_session():
    session = MagicMock()
    transaction = AsyncMock()
    transaction.__aexit__.return_value = False
    session.begin.return_value = transaction
    session.flush = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock())
    session.scalars = AsyncMock()
    context = AsyncMock()
    context.__aenter__.return_value = session
    context.__aexit__.return_value = False
    factory = MagicMock(return_value=context)
    return session, transaction, factory


def event():
    return OutboxEvent(
        id=uuid4(), aggregate_id=uuid4(), event_type="OrderCreated",
        payload={"order_id": str(uuid4()), "sku": "SKU-PHONE", "quantity": 1},
        processed=False, created_at=datetime.now(timezone.utc),
    )


def fake_channel():
    channel = MagicMock()
    channel.ready = AsyncMock()
    channel.default_exchange.publish = AsyncMock(return_value=Basic.Ack())
    return channel


@pytest.mark.asyncio
async def test_order_and_outbox_share_transaction():
    session, transaction, _ = fake_session()
    added = []
    session.add.side_effect = added.append

    async def flush():
        if len(added) == 1:
            added[0].id = uuid4()
            added[0].created_at = datetime.now(timezone.utc)
            added[0].latency_ms = 0

    session.flush.side_effect = flush
    result = await main.create_order(
        OrderCreate(customer_id="c", sku="SKU-PHONE", quantity=2), session
    )
    assert result.status == OrderStatus.PENDING
    assert isinstance(added[0], Order) and isinstance(added[1], OutboxEvent)
    assert added[1].aggregate_id == result.id
    assert added[1].payload == {
        "order_id": str(result.id), "customer_id": "c", "sku": "SKU-PHONE", "quantity": 2,
    }
    session.begin.assert_called_once()
    assert session.flush.await_count == 2
    transaction.__aexit__.assert_awaited_once_with(None, None, None)


@pytest.mark.asyncio
async def test_outbox_insert_failure_aborts_order_transaction():
    session, transaction, _ = fake_session()
    session.flush.side_effect = [None, RuntimeError("insert failed")]
    with pytest.raises(RuntimeError, match="insert failed"):
        await main.create_order(OrderCreate(customer_id="c", sku="sku", quantity=1), session)
    assert transaction.__aexit__.call_args.args[0] is RuntimeError


@pytest.mark.asyncio
async def test_relay_locks_batch_and_publishes_confirmed_persistent_messages():
    session, transaction, factory = fake_session()
    item = event()
    session.scalars.return_value = MagicMock(all=lambda: [item])
    channel = fake_channel()
    assert await relay.publish_batch(factory, channel, publish_timeout=1, batch_timeout=2) == 1
    statement = session.scalars.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "FOR UPDATE SKIP LOCKED" in sql and "LIMIT 50" in sql
    assert "processed IS false" in sql
    message = channel.default_exchange.publish.call_args.args[0]
    assert json.loads(message.body) == item.payload
    assert message.delivery_mode == aio_pika.DeliveryMode.PERSISTENT
    assert message.message_id == str(item.id)
    assert message.correlation_id == str(item.aggregate_id)
    assert channel.default_exchange.publish.call_args.kwargs["mandatory"] is True
    assert channel.default_exchange.publish.call_args.kwargs["routing_key"] == relay.QUEUE_NAME
    assert item.processed is True
    transaction.__aexit__.assert_awaited_once_with(None, None, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmation", [None, False, Basic.Nack(), Basic.Reject()])
async def test_relay_never_marks_unconfirmed_events(confirmation):
    session, transaction, factory = fake_session()
    item = event()
    session.scalars.return_value = MagicMock(all=lambda: [item])
    channel = fake_channel()
    channel.default_exchange.publish.return_value = confirmation
    with pytest.raises(RuntimeError, match="acknowledge"):
        await relay.publish_batch(factory, channel, publish_timeout=1, batch_timeout=2)
    assert item.processed is False
    assert transaction.__aexit__.call_args.args[0] is RuntimeError


@pytest.mark.asyncio
async def test_mid_batch_failure_rolls_back_transaction():
    session, transaction, factory = fake_session()
    items = [event(), event()]
    session.scalars.return_value = MagicMock(all=lambda: items)
    channel = fake_channel()
    channel.default_exchange.publish.side_effect = [Basic.Ack(), ConnectionError("lost")]
    with pytest.raises(ConnectionError):
        await relay.publish_batch(factory, channel, publish_timeout=1, batch_timeout=2)
    assert transaction.__aexit__.call_args.args[0] is ConnectionError
    assert items[1].processed is False


@pytest.mark.asyncio
async def test_cancelled_publish_rolls_back_and_propagates():
    session, transaction, factory = fake_session()
    item = event()
    session.scalars.return_value = MagicMock(all=lambda: [item])
    channel = fake_channel()
    channel.default_exchange.publish.side_effect = asyncio.CancelledError
    with pytest.raises(asyncio.CancelledError):
        await relay.publish_batch(factory, channel, publish_timeout=1, batch_timeout=2)
    assert transaction.__aexit__.call_args.args[0] is asyncio.CancelledError
    assert item.processed is False


@pytest.mark.asyncio
async def test_relay_retries_after_one_second_and_honors_cancellation(monkeypatch):
    batch = AsyncMock(side_effect=[ConnectionError(), asyncio.CancelledError()])
    sleep = AsyncMock()
    monkeypatch.setattr(relay, "publish_batch", batch)
    monkeypatch.setattr(relay.asyncio, "sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        await relay.outbox_relay(MagicMock(), MagicMock(), publish_timeout=1, batch_timeout=2)
    assert batch.await_count == 2
    sleep.assert_awaited_once_with(1.0)


@pytest.mark.asyncio
async def test_relay_drains_batches_immediately_and_polls_idle_quickly(monkeypatch):
    monkeypatch.setattr(relay, 'publish_batch', AsyncMock(side_effect=[50, 7, 0, asyncio.CancelledError()]))
    sleep = AsyncMock()
    monkeypatch.setattr(relay.asyncio, 'sleep', sleep)
    with pytest.raises(asyncio.CancelledError):
        await relay.outbox_relay(MagicMock(), MagicMock(), publish_timeout=1, batch_timeout=2)
    assert [call.args[0] for call in sleep.await_args_list] == [0, 0, .05]


@pytest.mark.asyncio
async def test_metrics_since_rejects_naive_or_malformed_timestamp():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
        # Override DB dependency so invalid requests cannot require infrastructure.
        async def session():
            yield MagicMock()
        main.app.dependency_overrides[main.get_db_session] = session
        try:
            for since in ['invalid', '2026-10-17T00:00:00']:
                response = await client.get('/api/orders/metrics-summary', params={'since': since})
                assert response.status_code == 422
        finally:
            main.app.dependency_overrides.clear()


@pytest.mark.asyncio
@pytest.mark.parametrize("total,succeeded,failed,pending,rate", [(0, 0, 0, 0, 0), (10, 6, 2, 2, 0.2)])
async def test_metrics_aggregation(total, succeeded, failed, pending, rate):
    session, _, _ = fake_session()
    session.execute.return_value.mappings.return_value.one.return_value = {
        "total_orders": total, "succeeded": succeeded, "failed": failed,
        "pending_count": pending, "p95_latency_ms": 0 if total == 0 else 250,
    }
    result = await main.metrics_summary(session)
    assert result.error_rate == rate
    statement = session.execute.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "percentile_cont" in sql and "FILTER (WHERE" in sql
    assert "orders.created_at >=" in sql and "orders.created_at <=" in sql
    assert any(getattr(value, "total_seconds", lambda: None)() == 60
               for value in statement.compile().params.values())


@pytest.mark.asyncio
async def test_seed_is_insert_only(monkeypatch):
    session, transaction, factory = fake_session()
    monkeypatch.setattr(main, "get_session_factory", lambda: factory)
    await main.seed_inventory()
    statement = session.execute.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "ON CONFLICT (sku) DO NOTHING" in sql
    for sku in ("SKU-LAPTOP", "SKU-PHONE", "SKU-SERVER"):
        assert sku in sql
    assert sql.count("10000") == 3
    transaction.__aexit__.assert_awaited_once_with(None, None, None)


@pytest.mark.asyncio
async def test_health_without_dependencies():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        assert (await client.get("/health")).json() == {"status": "ok"}
        assert (await client.get("/ready")).status_code == 503


@pytest.mark.asyncio
@pytest.mark.parametrize("db_ok,rabbit_ok,relay_ok", [(True, True, True), (False, True, True), (True, False, True), (True, True, False)])
async def test_readiness_checks_dependencies(monkeypatch, db_ok, rabbit_ok, relay_ok):
    session, _, factory = fake_session()
    if not db_ok:
        session.execute.side_effect = ConnectionError()
    connection = MagicMock(is_closed=not rabbit_ok)
    connection.connected.is_set.return_value = rabbit_ok
    probe = AsyncMock()
    connection.channel.return_value = probe
    channel = fake_channel()
    channel.is_closed = False
    task = MagicMock()
    task.done.return_value = not relay_ok
    state = SimpleNamespace(ready=True, rabbitmq_connection=connection,
                            rabbitmq_channel=channel, outbox_task=task)
    monkeypatch.setattr(main, "get_session_factory", lambda: factory)
    monkeypatch.setattr(main, "get_order_api_settings", lambda: SimpleNamespace(READINESS_TIMEOUT_SECONDS=1))
    response = await main.ready(SimpleNamespace(app=SimpleNamespace(state=state)))
    assert response.status_code == (200 if db_ok and rabbit_ok and relay_ok else 503)
    assert json.loads(response.body)["checks"] == {
        "database": db_ok, "rabbitmq": rabbit_ok, "outbox_relay": relay_ok,
    }


@pytest.mark.asyncio
async def test_lifespan_starts_relay_and_cleans_up(monkeypatch):
    settings = SimpleNamespace(LOG_LEVEL="INFO", RABBITMQ_URL="amqp://broker.test/",
                               RABBITMQ_CONNECT_TIMEOUT_SECONDS=1,
                               OUTBOX_PUBLISH_TIMEOUT_SECONDS=1, OUTBOX_BATCH_TIMEOUT_SECONDS=2,
                               OUTBOX_IDLE_INTERVAL_SECONDS=0.05, OUTBOX_RETRY_INTERVAL_SECONDS=1)
    monkeypatch.setattr(main, "get_order_api_settings", lambda: settings)
    initialize, seed, dispose = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(main, "init_db", initialize)
    monkeypatch.setattr(main, "seed_inventory", seed)
    monkeypatch.setattr(main, "close_db", dispose)
    monkeypatch.setattr(main, "get_session_factory", MagicMock())
    channel = AsyncMock()
    connection = AsyncMock()
    connection.channel.return_value = channel
    monkeypatch.setattr(main.aio_pika, "connect_robust", AsyncMock(return_value=connection))
    stopped = asyncio.Event()

    async def run(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(main, "outbox_relay", run)
    application = SimpleNamespace(state=SimpleNamespace())
    async with main.lifespan(application):
        await asyncio.sleep(0)
        assert application.state.ready
        assert not application.state.outbox_task.done()
    assert not application.state.ready
    assert stopped.is_set()
    channel.declare_queue.assert_awaited_once_with(relay.QUEUE_NAME, durable=True)
    connection.channel.assert_awaited_once_with(publisher_confirms=True, on_return_raises=True)
    channel.close.assert_awaited_once()
    connection.close.assert_awaited_once()
    dispose.assert_awaited_once()


@pytest.mark.asyncio
async def test_startup_failure_disposes_database(monkeypatch):
    monkeypatch.setattr(main, "get_order_api_settings", lambda: SimpleNamespace(LOG_LEVEL="INFO"))
    monkeypatch.setattr(main, "init_db", AsyncMock(side_effect=ConnectionError()))
    dispose = AsyncMock()
    monkeypatch.setattr(main, "close_db", dispose)
    application = SimpleNamespace(state=SimpleNamespace())
    with pytest.raises(ConnectionError):
        async with main.lifespan(application):
            pytest.fail("startup must not succeed")
    dispose.assert_awaited_once()
