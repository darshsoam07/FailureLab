"""Order ingress, telemetry, and transactional outbox lifecycle.

Run from the repository root with ``uvicorn services.order_api.main:app`` and
set UVICORN_HOST / UVICORN_PORT in the environment. Connection configuration
comes from BaseAppSettings; no service address is embedded here.
"""

import asyncio
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import timedelta
from functools import lru_cache
from typing import Annotated

import aio_pika
from fastapi import Depends, FastAPI, Query, Request, status
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, Field
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from services.common.config import BaseAppSettings
from services.common.database import (
    close_db,
    get_db_session,
    get_session_factory,
    init_db,
)
from services.common.models import InventoryItem, Order, OrderStatus, OutboxEvent
from services.common.schemas import OrderCreate, OrderResponse, Schema
from services.order_api.outbox_relay import QUEUE_NAME, outbox_relay

logger = logging.getLogger(__name__)


class OrderAPISettings(BaseAppSettings):
    RABBITMQ_CONNECT_TIMEOUT_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    OUTBOX_PUBLISH_TIMEOUT_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    OUTBOX_BATCH_TIMEOUT_SECONDS: float = Field(default=30, gt=0, allow_inf_nan=False)
    OUTBOX_IDLE_INTERVAL_SECONDS: float = Field(default=0.05, gt=0, le=1)
    OUTBOX_RETRY_INTERVAL_SECONDS: float = Field(default=1, gt=0)
    READINESS_TIMEOUT_SECONDS: float = Field(default=5, gt=0, allow_inf_nan=False)


@lru_cache
def get_order_api_settings() -> OrderAPISettings:
    return OrderAPISettings()


class MetricsSummary(Schema):
    total_orders: int = Field(ge=0)
    succeeded: int = Field(ge=0)
    failed: int = Field(ge=0)
    error_rate: float = Field(ge=0, le=1)
    p95_latency_ms: float = Field(ge=0)
    pending_count: int = Field(ge=0)


async def seed_inventory() -> None:
    """Concurrent startups are safe and never overwrite existing inventory."""
    async with get_session_factory()() as session:
        async with session.begin():
            await session.execute(
                insert(InventoryItem)
                .values([
                    {"sku": sku, "available_qty": 10000}
                    for sku in ("SKU-LAPTOP", "SKU-PHONE", "SKU-SERVER")
                ])
                .on_conflict_do_nothing(index_elements=[InventoryItem.sku])
            )


