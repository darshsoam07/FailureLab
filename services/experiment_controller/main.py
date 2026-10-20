"""FailureLab experiment control plane. Run via uvicorn with env bind settings."""

import asyncio
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from functools import lru_cache
from typing import Annotated, Literal
from uuid import UUID

import aio_pika
import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import AnyHttpUrl, Field, model_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from services.common.config import BaseAppSettings
from services.common.database import close_db, get_db_session, get_engine, get_session_factory, init_db
from services.common.models import AIReport, Experiment, ExperimentStatus, FaultType, TelemetrySnapshot
from services.common.schemas import AIReportResponse, ExperimentCreate, ExperimentResponse, Schema, TelemetrySnapshotResponse
from .toxiproxy_client import ToxiproxyClient, ToxiproxySettings
from .traffic_gen import TrafficGenerator, TrafficStatus, TrafficToggle
from .auth import init_auth_db, router as auth_router
from .watchdog import (
    ACTIVE, ANALYSIS_QUEUE, FULFILLMENT_QUEUE, CleanupFailed, ControllerBusy,
    ExperimentConflict, ExperimentController, ExperimentNotFound, ExperimentStartFailed,
)

logger = logging.getLogger(__name__)


class ControllerSettings(BaseAppSettings):
    ORDER_API_URL: AnyHttpUrl
    INVENTORY_API_URL: AnyHttpUrl
    CONTROLLER_HTTP_TIMEOUT_SECONDS: float = Field(default=2, gt=0, le=10, allow_inf_nan=False)
    CONTROLLER_LOCK_TIMEOUT_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    RABBITMQ_CONNECT_TIMEOUT_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    TRAFFIC_HTTP_TIMEOUT_SECONDS: float = Field(default=2, gt=0, le=10, allow_inf_nan=False)
    TRAFFIC_MAX_IN_FLIGHT: int = Field(default=25, ge=1, le=100)


@lru_cache
def get_controller_settings() -> ControllerSettings:
    return ControllerSettings()


class LatencyParameters(Schema):
    latency_ms: int = Field(ge=0, le=30000, strict=True)
    jitter_ms: int = Field(default=0, ge=0, le=30000, strict=True)


class TimeoutParameters(Schema):
    timeout_ms: int = Field(default=0, ge=0, le=30000, strict=True)


class ErrorParameters(Schema):
    mode: Literal["http_503", "reset_peer"] = "http_503"
    error_rate_percent: float = Field(gt=0, le=100)


class BandwidthParameters(Schema):
    rate_kbps: int = Field(ge=1, le=1000000, strict=True)


PARAMETERS = {
    FaultType.LATENCY: LatencyParameters, FaultType.TIMEOUT: TimeoutParameters,
    FaultType.ERROR_RATE: ErrorParameters, FaultType.BANDWIDTH: BandwidthParameters,
}


class ExperimentStart(ExperimentCreate):
    target_service: Literal["inventory_service"] = "inventory_service"
    duration_seconds: int = Field(default=60, ge=1, le=3600, strict=True)

    @model_validator(mode="after")
    def validate_parameters(self) -> "ExperimentStart":
        self.parameters = PARAMETERS[self.fault_type].model_validate(self.parameters).model_dump()
        return self


class ExperimentDetail(ExperimentResponse):
    telemetry_snapshots: list[TelemetrySnapshotResponse]
    ai_report: AIReportResponse | None


