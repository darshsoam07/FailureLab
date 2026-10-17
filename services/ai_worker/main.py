"""Consume experiment_finished events and persist one report per experiment."""

import asyncio
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from functools import lru_cache
from typing import Literal
from uuid import UUID

import aio_pika
import httpx
from aio_pika.abc import AbstractIncomingMessage
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, Field, ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from services.common.config import BaseAppSettings
from services.common.consumer import ConsumerSupervisor
from services.common.database import close_db, get_session_factory, init_db
from services.common.models import AIReport, Experiment, ExperimentStatus, TelemetrySnapshot
from services.common.schemas import AIReportCreate, Schema
from .analyzer import AnalysisSettings, analyze_experiment, get_analysis_settings

logger = logging.getLogger(__name__)
ANALYSIS_QUEUE = "ai_analysis_queue"
TERMINAL = (ExperimentStatus.COMPLETED, ExperimentStatus.ABORTED_SLO_BREACH)


class AIWorkerSettings(BaseAppSettings):
    RABBITMQ_CONNECT_TIMEOUT_SECONDS: float = Field(default=10, gt=0, allow_inf_nan=False)
    RABBITMQ_HEARTBEAT_SECONDS: int = Field(default=10, ge=1, le=60)
    READINESS_TIMEOUT_SECONDS: float = Field(default=5, gt=0, allow_inf_nan=False)
    AI_JOB_TIMEOUT_SECONDS: float = Field(default=60, gt=0, allow_inf_nan=False)
    AI_REQUEUE_DELAY_SECONDS: float = Field(default=1, gt=0, allow_inf_nan=False)
    AI_PREFETCH_COUNT: int = Field(default=1, ge=1, le=100)
    AI_MAX_MESSAGE_BYTES: int = Field(default=65536, ge=1024, le=1048576)


@lru_cache
def get_worker_settings() -> AIWorkerSettings:
    return AIWorkerSettings()


class ExperimentFinishedEvent(Schema):
    event_type: Literal["experiment_finished"]
    experiment_id: UUID
    # The controller emits these fields; PostgreSQL remains authoritative.
    status: Literal["COMPLETED", "ABORTED_SLO_BREACH"] | None = None
    abort_reason: str | None = None
    ended_at: AwareDatetime | None = None


class ExperimentNotFinished(Exception):
    """Delay a premature event until its experiment is terminal."""


class AIAnalysisWorker:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], analysis_settings: AnalysisSettings,
                 *, client: httpx.AsyncClient | None = None, job_timeout: float = 60,
                 requeue_delay: float = 1, max_message_bytes: int = 65536):
        self.sessions = sessions
        self.analysis_settings = analysis_settings
        self.client = client
        self.job_timeout = job_timeout
        self.requeue_delay = requeue_delay
        self.max_message_bytes = max_message_bytes

    async def process_message(self, message: AbstractIncomingMessage) -> None:
        if len(message.body) > self.max_message_bytes:
            await message.reject(requeue=False)
            logger.warning("Rejected oversized analysis event")
            return
        try:
            event = ExperimentFinishedEvent.model_validate_json(message.body)
        except ValidationError:
            await message.reject(requeue=False)
            logger.warning("Rejected malformed analysis event")
            return
        try:
            missing = False
            async with asyncio.timeout(self.job_timeout):
                async with self.sessions() as session, session.begin():
                    # Serialize report creation across workers. No schema changes:
                    # all worker writers lock the parent before checking/inserting.
                    experiment = await session.scalar(
                        select(Experiment).where(Experiment.id == event.experiment_id).with_for_update()
                    )
                    if experiment is None:
                        missing = True
                    elif experiment.status not in TERMINAL:
                        raise ExperimentNotFinished()
                    else:
                        existing = await session.scalar(
                            select(AIReport.id).where(AIReport.experiment_id == experiment.id).limit(1)
                        )
                        if existing is None:
                            snapshots = (await session.scalars(
                                select(TelemetrySnapshot)
                                .where(TelemetrySnapshot.experiment_id == experiment.id)
                                .order_by(TelemetrySnapshot.timestamp, TelemetrySnapshot.id)
                            )).all()
                            analysis = await analyze_experiment(
                                experiment, snapshots, settings=self.analysis_settings, client=self.client,
                            )
                            report = AIReportCreate(experiment_id=experiment.id, **analysis.model_dump())
                            session.add(AIReport(**report.model_dump()))
                            await session.flush()
            # Broker ACK is strictly after transaction commit, including replays.
            if missing:
                await message.reject(requeue=False)
                logger.warning("Rejected event for missing/deleted experiment")
            else:
                await message.ack()
        except asyncio.CancelledError:
            # Roll back; closing the channel will redeliver the unacknowledged job.
            raise
        except Exception as exc:
            logger.warning("Analysis job not committed (%s); requeuing", type(exc).__name__)
            if not message.processed:
                await asyncio.sleep(self.requeue_delay)
                await message.nack(requeue=True)



