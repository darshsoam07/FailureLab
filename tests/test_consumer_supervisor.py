import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from services.common import consumer


def connection():
    queue = SimpleNamespace(consume=AsyncMock(return_value='tag'),
                            declaration_result=SimpleNamespace(consumer_count=1))
    channel = SimpleNamespace(is_closed=False, close_callbacks=set(), set_qos=AsyncMock(),
                              declare_queue=AsyncMock(return_value=queue))
    connected = asyncio.Event()
    connected.set()
    conn = SimpleNamespace(is_closed=False, connected=connected, close_callbacks=set(),
                           channel=AsyncMock(return_value=channel))
    async def close():
        conn.is_closed = True
        connected.clear()
        channel.is_closed = True
        for callback in conn.close_callbacks:
            callback(conn, None)
    conn.close = AsyncMock(side_effect=close)
    return conn, channel, queue


async def wait_until(predicate):
    async with asyncio.timeout(2):
        while not predicate():
            await asyncio.sleep(.001)


@pytest.mark.asyncio
async def test_disconnect_replaces_entire_generation_without_restoring_old_consumers(monkeypatch):
    generations = [connection() for _ in range(4)]
    connect = AsyncMock(side_effect=[row[0] for row in generations])
    monkeypatch.setattr(consumer.aio_pika, 'connect_robust', connect)
    supervisor = consumer.ConsumerSupervisor('amqp://test', 'jobs', AsyncMock(), prefetch=5, retry_delay=.001)
    task = asyncio.create_task(supervisor.run())
    try:
        for index, (conn, channel, queue) in enumerate(generations):
            await wait_until(lambda: supervisor.generations == index + 1)
            assert supervisor.healthy
            channel.declare_queue.assert_awaited_once_with('jobs', durable=True, robust=False)
            assert queue.consume.call_args.kwargs['robust'] is False
            if index:
                assert generations[index - 1][0].is_closed
            if index < len(generations) - 1:
                for callback in channel.close_callbacks:
                    callback(channel, ConnectionError())
                assert not supervisor.healthy
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert all(row[0].is_closed for row in generations)
    assert not supervisor.healthy and not supervisor._handlers


@pytest.mark.asyncio
async def test_handler_failure_and_initial_connect_failure_are_supervised(monkeypatch):
    first, _, queue = connection()
    second, _, _ = connection()
    monkeypatch.setattr(consumer.aio_pika, 'connect_robust', AsyncMock(side_effect=[ConnectionError(), first, second]))
    supervisor = consumer.ConsumerSupervisor('amqp://test', 'jobs', AsyncMock(side_effect=RuntimeError()), prefetch=1, retry_delay=.001)
    task = asyncio.create_task(supervisor.run())
    try:
        await wait_until(lambda: supervisor.generations == 1)
        await queue.consume.call_args.args[0](MagicMock())
        await wait_until(lambda: supervisor.generations == 2)
        assert first.is_closed and supervisor.healthy
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_closed_channel_and_missing_registration_are_unready():
    conn, channel, _ = connection()
    supervisor = consumer.ConsumerSupervisor('amqp://test', 'jobs', AsyncMock(), prefetch=1)
    supervisor.connection, supervisor.channel = conn, channel
    assert not await supervisor.probe()
    supervisor.active = True
    assert await supervisor.probe()
    channel.is_closed = True
    assert not await supervisor.probe()
    channel.is_closed = False
    channel.declare_queue.side_effect = ConnectionError()
    assert not await supervisor.probe() and not supervisor.healthy


@pytest.mark.asyncio
async def test_disconnect_cancels_inflight_work_before_transport_close(monkeypatch):
    conn, channel, queue = connection()
    rollback = asyncio.Event()
    entered = asyncio.Event()
    async def handler(message):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            assert not conn.is_closed
            rollback.set()
    monkeypatch.setattr(consumer.aio_pika, 'connect_robust', AsyncMock(return_value=conn))
    supervisor = consumer.ConsumerSupervisor('amqp://test', 'jobs', handler, prefetch=1)
    task = asyncio.create_task(supervisor.run())
    await wait_until(lambda: supervisor.healthy)
    delivery = asyncio.create_task(queue.consume.call_args.args[0](MagicMock()))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert rollback.is_set() and delivery.cancelled() and conn.is_closed
