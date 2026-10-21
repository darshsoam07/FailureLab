"""Durable experiment lifecycle, deterministic SLO checks, and event delivery."""

from services.common.authorization import internal_headers

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import aio_pika
import httpx
from aio_pika.abc import AbstractRobustChannel
from pamqp.commands import Basic
from pydantic import model_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.exc import SQLAlchemyError

from services.common.models import Experiment, ExperimentStatus, FaultType, TelemetrySnapshot
from services.common.schemas import NonnegativeFloat, NonnegativeInt, Rate, Schema
from .toxiproxy_client import ToxiproxyClient

logger = logging.getLogger(__name__)
ANALYSIS_QUEUE = "ai_analysis_queue"
FULFILLMENT_QUEUE = "order_fulfillment_queue"
CONTROL_LOCK = 721148320042
POLL_SECONDS = 2.0
ACTIVE = (ExperimentStatus.PLANNED, ExperimentStatus.RUNNING)


class ControllerBusy(Exception):
    pass


class ExperimentConflict(Exception):
    pass


class ExperimentNotFound(Exception):
    pass


class CleanupFailed(Exception):
    pass


class ExperimentStartFailed(Exception):
    pass


class OrderMetrics(Schema):
    total_orders: NonnegativeInt
    succeeded: NonnegativeInt
    failed: NonnegativeInt
    pending_count: NonnegativeInt
    error_rate: Rate
    p95_latency_ms: NonnegativeFloat

    @model_validator(mode="after")
    def consistent_counts(self) -> "OrderMetrics":
        if self.succeeded + self.failed + self.pending_count != self.total_orders:
            raise ValueError("Order metric counts do not sum to total_orders")
        expected = self.failed / self.total_orders if self.total_orders else 0.0
        if abs(self.error_rate - expected) > 1e-6:
            raise ValueError("Order error_rate does not match failed/total_orders")
        return self


def breach_reason(experiment: Experiment, snapshot: TelemetrySnapshot) -> str | None:
    breaches = []
    if snapshot.error_rate > experiment.slo_max_error_rate:
        breaches.append(f"error_rate={snapshot.error_rate!r} > slo_max_error_rate={experiment.slo_max_error_rate!r}")
    if snapshot.p95_latency_ms > experiment.slo_max_p95_ms:
        breaches.append(f"p95_latency_ms={snapshot.p95_latency_ms!r} > slo_max_p95_ms={experiment.slo_max_p95_ms!r}")
    return "; ".join(breaches) or None


def consecutive_breach_reason(experiment: Experiment, newest_first: list[TelemetrySnapshot]) -> str | None:
    """The OR predicate must hold for each of the last three snapshots."""
    recent = newest_first[:3]
    if len(recent) < 3:
        return None
    reasons = [breach_reason(experiment, snapshot) for snapshot in reversed(recent)]
    if not all(reasons):
        return None
    return "SLO breached for 3 consecutive snapshots: " + " | ".join(
        f"snapshot {index}: {reason}" for index, reason in enumerate(reasons, 1)
    )


def metadata(experiment: Experiment, **changes: Any) -> None:
    """Replace JSONB rather than mutating nested dictionaries invisibly."""
    experiment.parameters = {
        **experiment.parameters,
        "_controller": {**experiment.parameters.get("_controller", {}), **changes},
    }


