"""Confirmed, at-least-once delivery of transactional outbox events.

A crash after publish but before commit can cause redelivery. Consumers must
deduplicate using message_id (event UUID) or the payload's order_id.
"""

import asyncio
import json
import logging

import aio_pika
from aio_pika.abc import AbstractRobustChannel
from pamqp.commands import Basic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from services.common.models import OutboxEvent

logger = logging.getLogger(__name__)
QUEUE_NAME = "order_fulfillment_queue"
BATCH_SIZE = 50
POLL_INTERVAL_SECONDS = 0.05


async def publish_batch(
    session_factory: async_sessionmaker[AsyncSession],
    channel: AbstractRobustChannel,
    *,
    publish_timeout: float,
    batch_timeout: float,
) -> int:
    """Lock one batch until confirmed publishes and its DB commit complete.

Any failure rolls back the entire batch. Previously confirmed messages in a
failed batch may be published again; no failed message is marked processed.
The outer deadline also bounds waiting for broker recovery and database locks.
"""
    async with asyncio.timeout(batch_timeout):
        await channel.ready()
        async with session_factory() as session:
            async with session.begin():
                events = (
                    await session.scalars(
                        select(OutboxEvent)
                        .where(OutboxEvent.processed.is_(False))
                        .order_by(OutboxEvent.created_at, OutboxEvent.id)
                        .limit(BATCH_SIZE)
                        .with_for_update(skip_locked=True)
                    )
                ).all()
                for event in events:
                    message = aio_pika.Message(
                        body=json.dumps(event.payload, allow_nan=False).encode("utf-8"),
                        content_type="application/json",
                        content_encoding="utf-8",
                        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                        message_id=str(event.id),
                        correlation_id=str(event.aggregate_id),
                        type=event.event_type,
                        timestamp=event.created_at,
                    )
                    confirmation = await channel.default_exchange.publish(
                        message,
                        routing_key=QUEUE_NAME,
                        mandatory=True,
                        timeout=publish_timeout,
                    )
                    if not isinstance(confirmation, Basic.Ack):
                        raise RuntimeError("RabbitMQ did not acknowledge the outbox event")
                    event.processed = True
            return len(events)


async def outbox_relay(
    session_factory: async_sessionmaker[AsyncSession],
    channel: AbstractRobustChannel,
    *,
    publish_timeout: float,
    batch_timeout: float,
    idle_interval: float = POLL_INTERVAL_SECONDS,
    retry_interval: float = 1.0,
) -> None:
    """Drain available batches immediately; short idle poll and bounded error retry."""
    while True:
        try:
            count = await publish_batch(
                session_factory,
                channel,
                publish_timeout=publish_timeout,
                batch_timeout=batch_timeout,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Avoid logging payloads, connection URLs, or SQL bind parameters.
            logger.warning("Outbox batch failed (%s); retrying", type(exc).__name__)
            await asyncio.sleep(retry_interval)
        else:
            await asyncio.sleep(0 if count else idle_interval)
