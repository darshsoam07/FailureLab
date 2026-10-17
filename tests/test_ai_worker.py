import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.dialects import postgresql

from services.ai_worker import main
from services.ai_worker.analyzer import AnalysisSettings
from services.common.models import AIReport, Experiment, ExperimentStatus, FaultType


def setup_worker(existing=None, status=ExperimentStatus.COMPLETED):
    now = datetime.now(timezone.utc)
    experiment = Experiment(id=uuid4(), name="test", fault_type=FaultType.LATENCY,
                            target_service="inventory_service", parameters={"latency_ms": 100, "jitter_ms": 0},
                            slo_max_error_rate=0.1, slo_max_p95_ms=500, status=status,
                            abort_reason=None, started_at=now, ended_at=now)
    session = MagicMock()
    session.scalar = AsyncMock(side_effect=[experiment, existing])
    session.scalars = AsyncMock(return_value=MagicMock(all=lambda: []))
    session.flush = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock())
    transaction = AsyncMock()
    transaction.__aexit__.return_value = False
    session.begin.return_value = transaction
    context = AsyncMock()
    context.__aenter__.return_value = session
    context.__aexit__.return_value = False
    worker = main.AIAnalysisWorker(MagicMock(return_value=context), AnalysisSettings(), requeue_delay=0.001)
    payload = main.ExperimentFinishedEvent(event_type="experiment_finished", experiment_id=experiment.id)
    message = MagicMock(body=payload.model_dump_json().encode(), processed=False)
    message.ack, message.nack, message.reject = AsyncMock(), AsyncMock(), AsyncMock()
    return worker, message, session, transaction, experiment


@pytest.mark.asyncio
async def test_report_saved_atomically_and_committed_before_ack():
    worker, message, session, transaction, experiment = setup_worker()
    sequence = []
    transaction.__aexit__.side_effect = lambda *args: sequence.append("commit") or False
    message.ack.side_effect = lambda: sequence.append("ack")
    await worker.process_message(message)
    assert sequence == ["commit", "ack"]
    row = session.add.call_args.args[0]
    assert isinstance(row, AIReport) and row.experiment_id == experiment.id
    assert row.confidence_score == 0.15
    assert isinstance(row.next_experiment_proposal, dict)
    sql = str(session.scalar.call_args_list[0].args[0].compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in sql
    timeline_sql = str(session.scalars.call_args.args[0].compile(dialect=postgresql.dialect()))
    assert "ORDER BY telemetry_snapshots.timestamp, telemetry_snapshots.id" in timeline_sql


@pytest.mark.asyncio
async def test_duplicate_skips_analyzer_and_insertion(monkeypatch):
    worker, message, session, _, _ = setup_worker(existing=uuid4())
    analyzer = AsyncMock()
    monkeypatch.setattr(main, "analyze_experiment", analyzer)
    await worker.process_message(message)
    analyzer.assert_not_awaited()
    session.add.assert_not_called()
    session.scalars.assert_not_awaited()
    message.ack.assert_awaited_once()


@pytest.mark.asyncio
async def test_commit_failure_requeues_without_ack():
    worker, message, _, transaction, _ = setup_worker()
    transaction.__aexit__.side_effect = ConnectionError()
    await worker.process_message(message)
    message.ack.assert_not_awaited()
    message.nack.assert_awaited_once_with(requeue=True)


@pytest.mark.asyncio
async def test_cancellation_rolls_back_and_leaves_unacked(monkeypatch):
    worker, message, session, transaction, _ = setup_worker()
    monkeypatch.setattr(main, "analyze_experiment", AsyncMock(side_effect=asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        await worker.process_message(message)
    assert transaction.__aexit__.call_args.args[0] is asyncio.CancelledError
    session.add.assert_not_called()
    message.ack.assert_not_awaited()
    message.nack.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [b"not json", b"x" * 65537, b'{"event_type":"OrderCreated"}'],
                         ids=["invalid-json", "oversized", "wrong-event-type"])
async def test_poison_message_is_rejected_without_querying_database(body):
    worker, message, _, _, _ = setup_worker()
    message.body = body
    await worker.process_message(message)
    worker.sessions.assert_not_called()
    message.reject.assert_awaited_once_with(requeue=False)


@pytest.mark.asyncio
async def test_missing_experiment_is_rejected():
    worker, message, session, _, _ = setup_worker()
    session.scalar.side_effect = [None]
    await worker.process_message(message)
    message.reject.assert_awaited_once_with(requeue=False)
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_running_experiment_is_requeued_not_analyzed(monkeypatch):
    worker, message, _, _, _ = setup_worker(status=ExperimentStatus.RUNNING)
    analyzer = AsyncMock()
    monkeypatch.setattr(main, "analyze_experiment", analyzer)
    await worker.process_message(message)
    analyzer.assert_not_awaited()
    message.nack.assert_awaited_once_with(requeue=True)


@pytest.mark.asyncio
async def test_health_without_startup():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
        assert (await client.get("/health")).json() == {"status": "ok"}
        assert (await client.get("/ready")).status_code == 503


@pytest.mark.asyncio
@pytest.mark.parametrize("db_ok,broker_ok,consumer_ok", [(True, True, True), (False, True, True), (True, False, True), (True, True, False)])
async def test_readiness_checks_dependencies(monkeypatch, db_ok, broker_ok, consumer_ok):
    worker, _, session, _, _ = setup_worker()
    if not db_ok:
        session.execute.side_effect = ConnectionError()
    connection = MagicMock(is_closed=not broker_ok)
    connection.connected.is_set.return_value = broker_ok
    connection.channel.return_value = AsyncMock()
    channel = MagicMock(is_closed=False)
    channel.ready = AsyncMock()
    task = MagicMock()
    task.done.return_value = not consumer_ok
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        ready=True, worker=worker, consumer_task=task,
        consumer_supervisor=SimpleNamespace(healthy=broker_ok, probe=AsyncMock(return_value=broker_ok)),
    )))
    monkeypatch.setattr(main, "get_worker_settings", lambda: SimpleNamespace(READINESS_TIMEOUT_SECONDS=1))
    response = await main.ready(request)
    assert response.status_code == (200 if db_ok and broker_ok and consumer_ok else 503)


