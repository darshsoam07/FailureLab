import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from pamqp.commands import Basic
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from services.common.models import Experiment, ExperimentStatus, FaultType, TelemetrySnapshot
from services.experiment_controller import main
from services.experiment_controller.watchdog import (
    CleanupFailed, ControllerBusy, ExperimentConflict, ExperimentController,
    OrderMetrics, consecutive_breach_reason,
)


def experiment(**changes):
    values = dict(id=uuid4(), name="latency", fault_type=FaultType.LATENCY,
                  target_service="inventory_service", parameters={"latency_ms": 400, "jitter_ms": 50, "duration_seconds": 60},
                  slo_max_error_rate=0.1, slo_max_p95_ms=500,
                  status=ExperimentStatus.RUNNING, started_at=datetime.now(timezone.utc),
                  ended_at=None, abort_reason=None)
    values.update(changes)
    return Experiment(**values)


def snapshot(rate=0.2, latency=100, seconds_ago=3):
    return TelemetrySnapshot(id=uuid4(), timestamp=datetime.now(timezone.utc) - timedelta(seconds=seconds_ago),
                             error_rate=rate, p95_latency_ms=latency, total_requests=10,
                             failed_requests=int(rate * 10), queue_depth=0)


def fake_controller(row=None):
    session = MagicMock()
    session.get = AsyncMock(return_value=row)
    session.scalar = AsyncMock(return_value=row)
    session.scalars = AsyncMock(return_value=MagicMock(all=lambda: []))
    session.flush = AsyncMock()
    transaction = AsyncMock()
    transaction.__aexit__.return_value = False
    session.begin.return_value = transaction
    context = AsyncMock()
    context.__aenter__.return_value = session
    context.__aexit__.return_value = False
    channel = MagicMock()
    channel.default_exchange.publish = AsyncMock(return_value=Basic.Ack())
    toxiproxy = MagicMock(simulated=False)
    toxiproxy.clear_all_toxics = AsyncMock()
    control = ExperimentController(MagicMock(), MagicMock(return_value=context), AsyncMock(), toxiproxy, channel,
                                   order_api_url="http://orders.test", inventory_api_url="http://inventory.test")

    @asynccontextmanager
    async def unlocked(**kwargs):
        yield

    control.exclusive = unlocked
    control.set_http_error_rate = AsyncMock()
    control.fetch_metrics = AsyncMock(return_value=OrderMetrics(
        total_orders=10, succeeded=8, failed=2, pending_count=0, error_rate=0.2, p95_latency_ms=100,
    ))
    control.queue_depth = AsyncMock(return_value=4)
    return control, session, transaction


@pytest.mark.asyncio
async def test_watchdog_requests_experiment_scoped_metrics():
    row = experiment()
    control, _, _ = fake_controller(row)
    await control.tick()
    control.fetch_metrics.assert_awaited_once_with(row.started_at)


@pytest.mark.asyncio
async def test_metrics_http_query_includes_since():
    since = datetime.now(timezone.utc)
    async def handler(request):
        assert request.url.params['since'] == since.isoformat()
        return httpx.Response(200, json={'total_orders': 1, 'succeeded': 1, 'failed': 0,
                                        'pending_count': 0, 'error_rate': 0, 'p95_latency_ms': 123})
    control, _, _ = fake_controller()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        control.http = http
        metrics = await ExperimentController.fetch_metrics(control, since)
    assert metrics.p95_latency_ms == 123


def test_three_consecutive_breaches_include_alternating_metrics():
    row = experiment()
    reason = consecutive_breach_reason(row, [snapshot(), snapshot(0, 501), snapshot()])
    assert "3 consecutive" in reason
    assert "error_rate=0.2 > slo_max_error_rate=0.1" in reason
    assert "p95_latency_ms=501 > slo_max_p95_ms=500" in reason
    assert consecutive_breach_reason(row, [snapshot(), snapshot()]) is None
    assert consecutive_breach_reason(row, [snapshot(), snapshot(0, 100), snapshot()]) is None
    assert consecutive_breach_reason(row, [snapshot(0.1, 500)] * 3) is None


