"""Run with ``python -m services.fulfillment_worker.worker``.

Set WORKER_HOST and WORKER_PORT (8002 for the FailureLab worker) in the
environment, along with the shared connection settings. One consumer runs per
process; multiple processes coordinate through PostgreSQL order row locks.
"""

import asyncio
import logging
import time
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from functools import lru_cache
from uuid import UUID

import aio_pika
import httpx
from aio_pika.abc import AbstractIncomingMessage
from fastapi import Depends, FastAPI, Request
from services.common.authorization import authorize
from fastapi.responses import JSONResponse
from pydantic import Field, ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from services.common.config import BaseAppSettings
from services.common.consumer import ConsumerSupervisor
from services.common.database import close_db, get_session_factory, init_db
from services.common.models import Order, OrderStatus
from services.common.schemas import OrderCreate
from services.fulfillment_worker.resilience import (
    CircuitBreaker, CircuitBreakerOpen, InventoryClient, InventoryProtocolError, error_reason,
)

logger = logging.getLogger(__name__)
QUEUE_NAME = "order_fulfillment_queue"


class WorkerSettings(BaseAppSettings):
    WORKER_HOST: str = Field(min_length=1)
    WORKER_PORT: int = Field(ge=1, le=65535)
    HTTP_TIMEOUT_SECONDS: float = Field(default=1.5, gt=0, le=1.5, allow_inf_nan=False)
    HTTP_MAX_ATTEMPTS: int = Field(default=3, ge=1, le=3)
    RETRY_BACKOFF_MULTIPLIER_SECONDS: float = Field(default=0.1, gt=0, allow_inf_nan=False)
    RETRY_BACKOFF_MAX_SECONDS: float = Field(default=0.5, gt=0, allow_inf_nan=False)
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: int = Field(default=5, ge=1)
    CIRCUIT_BREAKER_RECOVERY_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    RABBITMQ_CONNECT_TIMEOUT_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    RABBITMQ_HEARTBEAT_SECONDS: int = Field(default=10, ge=1, le=60)
    READINESS_TIMEOUT_SECONDS: float = Field(default=5, gt=0, allow_inf_nan=False)
    WORKER_PREFETCH_COUNT: int = Field(default=1, ge=1, le=65535)
    WORKER_REQUEUE_DELAY_SECONDS: float = Field(default=1, gt=0, allow_inf_nan=False)


@lru_cache
def get_worker_settings() -> WorkerSettings:
    return WorkerSettings()


class FulfillmentEvent(OrderCreate):
    order_id: UUID


@dataclass
class WorkerStats:
    reserved: int = 0
    failed: int = 0
    duplicate_messages: int = 0
    rejected_messages: int = 0
    requeued_messages: int = 0


class FulfillmentWorker:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession],
                 inventory: InventoryClient, *, requeue_delay: float = 1):
        self.session_factory = session_factory
        self.inventory = inventory
        self.requeue_delay = requeue_delay
        self.stats = WorkerStats()

    async def process_message(self, message: AbstractIncomingMessage) -> None:
        started = time.perf_counter()
        received_at = datetime.now(timezone.utc)
        try:
            event = FulfillmentEvent.model_validate_json(message.body)
        except ValidationError:
            await message.reject(requeue=False)
            self.stats.rejected_messages += 1
            logger.warning("Rejected malformed fulfillment event")
            return

        try:
            outcome = "duplicate"
            async with self.session_factory() as session:
                async with session.begin():
                    order = await session.scalar(
                        select(Order).where(Order.id == event.order_id).with_for_update()
                    )
                    if order is None or (order.sku, order.quantity, order.customer_id) != (
                        event.sku, event.quantity, event.customer_id
                    ):
                        outcome = "reject"
                    elif order.status == OrderStatus.PENDING:
                        try:
                            await self.inventory.reserve(order.id, order.sku, order.quantity)
                        except (httpx.HTTPError, CircuitBreakerOpen, InventoryProtocolError) as exc:
                            order.status = OrderStatus.FAILED
                            order.error_reason = error_reason(exc)
                            outcome = "failed"
                        else:
                            order.status = OrderStatus.RESERVED
                            order.error_reason = None
                            outcome = "reserved"
                        # Include outbox/queue residence, then use a monotonic
                        # clock for execution so wall-clock adjustments cannot
                        # distort the in-process duration.
                        queue_ms = max(0, (received_at - order.created_at).total_seconds() * 1000)
                        order.latency_ms = queue_ms + (time.perf_counter() - started) * 1000
            # No ACK until PostgreSQL commits. Terminal orders short-circuit
            # duplicate deliveries without repeating HTTP calls or overwriting latency.
            if outcome == "reject":
                await message.reject(requeue=False)
                self.stats.rejected_messages += 1
                logger.warning("Rejected fulfillment event with missing/mismatched order")
            else:
                await message.ack()
                if outcome == "reserved":
                    self.stats.reserved += 1
                elif outcome == "failed":
                    self.stats.failed += 1
                else:
                    self.stats.duplicate_messages += 1
        except asyncio.CancelledError:
            # The DB transaction rolls back; channel closure redelivers the message.
            raise
        except Exception as exc:
            logger.warning("Fulfillment infrastructure failure (%s)", type(exc).__name__)
            if not message.processed:
                # Delay before releasing the delivery to avoid a DB-outage hot loop.
                await asyncio.sleep(self.requeue_delay)
                await message.nack(requeue=True)
                self.stats.requeued_messages += 1



