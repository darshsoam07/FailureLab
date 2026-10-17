"""Process-local, bounded synthetic order traffic with monotonic pacing."""

import asyncio
from uuid import uuid4

import httpx
from pydantic import Field

from services.common.schemas import Schema


class TrafficToggle(Schema):
    enabled: bool = Field(strict=True)
    requests_per_second: int = Field(default=1, ge=1, le=10, strict=True)


class TrafficStatus(Schema):
    active: bool
    requests_per_second: int
    total_orders_sent: int
    accepted_orders: int
    failed_requests: int
    in_flight: int
    skipped_requests: int


class TrafficGenerator:
    SKUS = ("SKU-LAPTOP", "SKU-PHONE", "SKU-SERVER")

    def __init__(self, client: httpx.AsyncClient, order_api_url: str, *,
                 timeout_seconds: float = 2, max_in_flight: int = 25):
        if timeout_seconds <= 0 or max_in_flight < 1:
            raise ValueError("Timeout and concurrency must be positive")
        self.client = client
        self.url = order_api_url.rstrip("/") + "/api/orders"
        self.timeout_seconds = timeout_seconds
        self.max_in_flight = max_in_flight
        self.rps = 1
        self.sent = self.accepted = self.failed = self.skipped = 0
        self._enabled = False
        self._closed = False
        self._task: asyncio.Task | None = None
        self._pending: set[asyncio.Task] = set()
        self._changed = asyncio.Event()
        self._lock = asyncio.Lock()

    def status(self) -> TrafficStatus:
        return TrafficStatus(
            active=self._enabled and self._task is not None and not self._task.done(),
            requests_per_second=self.rps, total_orders_sent=self.sent,
            accepted_orders=self.accepted, failed_requests=self.failed,
            in_flight=len(self._pending), skipped_requests=self.skipped,
        )

    async def configure(self, body: TrafficToggle) -> TrafficStatus:
        async with self._lock:
            if self._closed:
                raise RuntimeError("Traffic generator is shut down")
            self.rps = body.requests_per_second
            self._enabled = body.enabled
            self._changed.set()
            if body.enabled:
                if self._task is None or self._task.done():
                    self._task = asyncio.create_task(self._run(), name="synthetic-order-traffic")
            elif self._task is not None:
                await self._task
                self._task = None
            return self.status()

    async def close(self) -> None:
        async with self._lock:
            self._closed = True
            self._enabled = False
            self._changed.set()
            if self._task is not None:
                await self._task
                self._task = None

    async def _send(self) -> None:
        sequence = self.sent
        self.sent += 1
        try:
            # Outer deadline bounds total wall time, including streaming responses.
            async with asyncio.timeout(self.timeout_seconds):
                response = await self.client.post(self.url, json={
                    "customer_id": f"traffic-{uuid4()}",
                    "sku": self.SKUS[sequence % len(self.SKUS)], "quantity": 1,
                }, timeout=self.timeout_seconds)
                response.raise_for_status()
            self.accepted += 1
        except (httpx.HTTPError, TimeoutError):
            # No retries: a timeout can occur after the order was committed.
            self.failed += 1

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time()
        try:
            while self._enabled:
                self._changed.clear()
                delay = max(0, deadline - loop.time())
                if delay:
                    try:
                        await asyncio.wait_for(self._changed.wait(), timeout=delay)
                        deadline = loop.time() + 1 / self.rps
                        continue
                    except TimeoutError:
                        pass
                if not self._enabled:
                    break
                if len(self._pending) < self.max_in_flight:
                    task = asyncio.create_task(self._send(), name="synthetic-order-request")
                    self._pending.add(task)
                    task.add_done_callback(self._pending.discard)
                else:
                    self.skipped += 1
                # Never catch up missed slots with a burst after a stalled event loop.
                deadline = max(deadline + 1 / self.rps, loop.time() + 1 / self.rps)
        finally:
            if self._pending:
                await asyncio.gather(*tuple(self._pending), return_exceptions=True)