@pytest.mark.asyncio
async def test_lifespan_initializes_consumer_and_closes_resources(monkeypatch):
    settings = SimpleNamespace(LOG_LEVEL="INFO", RABBITMQ_URL="amqp://broker.test/",
                               RABBITMQ_CONNECT_TIMEOUT_SECONDS=1, RABBITMQ_HEARTBEAT_SECONDS=10, AI_JOB_TIMEOUT_SECONDS=60,
                               AI_REQUEUE_DELAY_SECONDS=0.01, AI_MAX_MESSAGE_BYTES=65536, AI_PREFETCH_COUNT=1)
    monkeypatch.setattr(main, "get_worker_settings", lambda: settings)
    monkeypatch.setattr(main, "get_analysis_settings", lambda: AnalysisSettings())
    initialize, dispose = AsyncMock(), AsyncMock()
    monkeypatch.setattr(main, "init_db", initialize)
    monkeypatch.setattr(main, "close_db", dispose)
    monkeypatch.setattr(main, "get_session_factory", MagicMock())
    connection, channel = AsyncMock(), AsyncMock()
    connection.channel.return_value = channel
    monkeypatch.setattr(main.aio_pika, "connect_robust", AsyncMock(return_value=connection))
    stopped = asyncio.Event()

    async def consume(self):
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(main.ConsumerSupervisor, "run", consume)
    application = SimpleNamespace(state=SimpleNamespace())
    async with main.lifespan(application):
        await asyncio.sleep(0)
        assert application.state.ready and application.state.worker.client is None
    assert stopped.is_set() and not application.state.ready
    initialize.assert_awaited_once()
    assert application.state.consumer_supervisor.queue_name == "ai_analysis_queue"
    dispose.assert_awaited_once()
