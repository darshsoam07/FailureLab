import asyncio

import httpx
import pytest

from services.experiment_controller import main
from services.experiment_controller.traffic_gen import TrafficGenerator, TrafficToggle


@pytest.mark.asyncio
async def test_pacing_update_stop_and_counters():
    times = []
    bodies = []

    async def handle(request):
        times.append(asyncio.get_running_loop().time())
        bodies.append(request.content)
        return httpx.Response(201)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        generator = TrafficGenerator(client, "http://orders")
        assert not generator.status().active
        await generator.configure(TrafficToggle(enabled=True, requests_per_second=10))
        original = generator._task
        await asyncio.sleep(.36)
        assert 2 <= generator.sent <= 4
        assert all(b - a >= .08 for a, b in zip(times, times[1:]))
        await generator.configure(TrafficToggle(enabled=True, requests_per_second=5))
        assert generator._task is original
        status = await generator.configure(TrafficToggle(enabled=False, requests_per_second=5))
        assert not status.active and status.in_flight == 0
        assert status.total_orders_sent == status.accepted_orders == len(bodies)
        await asyncio.sleep(.12)
        assert generator.sent == len(bodies)
        await generator.close()


@pytest.mark.asyncio
async def test_bounded_slow_requests_and_shutdown_drain():
    entered = asyncio.Event()

    async def handle(request):
        entered.set()
        await asyncio.sleep(10)
        return httpx.Response(201)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        generator = TrafficGenerator(client, "http://orders", timeout_seconds=.35, max_in_flight=1)
        await generator.configure(TrafficToggle(enabled=True, requests_per_second=10))
        await entered.wait()
        await asyncio.sleep(.22)
        assert generator.status().in_flight == 1
        assert generator.skipped >= 1
        await generator.close()
        assert generator.failed == 1 and generator.sent == 1
        assert generator.status().in_flight == 0


@pytest.mark.asyncio
async def test_http_failures_do_not_stop_traffic():
    async def handle(request):
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        generator = TrafficGenerator(client, "http://orders")
        await generator.configure(TrafficToggle(enabled=True, requests_per_second=10))
        await asyncio.sleep(.22)
        assert generator.status().active
        await generator.close()
        assert generator.failed == generator.sent >= 2


@pytest.mark.asyncio
async def test_routes_and_validation():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(201))) as orders:
        generator = TrafficGenerator(orders, "http://orders")
        main.app.dependency_overrides[main.traffic_generator] = lambda: generator
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://controller") as client:
                assert not (await client.get("/api/traffic/status")).json()["active"]
                for rps in (0, 11, 1.5, True):
                    assert (await client.post("/api/traffic/toggle", json={
                        "enabled": True, "requests_per_second": rps,
                    })).status_code == 422
                result = await client.post("/api/traffic/toggle", json={"enabled": True, "requests_per_second": 7})
                assert result.json()["active"] and result.json()["requests_per_second"] == 7
                result = await client.post("/api/traffic/toggle", json={"enabled": False, "requests_per_second": 7})
                assert not result.json()["active"]
        finally:
            main.app.dependency_overrides.pop(main.traffic_generator, None)
            await generator.close()