async def stop_consumer(task: asyncio.Task[None]) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("Fulfillment consumer stopped (%s)", type(exc).__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_worker_settings()
    logging.basicConfig(level=settings.LOG_LEVEL)
    application.state.ready = False
    async with AsyncExitStack() as resources:
        resources.push_async_callback(close_db)
        await init_db()
        client = await resources.enter_async_context(httpx.AsyncClient(
            timeout=httpx.Timeout(settings.HTTP_TIMEOUT_SECONDS),
            trust_env=False,
        ))
        breaker = CircuitBreaker(
            settings.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            settings.CIRCUIT_BREAKER_RECOVERY_SECONDS,
        )
        inventory = InventoryClient(
            client, str(settings.INVENTORY_PROXY_URL), breaker,
            timeout_seconds=settings.HTTP_TIMEOUT_SECONDS,
            max_attempts=settings.HTTP_MAX_ATTEMPTS,
            backoff_multiplier=settings.RETRY_BACKOFF_MULTIPLIER_SECONDS,
            backoff_max=settings.RETRY_BACKOFF_MAX_SECONDS,
        )
        worker = FulfillmentWorker(
            get_session_factory(), inventory,
            requeue_delay=settings.WORKER_REQUEUE_DELAY_SECONDS,
        )
        supervisor = ConsumerSupervisor(
            str(settings.RABBITMQ_URL), QUEUE_NAME, worker.process_message,
            prefetch=settings.WORKER_PREFETCH_COUNT, timeout=settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS,
            retry_delay=settings.WORKER_REQUEUE_DELAY_SECONDS, heartbeat=settings.RABBITMQ_HEARTBEAT_SECONDS,
        )
        task = asyncio.create_task(supervisor.run(), name="fulfillment-consumer")
        resources.push_async_callback(stop_consumer, task)
        application.state.worker = worker
        application.state.consumer_task = task
        application.state.consumer_supervisor = supervisor
        application.state.ready = True
        try:
            yield
        finally:
            application.state.ready = False


app = FastAPI(title="FailureLab Fulfillment Worker", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/worker-stats", dependencies=[Depends(authorize)])
async def worker_stats(request: Request) -> JSONResponse:
    worker = getattr(request.app.state, "worker", None)
    if worker is None:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    breaker = await worker.inventory.breaker.snapshot()
    return JSONResponse(content={
        "circuit_breaker_state": breaker["state"],
        "circuit_breaker": breaker,
        **asdict(worker.inventory.stats),
        **asdict(worker.stats),
    })


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    state = request.app.state
    if not getattr(state, "ready", False):
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    timeout = get_worker_settings().READINESS_TIMEOUT_SECONDS

    async def database_ready() -> bool:
        try:
            async with asyncio.timeout(timeout):
                async with get_session_factory()() as session:
                    await session.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    async def rabbitmq_ready() -> bool:
        try:
            async with asyncio.timeout(timeout):
                return await state.consumer_supervisor.probe()
        except Exception:
            return False

    db_ok, rabbit_ok = await asyncio.gather(database_ready(), rabbitmq_ready())
    checks = {
        "database": db_ok, "rabbitmq": rabbit_ok,
        "consumer": not state.consumer_task.done() and state.consumer_supervisor.healthy,
        "http_client": not state.worker.inventory.client.is_closed,
    }
    healthy = all(checks.values())
    return JSONResponse(status_code=200 if healthy else 503, content={
        "status": "ready" if healthy else "not_ready", "checks": checks,
    })


if __name__ == "__main__":
    import uvicorn

    settings = get_worker_settings()
    uvicorn.run(app, host=settings.WORKER_HOST, port=settings.WORKER_PORT, log_level=settings.LOG_LEVEL.lower())