@pytest.mark.parametrize("changes", [
    {"target_service": "arbitrary-service"}, {"duration_seconds": 0},
    {"parameters": {"latency_ms": -1}}, {"parameters": {"latency_ms": 1, "_controller": {}}},
    {"parameters": {"latency_ms": True}}, {"fault_type": "SHELL_COMMAND"},
])
def test_start_rejects_unallowlisted_inputs(changes):
    data = dict(name="test", fault_type="LATENCY", parameters={"latency_ms": 400},
                slo_max_error_rate=0.1, slo_max_p95_ms=500)
    with pytest.raises(ValidationError):
        main.ExperimentStart(**(data | changes))


@pytest.mark.asyncio
async def test_watchdog_saves_snapshot_then_aborts_third_breach():
    row = experiment()
    control, session, _ = fake_controller(row)
    session.scalars.return_value = MagicMock(all=lambda: [snapshot(), snapshot(seconds_ago=5)])
    control._finish = AsyncMock()
    await control.tick()
    saved = session.add.call_args.args[0]
    assert saved.experiment_id == row.id and saved.queue_depth == 4
    assert saved.total_requests == 10 and saved.failed_requests == 2
    args = control._finish.call_args.args
    assert args[1] == ExperimentStatus.ABORTED_SLO_BREACH
    assert "error_rate=0.2" in args[2]


@pytest.mark.asyncio
async def test_safe_duration_finishes_and_breach_takes_precedence():
    row = experiment(started_at=datetime.now(timezone.utc) - timedelta(seconds=61))
    control, session, _ = fake_controller(row)
    session.scalars.return_value = MagicMock(all=lambda: [snapshot(0), snapshot(0, seconds_ago=5)])
    control.fetch_metrics.return_value = OrderMetrics(total_orders=10, succeeded=10, failed=0,
                                                     pending_count=0, error_rate=0, p95_latency_ms=100)
    control._finish = AsyncMock()
    await control.tick()
    control._finish.assert_awaited_once_with(row.id, ExperimentStatus.COMPLETED, None)
    control._finish.reset_mock()
    session.scalars.return_value = MagicMock(all=lambda: [snapshot(), snapshot(seconds_ago=5)])
    control.fetch_metrics.return_value = OrderMetrics(total_orders=10, succeeded=8, failed=2,
                                                     pending_count=0, error_rate=0.2, p95_latency_ms=100)
    await control.tick()
    assert control._finish.call_args.args[1] == ExperimentStatus.ABORTED_SLO_BREACH


@pytest.mark.asyncio
async def test_failed_cleanup_keeps_active_durable_intent_and_attempts_both():
    row = experiment()
    control, _, _ = fake_controller(row)
    control.toxiproxy.clear_all_toxics.side_effect = httpx.ConnectError("offline")
    with pytest.raises(CleanupFailed):
        await control._finish(row.id, ExperimentStatus.ABORTED_SLO_BREACH, "breach")
    assert row.status == ExperimentStatus.RUNNING
    assert row.parameters["_controller"]["phase"] == "cleanup_pending"
    assert row.parameters["_controller"]["finish_reason"] == "breach"
    control.set_http_error_rate.assert_awaited_once_with(0)
    control.toxiproxy.clear_all_toxics.side_effect = None
    await control.tick()
    assert row.status == ExperimentStatus.ABORTED_SLO_BREACH
    assert row.parameters["_controller"]["event_pending"] is True


@pytest.mark.asyncio
async def test_terminal_state_follows_cleanup_and_event_is_durable():
    row = experiment()
    control, _, _ = fake_controller(row)

    async def clear():
        assert row.status == ExperimentStatus.RUNNING
        assert row.parameters["_controller"]["phase"] == "cleanup_pending"

    control.toxiproxy.clear_all_toxics.side_effect = clear
    await control._finish(row.id, ExperimentStatus.COMPLETED, None)
    assert row.status == ExperimentStatus.COMPLETED and row.ended_at is not None
    assert row.parameters["_controller"]["event_pending"] is True
    control.channel.default_exchange.publish.assert_not_awaited()
    await control.publish_pending()
    assert row.parameters["_controller"]["event_pending"] is False
    message = control.channel.default_exchange.publish.call_args.args[0]
    assert message.message_id == f"experiment_finished:{row.id}"
    assert json.loads(message.body)["experiment_id"] == str(row.id)
    assert message.delivery_mode == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmation", [None, Basic.Nack()])
