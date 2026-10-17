"""Atomic inventory reservations and process-local experiment fault injection."""

import asyncio
import hashlib
import logging
import random
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from services.common.config import BaseAppSettings
from services.common.database import close_db, get_db_session, get_session_factory, init_db
from services.common.models import IdempotencyRecord, InventoryItem
from services.common.schemas import Identifier, PositiveInt, Schema


class InventorySettings(BaseAppSettings):
    READINESS_TIMEOUT_SECONDS: float = Field(default=5, gt=0, allow_inf_nan=False)


@lru_cache
def get_inventory_settings() -> InventorySettings:
    return InventorySettings()


class ReservationRequest(Schema):
    order_id: UUID
    sku: Identifier
    quantity: PositiveInt


class ReservationResponse(Schema):
    order_id: UUID
    status: Literal["RESERVED"] = "RESERVED"


class FaultConfig(Schema):
    error_rate_percent: float = Field(default=0, ge=0, le=100)


@asynccontextmanager
async def lifespan(application: FastAPI):
    logging.basicConfig(level=get_inventory_settings().LOG_LEVEL)
    application.state.ready = False
    application.state.fault_config = FaultConfig()
    try:
        await init_db()
        application.state.ready = True
        yield
    finally:
        application.state.ready = False
        await close_db()


app = FastAPI(title="FailureLab Inventory Service", lifespan=lifespan)
DBSession = Annotated[AsyncSession, Depends(get_db_session)]
IdempotencyKey = Annotated[str, Header(alias="X-Idempotency-Key", min_length=1, max_length=255, pattern=r"^\S+$")]


def cached_reservation(record: IdempotencyRecord, order_id: UUID) -> ReservationResponse:
    if record.order_id != order_id:
        raise HTTPException(409, "Idempotency key belongs to a different order")
    if record.response_status != 200:
        raise HTTPException(409, "Idempotency key does not contain a successful reservation")
    return ReservationResponse(order_id=record.order_id)


@app.post("/api/inventory/reserve", response_model=ReservationResponse)
async def reserve(
    body: ReservationRequest,
    request: Request,
    session: DBSession,
    idempotency_key: IdempotencyKey,
) -> ReservationResponse:
    async with session.begin():
        existing = await session.get(IdempotencyRecord, idempotency_key)
        if existing is not None:
            return cached_reservation(existing, body.order_id)

        # Transaction-scoped lock covers absent rows, unlike SELECT FOR UPDATE.
        # A hash collision only serializes unrelated requests; keys remain distinct.
        lock_id = int.from_bytes(
            hashlib.blake2b(idempotency_key.encode(), digest_size=8).digest(),
            byteorder="big", signed=True,
        )
        await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
        # READ COMMITTED sees a concurrent reservation committed while we waited.
        existing = await session.get(IdempotencyRecord, idempotency_key)
        if existing is not None:
            return cached_reservation(existing, body.order_id)

        fault_config = getattr(request.app.state, "fault_config", FaultConfig())
        if random.random() * 100 < fault_config.error_rate_percent:
            raise HTTPException(503, "Injected inventory failure")

        remaining = await session.scalar(
            update(InventoryItem)
            .where(InventoryItem.sku == body.sku, InventoryItem.available_qty >= body.quantity)
            .values(available_qty=InventoryItem.available_qty - body.quantity)
            .returning(InventoryItem.available_qty)
        )
        if remaining is None:
            if await session.get(InventoryItem, body.sku) is None:
                raise HTTPException(404, "Unknown SKU")
            raise HTTPException(409, "Insufficient inventory")
        session.add(IdempotencyRecord(
            idempotency_key=idempotency_key,
            order_id=body.order_id,
            response_status=200,
        ))
        await session.flush()
    return ReservationResponse(order_id=body.order_id)


@app.post("/api/inventory/fault-config", response_model=FaultConfig)
async def configure_fault(body: FaultConfig, request: Request) -> FaultConfig:
    """Internal experiment endpoint; applies to this process until changed/restarted."""
    request.app.state.fault_config = body
    return body


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    healthy = False
    if getattr(request.app.state, "ready", False):
        try:
            async with asyncio.timeout(get_inventory_settings().READINESS_TIMEOUT_SECONDS):
                async with get_session_factory()() as session:
                    await session.execute(text("SELECT 1"))
            healthy = True
        except Exception:
            pass
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ready" if healthy else "not_ready", "checks": {"database": healthy}},
    )
