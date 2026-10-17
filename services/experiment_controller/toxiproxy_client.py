"""Toxiproxy v2 REST client, scoped to one configured proxy."""

import asyncio
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class ToxiproxySettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")
    # Explicit local defaults requested for this service; all are env-overridable.
    TOXIPROXY_API_URL: AnyHttpUrl = "http://localhost:8474"
    TOXIPROXY_PROXY_NAME: str = "inventory_proxy"
    TOXIPROXY_LISTEN: str = "0.0.0.0:8475"
    TOXIPROXY_UPSTREAM: str = "inventory-service:8001"
    TOXIPROXY_TIMEOUT_SECONDS: float = Field(default=2, gt=0, allow_inf_nan=False)
    TOXIPROXY_TEST_FALLBACK: bool = False
    TOXIPROXY_AUTH_TOKEN: SecretStr | None = None


class ToxiproxyClient:
    def __init__(self, client: httpx.AsyncClient, settings: ToxiproxySettings | None = None):
        self.settings = settings or ToxiproxySettings()
        self.client = client
        self.name = self.settings.TOXIPROXY_PROXY_NAME
        self.simulated = False
        self._contacted_server = False
        self._fake_toxics: dict[str, dict[str, Any]] = {}

    @property
    def proxy_path(self) -> str:
        return "/proxies/" + quote(self.name, safe="")

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = {}
        if self.settings.TOXIPROXY_AUTH_TOKEN:
            headers["Authorization"] = "Bearer " + self.settings.TOXIPROXY_AUTH_TOKEN.get_secret_value()
        async with asyncio.timeout(self.settings.TOXIPROXY_TIMEOUT_SECONDS):
            response = await self.client.request(
                method, str(self.settings.TOXIPROXY_API_URL).rstrip("/") + path,
                headers=headers, timeout=self.settings.TOXIPROXY_TIMEOUT_SECONDS, **kwargs,
            )
        self._contacted_server = True
        return response

    async def ensure_proxy_exists(self, name: str | None = None, listen: str | None = None,
                                  upstream: str | None = None) -> dict[str, Any]:
        self.name = name or self.settings.TOXIPROXY_PROXY_NAME
        desired = {"name": self.name, "listen": listen or self.settings.TOXIPROXY_LISTEN,
                   "upstream": upstream or self.settings.TOXIPROXY_UPSTREAM, "enabled": True}
        if self.simulated:
            return desired
        try:
            response = await self._request("GET", self.proxy_path)
        except httpx.ConnectError:
            # Only opt-in tests may fall back, before any real-server contact.
            # Never mask a failed mutation/cleanup on an already connected server.
            if not self.settings.TOXIPROXY_TEST_FALLBACK or self._contacted_server:
                raise
            self.simulated = True
            return desired
        if response.status_code == 404:
            response = await self._request("POST", "/proxies", json=desired)
            if response.status_code == 409:
                response = await self._request("GET", self.proxy_path)
        response.raise_for_status()
        proxy = response.json()
        if proxy.get("listen") != desired["listen"] or proxy.get("upstream") != desired["upstream"]:
            raise ValueError("Existing inventory proxy has different listen/upstream settings")
        if not proxy.get("enabled", False):
            response = await self._request("POST", self.proxy_path, json={"enabled": True})
            response.raise_for_status()
            proxy = response.json()
        return proxy

    async def _inject(self, kind: str, attributes: dict[str, int], toxicity: float = 1.0) -> dict[str, Any]:
        toxic = {"name": "failurelab_" + kind, "type": kind, "stream": "downstream",
                 "toxicity": toxicity, "attributes": attributes}
        if self.simulated:
            self._fake_toxics[toxic["name"]] = toxic
            return toxic
        response = await self._request("POST", self.proxy_path + "/toxics", json=toxic)
        response.raise_for_status()
        return response.json()

    async def inject_latency_toxic(self, latency_ms: int, jitter_ms: int = 0) -> dict[str, Any]:
        if latency_ms < 0 or jitter_ms < 0:
            raise ValueError("Latency and jitter must be nonnegative")
        return await self._inject("latency", {"latency": latency_ms, "jitter": jitter_ms})

    async def inject_timeout_toxic(self, timeout_ms: int) -> dict[str, Any]:
        if timeout_ms < 0:
            raise ValueError("Timeout must be nonnegative")
        return await self._inject("timeout", {"timeout": timeout_ms})

    async def inject_reset_peer_toxic(self, toxicity: float = 1.0) -> dict[str, Any]:
        if not 0 <= toxicity <= 1:
            raise ValueError("Toxicity must be a fraction in [0, 1]")
        return await self._inject("reset_peer", {"timeout": 0}, toxicity)

    async def inject_bandwidth_toxic(self, rate_kbps: int) -> dict[str, Any]:
        if rate_kbps <= 0:
            raise ValueError("Bandwidth must be positive")
        return await self._inject("bandwidth", {"rate": rate_kbps})

    async def clear_all_toxics(self) -> None:
        """Remove toxics only from the inventory proxy, not unrelated proxies."""
        if self.simulated:
            self._fake_toxics.clear()
            return
        response = await self._request("GET", self.proxy_path + "/toxics")
        if response.status_code == 404:
            return
        response.raise_for_status()
        failures = []
        for toxic in response.json():
            try:
                result = await self._request("DELETE", self.proxy_path + "/toxics/" + quote(toxic["name"], safe=""))
                if result.status_code != 404:
                    result.raise_for_status()
            except Exception as exc:
                failures.append(exc)
        if failures:
            raise RuntimeError("Could not remove all inventory toxics") from failures[0]

    async def healthy(self) -> bool:
        if self.simulated:
            return True
        try:
            response = await self._request("GET", "/version")
            response.raise_for_status()
            return True
        except Exception:
            return False
