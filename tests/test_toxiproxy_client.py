import json

import httpx
import pytest

from services.experiment_controller.toxiproxy_client import ToxiproxyClient, ToxiproxySettings


@pytest.mark.asyncio
async def test_official_rest_payloads_and_scoped_cleanup():
    calls, toxics = [], []
    proxy = None

    def handler(request):
        nonlocal proxy
        calls.append((request.method, request.url.path))
        path = request.url.path
        if path == "/proxies" and request.method == "POST":
            proxy = json.loads(request.content)
            return httpx.Response(201, json=proxy)
        if path == "/proxies/inventory_proxy":
            return httpx.Response(200, json=proxy) if proxy else httpx.Response(404)
        if path.endswith("/toxics"):
            if request.method == "GET":
                return httpx.Response(200, json=toxics)
            toxic = json.loads(request.content)
            toxics.append(toxic)
            return httpx.Response(200, json=toxic)
        if request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = ToxiproxyClient(http)
        await client.ensure_proxy_exists()
        await client.ensure_proxy_exists()
        await client.inject_latency_toxic(400, 50)
        await client.inject_timeout_toxic(0)
        await client.inject_reset_peer_toxic(0.25)
        await client.inject_bandwidth_toxic(10)
        await client.clear_all_toxics()
    assert calls.count(("POST", "/proxies")) == 1
    assert all(toxic["stream"] == "downstream" for toxic in toxics)
    assert toxics[0]["attributes"] == {"latency": 400, "jitter": 50}
    assert toxics[1]["attributes"] == {"timeout": 0}
    assert toxics[2]["type"] == "reset_peer" and toxics[2]["toxicity"] == 0.25
    assert toxics[3]["attributes"] == {"rate": 10}
    assert len([method for method, _ in calls if method == "DELETE"]) == 4
    assert not any(path == "/reset" for _, path in calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [False, True])
async def test_fallback_requires_explicit_opt_in(enabled):
    def handler(request):
        raise httpx.ConnectError("offline")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = ToxiproxyClient(http, ToxiproxySettings(TOXIPROXY_TEST_FALLBACK=enabled))
        if not enabled:
            with pytest.raises(httpx.ConnectError):
                await client.ensure_proxy_exists()
            return
        await client.ensure_proxy_exists()
        assert client.simulated
        await client.inject_latency_toxic(10)
        assert len(client._fake_toxics) == 1
        await client.clear_all_toxics()
        assert not client._fake_toxics


@pytest.mark.asyncio
async def test_no_fallback_after_contact_or_on_http_errors():
    replies = iter([httpx.Response(500), httpx.ConnectError("offline")])

    def handler(request):
        response = next(replies)
        if isinstance(response, Exception):
            raise response
        return response

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = ToxiproxyClient(http, ToxiproxySettings(TOXIPROXY_TEST_FALLBACK=True))
        with pytest.raises(httpx.HTTPStatusError):
            await client.ensure_proxy_exists()
        with pytest.raises(httpx.ConnectError):
            await client.ensure_proxy_exists()
        assert not client.simulated


@pytest.mark.asyncio
async def test_cleanup_attempts_all_toxics_even_if_one_delete_fails():
    deleted = []

    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json=[{"name": "one"}, {"name": "two"}])
        deleted.append(request.url.path)
        return httpx.Response(500 if request.url.path.endswith("one") else 204)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(RuntimeError):
            await ToxiproxyClient(http).clear_all_toxics()
    assert len(deleted) == 2