async def test_notification_requires_broker_confirmation(confirmation):
    row = experiment(status=ExperimentStatus.COMPLETED, ended_at=datetime.now(timezone.utc))
    row.parameters["_controller"] = {"event_pending": True}
    control, session, transaction = fake_controller(row)
    control.channel.default_exchange.publish.return_value = confirmation
    with pytest.raises(RuntimeError):
        await control.publish_pending()
    assert row.parameters["_controller"]["event_pending"] is True
    assert transaction.__aexit__.call_args.args[0] is RuntimeError
    sql = str(session.scalar.call_args.args[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE SKIP LOCKED" in sql


@pytest.mark.asyncio
async def test_start_refuses_existing_experiment_without_injection():
    control, _, _ = fake_controller(experiment())
    control.inject = AsyncMock()
    with pytest.raises(ExperimentConflict):
        await control.start({})
    control.inject.assert_not_awaited()


@pytest.mark.asyncio
async def test_manual_stop_cleans_and_old_stop_is_harmless():
    row = experiment()
    control, _, _ = fake_controller(row)
    await control.stop(row.id)
    assert row.status == ExperimentStatus.COMPLETED and row.abort_reason == "MANUAL_STOP"
    control.toxiproxy.clear_all_toxics.assert_awaited_once()
    await control.stop(row.id)
    control.toxiproxy.clear_all_toxics.assert_awaited_once()


@pytest.mark.asyncio
async def test_telemetry_failure_stops_instead_of_inventing_zero_metrics():
    row = experiment()
    control, session, _ = fake_controller(row)
    control.fetch_metrics.side_effect = httpx.ReadTimeout("timeout")
    control._finish = AsyncMock()
    await control.tick()
    assert "TELEMETRY_UNAVAILABLE" in control._finish.call_args.args[2]
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_monitoring_gap_stops_safely():
    row = experiment(started_at=datetime.now(timezone.utc) - timedelta(seconds=30))
    control, _, _ = fake_controller(row)
    control._finish = AsyncMock()
    await control.tick()
    control._finish.assert_awaited_once_with(row.id, ExperimentStatus.COMPLETED, "SAFETY_STOP_MONITORING_GAP")


@pytest.mark.asyncio
async def test_database_mutex_is_released_on_failure():
    control, _, _ = fake_controller()
    connection = AsyncMock()
    connection.scalar.return_value = True
    context = AsyncMock()
    context.__aenter__.return_value = connection
    control.engine.connect.return_value = context
    # Exercise the real implementation, not the orchestration test's override.
    with pytest.raises(ValueError):
        async with ExperimentController.exclusive(control):
            raise ValueError("injection failed")
    assert "pg_try_advisory_lock" in str(connection.scalar.call_args.args[0])
    assert "pg_advisory_unlock" in str(connection.execute.call_args.args[0])
    connection.scalar.return_value = False
    with pytest.raises(ControllerBusy):
        async with ExperimentController.exclusive(control):
            pytest.fail("must not enter")


@pytest.mark.asyncio
async def test_catalog_health_and_request_validation():
    control, _, _ = fake_controller()
    main.app.dependency_overrides[main.controller] = lambda: control
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            assert (await client.get("/health")).status_code == 200
            assert (await client.get("/ready")).status_code == 503
            catalog = (await client.get("/api/experiments/catalog")).json()
            assert {item["fault_type"] for item in catalog["experiments"]} == {kind.value for kind in FaultType}
            response = await client.post("/api/experiments/start", json={"name": "bad"})
            assert response.status_code == 422
    finally:
        main.app.dependency_overrides.clear()
