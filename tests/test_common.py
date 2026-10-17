from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from services.common import database, models, schemas
from services.common.config import BaseAppSettings


def test_settings(monkeypatch):
    values = {
        "DATABASE_URL": "postgresql+asyncpg://user:secret@database.test/failurelab",
        "RABBITMQ_URL": "amqp://user:secret@broker.test/",
        "TOXIPROXY_API_URL": "http://toxiproxy.test",
        "INVENTORY_PROXY_URL": "http://inventory.test",
        "USE_MOCK_AI": "true",
        "LOG_LEVEL": "debug",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert BaseAppSettings().LOG_LEVEL == "DEBUG"
    monkeypatch.setenv("USE_MOCK_AI", "false")
    with pytest.raises(ValidationError, match="LLM_API_KEY"):
        BaseAppSettings()
    monkeypatch.setenv("LLM_API_KEY", "private-key")
    assert "private-key" not in repr(BaseAppSettings())
    monkeypatch.setenv("DATABASE_URL", "postgresql://database.test/failurelab")
    with pytest.raises(ValidationError, match="asyncpg"):
        BaseAppSettings()


@pytest.mark.parametrize("quantity", [0, -1, True, 1.5, 2**31])
def test_order_rejects_invalid_quantity(quantity):
    with pytest.raises(ValidationError):
        schemas.OrderCreate(customer_id="customer", sku="sku", quantity=quantity)


def test_create_rejects_server_owned_fields():
    with pytest.raises(ValidationError):
        schemas.OrderCreate(customer_id="customer", sku="sku", quantity=1, status="RESERVED")


@pytest.mark.parametrize("rate", [-0.1, 1.1, float("nan"), float("inf")])
def test_experiment_rejects_invalid_rate(rate):
    with pytest.raises(ValidationError):
        schemas.ExperimentCreate(name="test", fault_type="LATENCY", target_service="inventory",
                                 parameters={}, slo_max_error_rate=rate, slo_max_p95_ms=500)


def test_telemetry_rejects_inconsistent_counts():
    with pytest.raises(ValidationError, match="failed_requests"):
        schemas.TelemetrySnapshotCreate(experiment_id=uuid4(), total_requests=1,
                                        failed_requests=2, error_rate=1,
                                        p95_latency_ms=0, queue_depth=0)


def test_responses_from_all_orm_models():
    now = datetime.now(timezone.utc)
    order_id, experiment_id = uuid4(), uuid4()
    pairs = [
        (models.Order(id=order_id, customer_id="c", sku="s", quantity=1,
                      status=models.OrderStatus.PENDING, latency_ms=0, created_at=now), schemas.OrderResponse),
        (models.OutboxEvent(id=uuid4(), aggregate_id=order_id, event_type="OrderCreated",
                            payload={"quantity": 1}, processed=False, created_at=now), schemas.OutboxEventResponse),
        (models.InventoryItem(sku="s", available_qty=10, updated_at=now), schemas.InventoryItemResponse),
        (models.IdempotencyRecord(idempotency_key="key", order_id=order_id,
                                  response_status=200, created_at=now), schemas.IdempotencyRecordResponse),
        (models.Experiment(id=experiment_id, name="test", fault_type=models.FaultType.LATENCY,
                           target_service="inventory", parameters={"latency_ms": 400},
                           slo_max_error_rate=0.1, slo_max_p95_ms=500,
                           status=models.ExperimentStatus.PLANNED), schemas.ExperimentResponse),
        (models.TelemetrySnapshot(id=uuid4(), experiment_id=experiment_id, timestamp=now,
                                 total_requests=10, failed_requests=1, error_rate=0.1,
                                 p95_latency_ms=200, queue_depth=0), schemas.TelemetrySnapshotResponse),
        (models.AIReport(id=uuid4(), experiment_id=experiment_id, root_cause_summary="Latency",
                         confidence_score=0.8, evidence_bullets=["High p95"], recommended_fix="Tune timeout",
                         next_experiment_proposal={"fault_type": "TIMEOUT"}, created_at=now), schemas.AIReportResponse),
    ]
    for instance, schema in pairs:
        result = schema.model_validate(instance)
        assert schema.model_validate_json(result.model_dump_json()) == result


def test_postgres_ddl_and_integrity_boundaries():
    tables = database.Base.metadata.tables
    assert len(tables) == 7
    for table in tables.values():
        ddl = str(CreateTable(table).compile(dialect=postgresql.dialect()))
        assert "CREATE TABLE" in ddl
    assert models.OutboxEvent.__table__.c.processed.index
    assert models.IdempotencyRecord.__table__.c.idempotency_key.primary_key
    assert str(models.AIReport.__table__.c.evidence_bullets.type) == "JSONB"
    assert models.TelemetrySnapshot.__table__.c.experiment_id.foreign_keys


@pytest.mark.asyncio
async def test_session_rolls_back_and_closes_on_failure(monkeypatch):
    session = AsyncMock()
    context = AsyncMock()
    context.__aenter__.return_value = session
    factory = MagicMock(return_value=context)
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)
    dependency = database.get_db_session()
    assert await anext(dependency) is session
    with pytest.raises(RuntimeError, match="failure"):
        await dependency.athrow(RuntimeError("failure"))
    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()
    context.__aexit__.assert_awaited_once()


@pytest.mark.asyncio
async def test_session_closes_without_implicit_commit(monkeypatch):
    session = AsyncMock()
    context = AsyncMock()
    context.__aenter__.return_value = session
    monkeypatch.setattr(database, "get_session_factory", lambda: MagicMock(return_value=context))
    dependency = database.get_db_session()
    assert await anext(dependency) is session
    with pytest.raises(StopAsyncIteration):
        await anext(dependency)
    session.commit.assert_not_awaited()
    context.__aexit__.assert_awaited_once()


@pytest.mark.asyncio
async def test_init_db_locks_before_creating_tables(monkeypatch):
    connection = AsyncMock()
    context = AsyncMock()
    context.__aenter__.return_value = connection
    engine = MagicMock()
    engine.begin.return_value = context
    monkeypatch.setattr(database, "get_engine", lambda: engine)
    await database.init_db()
    assert "pg_advisory_xact_lock" in str(connection.execute.call_args.args[0])
    connection.run_sync.assert_awaited_once_with(database.Base.metadata.create_all)
    assert [call[0] for call in connection.mock_calls] == ["execute", "run_sync"]
    context.__aexit__.assert_awaited_once()
