from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from services.common.database import get_db_session
from services.common.models import IdempotencyRecord, InventoryItem
from services.inventory_service import main


def setup_reservation(percent=0):
    body = main.ReservationRequest(order_id=uuid4(), sku="SKU-PHONE", quantity=2)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        fault_config=main.FaultConfig(error_rate_percent=percent)
    )))
    session = MagicMock()
    transaction = AsyncMock()
    transaction.__aexit__.return_value = False
    session.begin.return_value = transaction
    session.get = AsyncMock(return_value=None)
    session.execute = AsyncMock()
    session.scalar = AsyncMock(return_value=0)
    session.flush = AsyncMock()
    return body, request, session, transaction


@pytest.mark.asyncio
@pytest.mark.parametrize("after_lock", [False, True])
async def test_cached_success_bypasses_stock_and_faults(after_lock):
    body, request, session, transaction = setup_reservation(percent=100)
    record = IdempotencyRecord(order_id=body.order_id, response_status=200)
    session.get.side_effect = [None, record] if after_lock else [record]
    response = await main.reserve(body, request, session, "key")
    assert response.order_id == body.order_id and response.status == "RESERVED"
    session.scalar.assert_not_awaited()
    session.add.assert_not_called()
    assert session.execute.await_count == int(after_lock)
    transaction.__aexit__.assert_awaited_once_with(None, None, None)


@pytest.mark.asyncio
async def test_reservation_decrement_and_record_are_atomic():
    body, request, session, transaction = setup_reservation()
    response = await main.reserve(body, request, session, "key")
    assert response.status == "RESERVED"
    assert "pg_advisory_xact_lock" in str(session.execute.call_args.args[0])
    assert isinstance(session.execute.call_args.args[1]["key"], int)
    sql = str(session.scalar.call_args.args[0].compile(dialect=postgresql.dialect()))
    assert "available_qty >=" in sql and "RETURNING" in sql
    record = session.add.call_args.args[0]
    assert record.order_id == body.order_id and record.idempotency_key == "key"
    assert record.response_status == 200
    transaction.__aexit__.assert_awaited_once_with(None, None, None)


@pytest.mark.asyncio
async def test_failed_record_insert_rolls_back_stock():
    body, request, session, transaction = setup_reservation()
    session.flush.side_effect = RuntimeError("db failure")
    with pytest.raises(RuntimeError):
        await main.reserve(body, request, session, "key")
    assert transaction.__aexit__.call_args.args[0] is RuntimeError


@pytest.mark.asyncio
@pytest.mark.parametrize("known_sku,status", [(True, 409), (False, 404)])
async def test_unavailable_inventory_is_not_recorded(known_sku, status):
    body, request, session, transaction = setup_reservation()
    session.get.side_effect = [None, None, InventoryItem(sku=body.sku, available_qty=1) if known_sku else None]
    session.scalar.return_value = None
    with pytest.raises(HTTPException) as caught:
        await main.reserve(body, request, session, "key")
    assert caught.value.status_code == status
    session.add.assert_not_called()
    assert transaction.__aexit__.call_args.args[0] is HTTPException


@pytest.mark.asyncio
async def test_key_reuse_for_another_order_conflicts():
    body, request, session, _ = setup_reservation()
    session.get.return_value = IdempotencyRecord(order_id=uuid4(), response_status=200)
    with pytest.raises(HTTPException) as caught:
        await main.reserve(body, request, session, "key")
    assert caught.value.status_code == 409
    session.scalar.assert_not_awaited()


@pytest.mark.asyncio
async def test_injected_503_does_not_mutate_stock():
    body, request, session, _ = setup_reservation(percent=100)
    with pytest.raises(HTTPException) as caught:
        await main.reserve(body, request, session, "key")
    assert caught.value.status_code == 503
    session.scalar.assert_not_awaited()
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_inventory_http_validation_and_fault_config():
    body, _, session, _ = setup_reservation()

    async def dependency():
        yield session

    main.app.dependency_overrides[get_db_session] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), headers={"Authorization": "Bearer " + "test-internal-token-" * 3}, base_url="http://test") as client:
            assert (await client.get("/health")).status_code == 200
            assert (await client.get("/ready")).status_code == 503
            assert (await client.post("/api/inventory/reserve", json=body.model_dump(mode="json"))).status_code == 422
            assert (await client.post("/api/inventory/fault-config", json={"error_rate_percent": 101})).status_code == 422
            response = await client.post("/api/inventory/fault-config", json={"error_rate_percent": 100})
            assert response.status_code == 200
            response = await client.post("/api/inventory/reserve", json=body.model_dump(mode="json"), headers={"X-Idempotency-Key": "key"})
            assert response.status_code == 503
            await client.post("/api/inventory/fault-config", json={"error_rate_percent": 0})
    finally:
        main.app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def authenticated_internal_client(monkeypatch):
    # Existing business-contract tests now run as an explicit internal principal.
    # Anonymous/viewer/operator boundaries are exercised separately in test_oauth.py.
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "test-internal-token-" * 3)