async def stop_task(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("Controller task stopped (%s)", type(exc).__name__)


async def shutdown_cleanup(controller: ExperimentController) -> None:
    try:
        async with controller.exclusive(wait=True):
            async with controller.sessions() as session:
                experiment = await session.scalar(select(Experiment).where(Experiment.status.in_(ACTIVE)).limit(1))
            if experiment is not None:
                intent = experiment.parameters.get("_controller", {})
                await controller._finish(
                    experiment.id, ExperimentStatus(intent.get("finish_status", "COMPLETED")),
                    intent.get("finish_reason", "CONTROLLER_SHUTDOWN"),
                )
    except Exception:
        logger.error("Shutdown cleanup not confirmed; persisted intent will be recovered on restart")
        try:
            await controller.clear_faults()
        except Exception:
            logger.error("Emergency shutdown fault removal could not be confirmed")


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_controller_settings()
    logging.basicConfig(level=settings.LOG_LEVEL)
    application.state.ready = False
    async with AsyncExitStack() as resources:
        resources.push_async_callback(close_db)
        await init_db()
        await init_auth_db()
        http = await resources.enter_async_context(httpx.AsyncClient(
            timeout=settings.CONTROLLER_HTTP_TIMEOUT_SECONDS, trust_env=False,
        ))
        toxiproxy = ToxiproxyClient(http, ToxiproxySettings())
        async with asyncio.timeout(settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS):
            connection = await aio_pika.connect_robust(
                str(settings.RABBITMQ_URL), timeout=settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS
            )
        resources.push_async_callback(connection.close)
        async with asyncio.timeout(settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS):
            channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
            resources.push_async_callback(channel.close)
            await channel.declare_queue(ANALYSIS_QUEUE, durable=True)
            await channel.declare_queue(FULFILLMENT_QUEUE, durable=True)
        controller = ExperimentController(
            get_engine(), get_session_factory(), http, toxiproxy, channel,
            order_api_url=str(settings.ORDER_API_URL), inventory_api_url=str(settings.INVENTORY_API_URL),
            timeout_seconds=settings.CONTROLLER_HTTP_TIMEOUT_SECONDS,
            lock_timeout_seconds=settings.CONTROLLER_LOCK_TIMEOUT_SECONDS,
        )
        resources.push_async_callback(shutdown_cleanup, controller)
        # Proxy creation is retried at start; readiness reports actual availability.
        # Do not modify an already-running experiment just because a replica boots.
        application.state.controller = controller
        application.state.rabbitmq_connection = connection
        tasks = [asyncio.create_task(controller.run_watchdog(), name="experiment-watchdog"),
                 asyncio.create_task(controller.run_notifier(), name="experiment-notifier")]
        for task in tasks:
            resources.push_async_callback(stop_task, task)
        application.state.tasks = tasks
        traffic_http = await resources.enter_async_context(httpx.AsyncClient(
            timeout=settings.TRAFFIC_HTTP_TIMEOUT_SECONDS, trust_env=False,
            limits=httpx.Limits(max_connections=settings.TRAFFIC_MAX_IN_FLIGHT),
        ))
        application.state.traffic = TrafficGenerator(
            traffic_http, str(settings.ORDER_API_URL),
            timeout_seconds=settings.TRAFFIC_HTTP_TIMEOUT_SECONDS,
            max_in_flight=settings.TRAFFIC_MAX_IN_FLIGHT,
        )
        resources.push_async_callback(application.state.traffic.close)
        application.state.ready = True
        try:
            yield
        finally:
            application.state.ready = False


app = FastAPI(title="FailureLab Experiment Controller", lifespan=lifespan)
app.include_router(auth_router)
DBSession = Annotated[AsyncSession, Depends(get_db_session)]


def controller(request: Request) -> ExperimentController:
    value = getattr(request.app.state, "controller", None)
    if value is None:
        raise HTTPException(503, "Controller is not initialized")
    return value


Control = Annotated[ExperimentController, Depends(controller)]


def traffic_generator(request: Request) -> TrafficGenerator:
    value = getattr(request.app.state, "traffic", None)
    if value is None or not getattr(request.app.state, "ready", False):
        raise HTTPException(503, "Traffic generator is not initialized")
    return value


Traffic = Annotated[TrafficGenerator, Depends(traffic_generator)]


@app.post("/api/traffic/toggle", response_model=TrafficStatus)
async def toggle_traffic(body: TrafficToggle, traffic: Traffic) -> TrafficStatus:
    return await traffic.configure(body)


@app.get("/api/traffic/status", response_model=TrafficStatus)
async def traffic_status(traffic: Traffic) -> TrafficStatus:
    return traffic.status()


@app.exception_handler(ControllerBusy)
async def busy_handler(request: Request, exc: ControllerBusy):
    return JSONResponse(status_code=409, content={"detail": "Another experiment transition is in progress"})


@app.exception_handler(ExperimentConflict)
async def conflict_handler(request: Request, exc: ExperimentConflict):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(ExperimentNotFound)
async def not_found_handler(request: Request, exc: ExperimentNotFound):
    return JSONResponse(status_code=404, content={"detail": "Experiment not found"})


@app.exception_handler(CleanupFailed)
async def cleanup_handler(request: Request, exc: CleanupFailed):
    return JSONResponse(status_code=503, content={"detail": "Cleanup unconfirmed; experiment remains active and cleanup will retry"})


@app.exception_handler(ExperimentStartFailed)
async def start_failure_handler(request: Request, exc: ExperimentStartFailed):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.get("/api/experiments/catalog")
async def catalog() -> dict:
    return {
        "target_service": "inventory_service",
        "duration_seconds": {"default": 60, "minimum": 1, "maximum": 3600},
        "experiments": [{"fault_type": kind.value, "parameters_schema": schema.model_json_schema()}
                        for kind, schema in PARAMETERS.items()],
    }


@app.post("/api/experiments/start", response_model=ExperimentResponse, status_code=201)
async def start_experiment(body: ExperimentStart, control: Control) -> ExperimentResponse:
    values = body.model_dump(exclude={"duration_seconds"})
    values["parameters"] = {**body.parameters, "duration_seconds": body.duration_seconds}
    return ExperimentResponse.model_validate(await control.start(values))


@app.post("/api/experiments/{id}/stop", response_model=ExperimentResponse)
async def stop_experiment(id: UUID, control: Control) -> ExperimentResponse:
    return ExperimentResponse.model_validate(await control.stop(id))


@app.get("/api/experiments", response_model=list[ExperimentResponse])
async def list_experiments(session: DBSession, limit: Annotated[int, Query(ge=1, le=100)] = 50,
                           offset: Annotated[int, Query(ge=0)] = 0):
    rows = (await session.scalars(
        select(Experiment).order_by(Experiment.started_at.desc().nulls_last(), Experiment.id.desc())
        .limit(limit).offset(offset)
    )).all()
    return [ExperimentResponse.model_validate(row) for row in rows]


@app.get("/api/experiments/{id}", response_model=ExperimentDetail)
async def get_experiment(id: UUID, session: DBSession) -> ExperimentDetail:
    experiment = await session.get(Experiment, id)
    if experiment is None:
        raise HTTPException(404, "Experiment not found")
    snapshots = (await session.scalars(
        select(TelemetrySnapshot).where(TelemetrySnapshot.experiment_id == id)
        .order_by(TelemetrySnapshot.timestamp, TelemetrySnapshot.id)
    )).all()
    report = await session.scalar(
        select(AIReport).where(AIReport.experiment_id == id)
        .order_by(AIReport.created_at.desc(), AIReport.id.desc()).limit(1)
    )
    return ExperimentDetail(
        **ExperimentResponse.model_validate(experiment).model_dump(),
        telemetry_snapshots=[TelemetrySnapshotResponse.model_validate(row) for row in snapshots],
        ai_report=AIReportResponse.model_validate(report) if report else None,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    state = request.app.state
    if not getattr(state, "ready", False):
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    control = state.controller
    db_ok = broker_ok = False
    try:
        async with asyncio.timeout(control.timeout_seconds):
            async with control.sessions() as session:
                await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass
    try:
        if not state.rabbitmq_connection.is_closed and state.rabbitmq_connection.connected.is_set():
            async with asyncio.timeout(control.timeout_seconds):
                await control.channel.ready()
                await control.channel.declare_queue(ANALYSIS_QUEUE, passive=True, durable=True, robust=False)
            broker_ok = True
    except Exception:
        pass
    checks = {"database": db_ok, "rabbitmq": broker_ok,
              "toxiproxy": await control.toxiproxy.healthy(),
              "background_tasks": all(not task.done() for task in state.tasks),
              "safety_engine": control.safety_healthy}
    return JSONResponse(status_code=200 if all(checks.values()) else 503, content={
        "status": "ready" if all(checks.values()) else "not_ready", "checks": checks,
        "toxiproxy_mode": "simulated" if control.toxiproxy.simulated else "real",
    })