class ExperimentController:
    def __init__(self, engine: AsyncEngine, sessions: async_sessionmaker[AsyncSession],
                 http: httpx.AsyncClient, toxiproxy: ToxiproxyClient,
                 channel: AbstractRobustChannel, *, order_api_url: str,
                 inventory_api_url: str, timeout_seconds: float = 2,
                 lock_timeout_seconds: float = 10):
        self.engine, self.sessions = engine, sessions
        self.http, self.toxiproxy, self.channel = http, toxiproxy, channel
        self.order_api_url = order_api_url.rstrip("/")
        self.inventory_api_url = inventory_api_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.lock_timeout_seconds = lock_timeout_seconds
        self.safety_healthy = True
        self.recovery_required = False

    @asynccontextmanager
    async def exclusive(self, *, wait: bool = False):
        """Cross-process mutex held across durable intents and external effects."""
        async with self.engine.connect() as connection:
            try:
                async with asyncio.timeout(self.lock_timeout_seconds):
                    while True:
                        acquired = await connection.scalar(
                            text("SELECT pg_try_advisory_lock(:key)"), {"key": CONTROL_LOCK}
                        )
                        await connection.commit()
                        if acquired:
                            break
                        if not wait:
                            raise ControllerBusy()
                        await asyncio.sleep(0.05)
                yield
            finally:
                # Even an interrupted acquire may have acquired on the server.
                try:
                    async with asyncio.timeout(self.timeout_seconds):
                        await connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": CONTROL_LOCK})
                        await connection.commit()
                except BaseException:
                    await connection.invalidate()

    async def set_http_error_rate(self, percent: float) -> None:
        async with asyncio.timeout(self.timeout_seconds):
            response = await self.http.post(
                self.inventory_api_url + "/api/inventory/fault-config",
                headers=internal_headers(), json={"error_rate_percent": percent}, timeout=self.timeout_seconds,
            )
            response.raise_for_status()

    async def clear_faults(self) -> None:
        # Always attempt both even when one fails. Application faults are reached
        # through the direct control URL, never through the impaired data proxy.
        results = await asyncio.gather(
            self.toxiproxy.clear_all_toxics(), self.set_http_error_rate(0),
            return_exceptions=True,
        )
        failures = [type(value).__name__ for value in results if isinstance(value, BaseException)]
        if failures:
            self.safety_healthy = False
            raise CleanupFailed("Fault cleanup failed: " + ", ".join(failures))
        self.safety_healthy = True

    async def inject(self, experiment: Experiment) -> None:
        p = experiment.parameters
        if experiment.fault_type == FaultType.LATENCY:
            await self.toxiproxy.inject_latency_toxic(p["latency_ms"], p["jitter_ms"])
        elif experiment.fault_type == FaultType.TIMEOUT:
            await self.toxiproxy.inject_timeout_toxic(p["timeout_ms"])
        elif experiment.fault_type == FaultType.BANDWIDTH:
            await self.toxiproxy.inject_bandwidth_toxic(p["rate_kbps"])
        elif p["mode"] == "reset_peer":
            await self.toxiproxy.inject_reset_peer_toxic(p["error_rate_percent"] / 100)
        else:
            await self.set_http_error_rate(p["error_rate_percent"])

    async def start(self, values: dict[str, Any]) -> Experiment:
        async with self.exclusive():
            async with self.sessions() as session, session.begin():
                active = await session.scalar(select(Experiment.id).where(Experiment.status.in_(ACTIVE)).limit(1))
                if active is not None:
                    raise ExperimentConflict("An experiment is already active or awaiting cleanup")
                experiment = Experiment(**values, status=ExperimentStatus.PLANNED,
                                        started_at=datetime.now(timezone.utc))
                metadata(experiment, phase="starting", event_pending=False)
                session.add(experiment)
                await session.flush()
            # PLANNED is committed before injection: restart can recover any
            # ambiguous side effect, including failure of the RUNNING commit.
            try:
                await self.toxiproxy.ensure_proxy_exists()
                await self.clear_faults()
                await self.inject(experiment)
                async with self.sessions() as session, session.begin():
                    row = await session.get(Experiment, experiment.id)
                    row.status = ExperimentStatus.RUNNING
                    # Exclude orders admitted during proxy setup/cleanup, before
                    # fault injection was confirmed.
                    row.started_at = datetime.now(timezone.utc)
                    metadata(row, phase="running", simulated=self.toxiproxy.simulated)
                    await session.flush()
                    return row
            except BaseException as exc:
                try:
                    await self._finish(experiment.id, ExperimentStatus.COMPLETED,
                                       "START_FAILED: " + type(exc).__name__)
                except Exception:
                    logger.error("Start failed; durable cleanup will be retried")
                if isinstance(exc, asyncio.CancelledError):
                    raise
                raise ExperimentStartFailed("Fault injection failed; inspect experiment cleanup state") from exc

    async def _finish(self, experiment_id: UUID, final_status: ExperimentStatus, reason: str | None) -> Experiment:
        """Caller holds exclusive(). Persist the cleanup intent before I/O."""
        async with self.sessions() as session, session.begin():
            row = await session.get(Experiment, experiment_id)
            if row is None:
                raise ExperimentNotFound()
            metadata(row, phase="cleanup_pending", finish_status=final_status.value, finish_reason=reason)
        await self.clear_faults()
        async with self.sessions() as session, session.begin():
            row = await session.get(Experiment, experiment_id)
            row.status = final_status
            row.abort_reason = reason
            row.ended_at = datetime.now(timezone.utc)
            if row.started_at is None:
                row.started_at = row.ended_at
            metadata(row, phase="finished", event_pending=True)
            await session.flush()
            return row

    async def stop(self, experiment_id: UUID) -> Experiment:
        try:
            return await self._stop(experiment_id)
        except (SQLAlchemyError, TimeoutError) as exc:
            self.recovery_required = True
            await self.clear_faults()
            raise CleanupFailed("Faults cleared; database finalization will retry") from exc

    async def _stop(self, experiment_id: UUID) -> Experiment:
        async with self.exclusive(wait=True):
            async with self.sessions() as session:
                row = await session.get(Experiment, experiment_id)
                if row is None:
                    raise ExperimentNotFound()
                if row.status not in ACTIVE:
                    # An old ID must never remove a newer experiment's faults.
                    return row
                intent = row.parameters.get("_controller", {})
            return await self._finish(
                experiment_id,
                ExperimentStatus(intent.get("finish_status", ExperimentStatus.COMPLETED)),
                intent.get("finish_reason", "MANUAL_STOP"),
            )

    async def fetch_metrics(self, since: datetime) -> OrderMetrics:
        async with asyncio.timeout(self.timeout_seconds):
            response = await self.http.get(self.order_api_url + "/api/orders/metrics-summary", headers=internal_headers(),
                                           params={"since": since.isoformat()}, timeout=self.timeout_seconds)
            response.raise_for_status()
            return OrderMetrics.model_validate(response.json())

    async def queue_depth(self) -> int:
        async with asyncio.timeout(self.timeout_seconds):
            queue = await self.channel.declare_queue(FULFILLMENT_QUEUE, passive=True, durable=True, robust=False)
            return int(queue.declaration_result.message_count)

    async def tick(self) -> None:
        async with self.exclusive():
            async with self.sessions() as session:
                experiment = await session.scalar(select(Experiment).where(Experiment.status.in_(ACTIVE)).limit(1))
                if experiment is None:
                    self.recovery_required = False
                    return
                intent = experiment.parameters.get("_controller", {})
                if intent.get("phase") == "cleanup_pending":
                    await self._finish(experiment.id, ExperimentStatus(intent["finish_status"]), intent.get("finish_reason"))
                    return
                if self.recovery_required:
                    await self._finish(experiment.id, ExperimentStatus.COMPLETED, "SAFETY_STOP_CONTROLLER_FAILURE")
                    self.recovery_required = False
                    return
                if experiment.status == ExperimentStatus.PLANNED:
                    await self._finish(experiment.id, ExperimentStatus.COMPLETED, "STARTUP_RECOVERY")
                    return
                recent = list((await session.scalars(
                    select(TelemetrySnapshot).where(TelemetrySnapshot.experiment_id == experiment.id)
                    .order_by(TelemetrySnapshot.timestamp.desc(), TelemetrySnapshot.id.desc()).limit(3)
                )).all())
            now = datetime.now(timezone.utc)
            last_observed = recent[0].timestamp if recent else experiment.started_at
            if last_observed is None or (now - last_observed).total_seconds() > max(6, 2 * POLL_SECONDS + self.timeout_seconds):
                await self._finish(experiment.id, ExperimentStatus.COMPLETED, "SAFETY_STOP_MONITORING_GAP")
                return
            if recent and (now - recent[0].timestamp).total_seconds() < POLL_SECONDS:
                return
            try:
                metrics, depth = await asyncio.gather(self.fetch_metrics(experiment.started_at), self.queue_depth())
            except Exception as exc:
                await self._finish(experiment.id, ExperimentStatus.COMPLETED,
                                   "SAFETY_STOP_TELEMETRY_UNAVAILABLE: " + type(exc).__name__)
                return
            snapshot = TelemetrySnapshot(
                experiment_id=experiment.id, timestamp=now,
                total_requests=metrics.total_orders, failed_requests=metrics.failed,
                error_rate=metrics.error_rate, p95_latency_ms=metrics.p95_latency_ms,
                queue_depth=depth,
            )
            async with self.sessions() as session, session.begin():
                session.add(snapshot)
                await session.flush()
            reason = consecutive_breach_reason(experiment, [snapshot, *recent])
            if reason:
                await self._finish(experiment.id, ExperimentStatus.ABORTED_SLO_BREACH, reason)
            elif (now - experiment.started_at).total_seconds() >= experiment.parameters["duration_seconds"]:
                await self._finish(experiment.id, ExperimentStatus.COMPLETED, None)

    async def publish_pending(self) -> None:
        """Parameters hold the durable event intent because Order outbox has an Order FK."""
        async with self.sessions() as session, session.begin():
            row = await session.scalar(
                select(Experiment)
                .where(Experiment.parameters["_controller"]["event_pending"].as_boolean().is_(True))
                .order_by(Experiment.ended_at).limit(1).with_for_update(skip_locked=True)
            )
            if row is None:
                return
            payload = {"event_type": "experiment_finished", "experiment_id": str(row.id),
                       "status": row.status.value, "abort_reason": row.abort_reason,
                       "ended_at": row.ended_at.isoformat()}
            async with asyncio.timeout(self.timeout_seconds):
                confirmation = await self.channel.default_exchange.publish(
                    aio_pika.Message(
                        json.dumps(payload).encode(), content_type="application/json",
                        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                        message_id=f"experiment_finished:{row.id}", type="experiment_finished",
                    ), routing_key=ANALYSIS_QUEUE, mandatory=True, timeout=self.timeout_seconds,
                )
            if not isinstance(confirmation, Basic.Ack):
                raise RuntimeError("Experiment-finished event was not acknowledged")
            metadata(row, event_pending=False)

    async def run_watchdog(self) -> None:
        while True:
            started = time.monotonic()
            try:
                await self.tick()
                self.safety_healthy = True
            except ControllerBusy:
                pass
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.safety_healthy = False
                self.recovery_required = True
                logger.error("Watchdog failed (%s); cleanup/tracking will retry", type(exc).__name__)
                # Fail closed even when PostgreSQL is unavailable. Recovery will
                # terminate the active experiment rather than report safe success.
                try:
                    await self.clear_faults()
                except Exception:
                    logger.error("Emergency cleanup could not be confirmed")
                self.safety_healthy = False
            await asyncio.sleep(max(0.05, POLL_SECONDS - (time.monotonic() - started)))

    async def run_notifier(self) -> None:
        # Separate task: a broker outage must not stall SLO enforcement/cleanup.
        while True:
            try:
                await self.publish_pending()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Experiment event pending (%s); retrying", type(exc).__name__)
            await asyncio.sleep(1)