async def stop_consumer(task: asyncio.Task[None]) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("Analysis consumer terminated (%s)", type(exc).__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    settings = get_worker_settings()
    analysis_settings = get_analysis_settings()
    if not analysis_settings.USE_MOCK_AI and settings.AI_JOB_TIMEOUT_SECONDS <= analysis_settings.LLM_TIMEOUT_SECONDS:
        raise ValueError("AI_JOB_TIMEOUT_SECONDS must exceed LLM_TIMEOUT_SECONDS for fallback and commit")
    logging.basicConfig(level=settings.LOG_LEVEL)
    application.state.ready = False
    async with AsyncExitStack() as resources:
        resources.push_async_callback(close_db)
        await init_db()
        client = None
        if not analysis_settings.USE_MOCK_AI:
            client = await resources.enter_async_context(httpx.AsyncClient(
                timeout=analysis_settings.LLM_TIMEOUT_SECONDS, trust_env=False,
            ))
        worker = AIAnalysisWorker(
            get_session_factory(), analysis_settings, client=client,
            job_timeout=settings.AI_JOB_TIMEOUT_SECONDS, requeue_delay=settings.AI_REQUEUE_DELAY_SECONDS,
            max_message_bytes=settings.AI_MAX_MESSAGE_BYTES,
        )
        supervisor = ConsumerSupervisor(
            str(settings.RABBITMQ_URL), ANALYSIS_QUEUE, worker.process_message,
            prefetch=settings.AI_PREFETCH_COUNT, timeout=settings.RABBITMQ_CONNECT_TIMEOUT_SECONDS,
            retry_delay=settings.AI_REQUEUE_DELAY_SECONDS, heartbeat=settings.RABBITMQ_HEARTBEAT_SECONDS,
        )
        task = asyncio.create_task(supervisor.run(), name="ai-analysis-consumer")
        resources.push_async_callback(stop_consumer, task)
        application.state.worker = worker
        application.state.consumer_task = task
        application.state.consumer_supervisor = supervisor
        application.state.ready = True
        try:
            yield
        finally:
            application.state.ready = False


app = FastAPI(title="FailureLab AI Analysis Worker", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    state = request.app.state
    if not getattr(state, "ready", False):
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    timeout = get_worker_settings().READINESS_TIMEOUT_SECONDS

    async def database_ready() -> bool:
        try:
            async with asyncio.timeout(timeout):
                async with state.worker.sessions() as session:
                    await session.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    async def broker_ready() -> bool:
        try:
            async with asyncio.timeout(timeout):
                return await state.consumer_supervisor.probe()
        except Exception:
            return False

    db_ok, broker_ok = await asyncio.gather(database_ready(), broker_ready())
    checks = {"database": db_ok, "rabbitmq": broker_ok, "consumer": not state.consumer_task.done() and state.consumer_supervisor.healthy,
              "http_client": state.worker.client is None or not state.worker.client.is_closed}
    healthy = all(checks.values())
    return JSONResponse(status_code=200 if healthy else 503, content={
        "status": "ready" if healthy else "not_ready", "checks": checks,
        "analysis_mode": "deterministic" if state.worker.analysis_settings.USE_MOCK_AI else "live_with_fallback",
    })
