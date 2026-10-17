import asyncio
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

from services.fulfillment_worker.resilience import (
    CircuitBreaker, CircuitBreakerOpen, InventoryClient, InventoryProtocolError, error_reason,
)


@pytest.mark.asyncio
async def test_breaker_open_half_open_and_close():
    clock = [0.0]
    breaker = CircuitBreaker(2, 10, clock=lambda: clock[0])
    fail = AsyncMock(side_effect=ConnectionError())
    for _ in range(2):
        with pytest.raises(ConnectionError):
            await breaker.call(fail)
    assert (await breaker.snapshot())["state"] == "OPEN"
    with pytest.raises(CircuitBreakerOpen):
        await breaker.call(fail)
    assert fail.await_count == 2
    clock[0] = 11
    started, release = asyncio.Event(), asyncio.Event()

    async def probe():
        started.set()
        await release.wait()
        return "ok"

    task = asyncio.create_task(breaker.call(probe))
    await started.wait()
    assert (await breaker.snapshot())["state"] == "HALF_OPEN"
    with pytest.raises(CircuitBreakerOpen):
        await breaker.call(fail)
    release.set()
    assert await task == "ok"
    assert (await breaker.snapshot())["state"] == "CLOSED"
    assert (await breaker.snapshot())["consecutive_failures"] == 0


@pytest.mark.asyncio
async def test_stale_success_cannot_close_newly_opened_breaker():
    breaker = CircuitBreaker(1, 10)
    started, release = asyncio.Event(), asyncio.Event()

    async def slow_success():
        started.set()
        await release.wait()

    task = asyncio.create_task(breaker.call(slow_success))
    await started.wait()
    with pytest.raises(ConnectionError):
        await breaker.call(AsyncMock(side_effect=ConnectionError()))
    release.set()
    await task
    assert (await breaker.snapshot())["state"] == "OPEN"


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [True, False])
async def test_failed_or_cancelled_probe_reopens(cancel):
    clock = [0.0]
    breaker = CircuitBreaker(1, 1, clock=lambda: clock[0])
    with pytest.raises(ConnectionError):
        await breaker.call(AsyncMock(side_effect=ConnectionError()))
    clock[0] = 2
    exception = asyncio.CancelledError if cancel else ConnectionError
    with pytest.raises(exception):
        await breaker.call(AsyncMock(side_effect=exception()))
    assert (await breaker.snapshot())["state"] == "OPEN"


@pytest.mark.asyncio
async def test_retry_success_uses_stable_key_and_proxy_path():
    order_id = uuid4()
    requests = []

    async def handler(request):
        requests.append(request)
        if len(requests) < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"order_id": str(order_id), "status": "RESERVED"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = InventoryClient(http, "http://proxy.test/", CircuitBreaker(), backoff_multiplier=0.001)
        await client.reserve(order_id, "sku", 1)
        assert client.stats.retry_count == 2 and client.stats.http_attempts == 3
    for request in requests:
        assert request.url == "http://proxy.test/api/inventory/reserve"
        assert request.headers["X-Idempotency-Key"] == str(order_id)
        assert json.loads(request.content)["quantity"] == 1
        assert all(value == 1.5 for value in request.extensions["timeout"].values())


@pytest.mark.asyncio
@pytest.mark.parametrize("status,attempts,state", [(503, 3, "OPEN"), (429, 3, "OPEN"), (409, 1, "CLOSED"), (404, 1, "CLOSED")])
async def test_retry_bounds_and_business_rejections(status, attempts, state):
    breaker = CircuitBreaker(1, 10)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status))) as http:
        client = InventoryClient(http, "http://proxy.test", breaker, backoff_multiplier=0.001)
        with pytest.raises(httpx.HTTPStatusError) as caught:
            await client.reserve(uuid4(), "sku", 1)
        assert error_reason(caught.value) == f"HTTP_{status}"
        assert client.stats.http_attempts == attempts
        assert client.stats.retry_count == attempts - 1
        assert (await breaker.snapshot())["state"] == state


@pytest.mark.asyncio
async def test_total_deadline_applies_even_when_transport_does_not_timeout():
    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = InventoryClient(http, "http://proxy.test", CircuitBreaker(), timeout_seconds=0.01, backoff_multiplier=0.001)
        with pytest.raises(httpx.TimeoutException) as caught:
            await asyncio.wait_for(client.reserve(uuid4(), "sku", 1), timeout=0.5)
        assert error_reason(caught.value) == "TimeoutException"
        assert client.stats.http_attempts == 3


@pytest.mark.asyncio
async def test_invalid_success_does_not_reserve():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"status": "RESERVED", "order_id": str(uuid4())}))) as http:
        client = InventoryClient(http, "http://proxy.test", CircuitBreaker())
        with pytest.raises(InventoryProtocolError):
            await client.reserve(uuid4(), "sku", 1)
        assert client.stats.http_attempts == 1
