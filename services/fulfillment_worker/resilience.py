"""Concurrent circuit breaker and bounded HTTP retries for inventory calls."""

from services.common.authorization import internal_headers

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import TypeVar
from uuid import UUID

import httpx
from tenacity import AsyncRetrying, RetryCallState, retry_if_exception, stop_after_attempt, wait_random_exponential

T = TypeVar("T")


class CircuitState(StrEnum):
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


class CircuitBreakerOpen(Exception):
    """The dependency is unavailable or a recovery probe is already in flight."""


class InventoryProtocolError(Exception):
    """Inventory returned an invalid success response."""


class CircuitBreaker:
    """Count consecutive failed logical calls, permitting one half-open probe.

Generation tokens prevent stale concurrent results from closing a newly opened
circuit. Cancellation releases the probe without counting as dependency failure.
"""

    def __init__(self, failure_threshold: int = 5, recovery_seconds: float = 10,
                 *, clock: Callable[[], float] = time.monotonic):
        if failure_threshold < 1 or recovery_seconds <= 0:
            raise ValueError("Circuit breaker limits must be positive")
        self.failure_threshold = failure_threshold
        self.recovery_seconds = recovery_seconds
        self._clock = clock
        self._lock = asyncio.Lock()
        self._state = CircuitState.CLOSED
        self._failures = 0
        self._generation = 0
        self._opened_at = 0.0

    async def snapshot(self) -> dict[str, str | int | float]:
        async with self._lock:
            return {
                "state": self._state.value,
                "consecutive_failures": self._failures,
                "retry_after_seconds": max(0.0, self.recovery_seconds - (self._clock() - self._opened_at))
                if self._state == CircuitState.OPEN else 0.0,
            }

    async def _acquire(self) -> int:
        async with self._lock:
            if self._state == CircuitState.OPEN:
                if self._clock() - self._opened_at < self.recovery_seconds:
                    raise CircuitBreakerOpen()
                self._state = CircuitState.HALF_OPEN
                self._generation += 1
            elif self._state == CircuitState.HALF_OPEN:
                raise CircuitBreakerOpen()
            return self._generation

    async def _finish(self, generation: int, success: bool | None) -> None:
        async with self._lock:
            if generation != self._generation:
                return
            if success is True:
                self._failures = 0
                if self._state == CircuitState.HALF_OPEN:
                    self._state = CircuitState.CLOSED
                    self._generation += 1
            elif success is False:
                self._failures += 1
                if self._state == CircuitState.HALF_OPEN or self._failures >= self.failure_threshold:
                    self._open()
            elif self._state == CircuitState.HALF_OPEN:
                self._open()

    def _open(self) -> None:
        self._state = CircuitState.OPEN
        self._opened_at = self._clock()
        self._generation += 1

    async def call(self, operation: Callable[[], Awaitable[T]], *,
                   is_failure: Callable[[Exception], bool] | None = None) -> T:
        generation = await self._acquire()
        try:
            result = await operation()
        except asyncio.CancelledError:
            await self._finish(generation, None)
            raise
        except Exception as exc:
            await self._finish(generation, not (is_failure(exc) if is_failure else True))
            raise
        else:
            await self._finish(generation, True)
            return result


def is_transient(exc: BaseException) -> bool:
    return isinstance(exc, httpx.TransportError) or (
        isinstance(exc, httpx.HTTPStatusError)
        and (exc.response.status_code in (408, 429) or exc.response.status_code >= 500)
    )


@dataclass
class RetryStats:
    http_attempts: int = 0
    retry_count: int = 0


class InventoryClient:
    def __init__(self, client: httpx.AsyncClient, proxy_url: str, breaker: CircuitBreaker,
                 *, timeout_seconds: float = 1.5, max_attempts: int = 3,
                 backoff_multiplier: float = 0.1, backoff_max: float = 0.5):
        if not 0 < timeout_seconds <= 1.5 or not 1 <= max_attempts <= 3:
            raise ValueError("HTTP timeout must be <=1.5 seconds and attempts <=3")
        if backoff_multiplier <= 0 or backoff_max <= 0:
            raise ValueError("Retry backoff must be positive")
        self.client = client
        self.url = proxy_url.rstrip("/") + "/api/inventory/reserve"
        self.breaker = breaker
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max_attempts
        self.backoff_multiplier = backoff_multiplier
        self.backoff_max = backoff_max
        self.stats = RetryStats()

    def _before_attempt(self, state: RetryCallState) -> None:
        self.stats.http_attempts += 1
        if state.attempt_number > 1:
            self.stats.retry_count += 1

    async def reserve(self, order_id: UUID, sku: str, quantity: int) -> None:
        async def operation() -> None:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.max_attempts),
                wait=wait_random_exponential(multiplier=self.backoff_multiplier, max=self.backoff_max),
                retry=retry_if_exception(is_transient),
                before=self._before_attempt,
                reraise=True,
            ):
                with attempt:
                    try:
                        # HTTPX limits individual I/O phases. This outer deadline
                        # also caps the whole request, including slow streaming.
                        async with asyncio.timeout(self.timeout_seconds):
                            response = await self.client.post(
                                self.url,
                                json={"order_id": str(order_id), "sku": sku, "quantity": quantity},
                                headers={**internal_headers(), "X-Idempotency-Key": str(order_id)},
                                timeout=httpx.Timeout(self.timeout_seconds),
                                follow_redirects=False,
                            )
                    except TimeoutError as exc:
                        raise httpx.TimeoutException("Inventory request deadline exceeded") from exc
                    response.raise_for_status()
                    try:
                        payload = response.json()
                        if not isinstance(payload, dict) or payload.get("status") != "RESERVED" or payload.get("order_id") != str(order_id):
                            raise InventoryProtocolError("Invalid reservation response")
                    except ValueError as exc:
                        raise InventoryProtocolError("Invalid reservation JSON") from exc

        await self.breaker.call(
            operation,
            is_failure=lambda exc: is_transient(exc) or isinstance(exc, InventoryProtocolError),
        )


def error_reason(exc: Exception) -> str:
    if isinstance(exc, CircuitBreakerOpen):
        return "CircuitBreakerOpen"
    if isinstance(exc, httpx.TimeoutException):
        return "TimeoutException"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP_{exc.response.status_code}"
    return type(exc).__name__
