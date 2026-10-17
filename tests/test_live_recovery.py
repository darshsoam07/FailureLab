"""Opt-in real infrastructure regressions; no application data is retained."""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import aio_pika
import pytest
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from services.common.consumer import ConsumerSupervisor
from services.common.models import Order, OrderStatus
from services.order_api.main import metrics_summary

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(
    os.environ.get('FAILURELAB_INTEGRATION_TESTS') != '1', reason='Set FAILURELAB_INTEGRATION_TESTS=1 with local DB/broker DSNs')]


async def wait_until(predicate):
    async with asyncio.timeout(15):
        while not predicate():
            await asyncio.sleep(.02)


async def test_real_broker_recovers_repeated_transport_loss_without_orphan_consumers():
    name = 'failurelab-regression-' + uuid4().hex
    received = []
    async def handle(message):
        received.append(message.body)
        await message.ack()
    publisher = await aio_pika.connect_robust(os.environ['RABBITMQ_URL'])
    channel = await publisher.channel()
    queue = await channel.declare_queue(name, durable=True)
    supervisor = ConsumerSupervisor(os.environ['RABBITMQ_URL'], name, handle,
                                    prefetch=2, retry_delay=.1, timeout=5)
    task = asyncio.create_task(supervisor.run())
    try:
        for generation in range(1, 5):
            await wait_until(lambda: supervisor.generations == generation and supervisor.healthy)
            probe = await channel.declare_queue(name, passive=True)
            assert probe.declaration_result.consumer_count == 1
            await channel.default_exchange.publish(aio_pika.Message(str(generation).encode()), routing_key=name)
            await wait_until(lambda: len(received) == generation)
            if generation < 4:
                # Close the actual AMQP transport (not the supervisor/process),
                # exercising the same close callbacks as network interruption.
                await supervisor.connection.transport.connection.close()
        assert received == [b'1', b'2', b'3', b'4']
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        probe = await channel.declare_queue(name, passive=True)
        assert probe.declaration_result.consumer_count == 0
        await queue.delete()
        await publisher.close()


async def test_real_postgres_since_excludes_cold_orders_even_if_completed_later():
    engine = create_async_engine(os.environ['DATABASE_URL'])
    try:
        async with engine.begin() as connection:
            # PostgreSQL resolves this temporary table ahead of public.orders.
            await connection.execute(text('CREATE TEMP TABLE orders (LIKE public.orders INCLUDING DEFAULTS) ON COMMIT DROP'))
            async with AsyncSession(bind=connection) as session:
                since = datetime.now(timezone.utc) - timedelta(seconds=5)
                for created, latency in [(since - timedelta(seconds=10), 9000),
                                         (since + timedelta(seconds=1), 100)]:
                    await session.execute(insert(Order).values(id=uuid4(), customer_id='test', sku='test',
                        quantity=1, status=OrderStatus.RESERVED, latency_ms=latency, created_at=created))
                warm = await metrics_summary(session, since=since)
                assert warm.total_orders == warm.succeeded == 1
                assert warm.p95_latency_ms == 100
                unfiltered = await metrics_summary(session)
                assert unfiltered.total_orders == 2 and unfiltered.p95_latency_ms > 8000
    finally:
        await engine.dispose()