async def stop_relay(task: asyncio.Task[None]) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("Outbox relay terminated (%s)", type(exc).__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_order_api_settings()
    logging.basicConfig(level=settings.LOG_LEVEL)
    application.state.ready = False
    # LIFO cleanup also runs if initialization fails partway through.
    async with AsyncExitStack() as resources:
        resources.push_async_callback(close_db)
        await init_db()
        await seed_inventory()
        async with asyncio.timeout(settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS):
            connection = await aio_pika.connect_robust(
                str(settings.RABBITMQ_URL),
                timeout=settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS,
            )
        resources.push_async_callback(connection.close)
        async with asyncio.timeout(settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS):
            channel = await connection.channel(
                publisher_confirms=True, on_return_raises=True
            )
            resources.push_async_callback(channel.close)
            await channel.declare_queue(QUEUE_NAME, durable=True)
        application.state.rabbitmq_connection = connection
        application.state.rabbitmq_channel = channel
        task = asyncio.create_task(
            outbox_relay(
                get_session_factory(),
                channel,
                publish_timeout=settings.OUTBOX_PUBLISH_TIMEOUT_SECONDS,
                batch_timeout=settings.OUTBOX_BATCH_TIMEOUT_SECONDS,
                idle_interval=settings.OUTBOX_IDLE_INTERVAL_SECONDS,
                retry_interval=settings.OUTBOX_RETRY_INTERVAL_SECONDS,
            ),
            name="order-api-outbox-relay",
        )
        resources.push_async_callback(stop_relay, task)
        application.state.outbox_task = task
        application.state.ready = True
        try:
            yield
        finally:
            application.state.ready = False


app = FastAPI(title="FailureLab Order API", lifespan=lifespan)
DBSession = Annotated[AsyncSession, Depends(get_db_session)]


@app.post("/api/orders", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(body: OrderCreate, session: DBSession) -> OrderResponse:
    """Accept an order atomically with its fulfillment event; fulfillment is async."""
    async with session.begin():
        order = Order(**body.model_dump(), status=OrderStatus.PENDING)
        session.add(order)
        # Populate UUID/timestamp defaults and satisfy the outbox aggregate FK.
        await session.flush()
        session.add(OutboxEvent(
            aggregate_id=order.id,
            event_type="OrderCreated",
            payload={"order_id": str(order.id), **body.model_dump(mode="json")},
        ))
        await session.flush()
        response = OrderResponse.model_validate(order)
    return response


@app.get("/api/orders/metrics-summary", response_model=MetricsSummary)
async def metrics_summary(session: DBSession, since: Annotated[AwareDatetime | None, Query()] = None,
                          window_seconds: Annotated[int, Query(ge=1, le=3600)] = 60) -> MetricsSummary:
    """Last 60 seconds by created_at; error_rate=failed/total (zero if empty).

P95 includes RESERVED and FAILED orders only, since pending latency is not yet
measured. Pending orders are exposed separately; no completed orders yields 0.
"""
    finished = Order.status.in_((OrderStatus.RESERVED, OrderStatus.FAILED))
    statement = select(
        func.count(Order.id).label("total_orders"),
        func.count(Order.id).filter(Order.status == OrderStatus.RESERVED).label("succeeded"),
        func.count(Order.id).filter(Order.status == OrderStatus.FAILED).label("failed"),
        func.count(Order.id).filter(Order.status == OrderStatus.PENDING).label("pending_count"),
        func.coalesce(
            func.percentile_cont(0.95).within_group(Order.latency_ms).filter(finished),
            0.0,
        ).label("p95_latency_ms"),
    ).where(
        Order.created_at >= func.now() - timedelta(seconds=window_seconds),
        Order.created_at <= func.now(),
    )
    if since is not None:
        statement = statement.where(Order.created_at >= since)
    row = (await session.execute(statement)).mappings().one()
    return MetricsSummary(
        **row,
        error_rate=row["failed"] / row["total_orders"] if row["total_orders"] else 0.0,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready", responses={503: {"description": "A dependency is unavailable"}})
async def ready(request: Request) -> JSONResponse:
    if not getattr(request.app.state, "ready", False):
        return JSONResponse(status_code=503, content={"status": "not_ready"})

    timeout = get_order_api_settings().READINESS_TIMEOUT_SECONDS
    connection = request.app.state.rabbitmq_connection
    channel = request.app.state.rabbitmq_channel

    async def database_ready() -> bool:
        try:
            async with asyncio.timeout(timeout):
                async with get_session_factory()() as session:
                    await session.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    async def rabbitmq_ready() -> bool:
        if connection.is_closed or not connection.connected.is_set() or channel.is_closed:
            return False
        try:
            async with asyncio.timeout(timeout):
                await channel.ready()
                # Active round-trip on a separate channel cannot disrupt publishing.
                async with connection.channel(publisher_confirms=False) as probe:
                    await probe.declare_queue(
                        QUEUE_NAME, passive=True, durable=True, robust=False, timeout=timeout
                    )
            return True
        except Exception:
            return False

    db_ok, rabbit_ok = await asyncio.gather(database_ready(), rabbitmq_ready())
    relay_ok = not request.app.state.outbox_task.done()
    checks = {"database": db_ok, "rabbitmq": rabbit_ok, "outbox_relay": relay_ok}
    is_ready = all(checks.values())
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "not_ready", "checks": checks},
    )
