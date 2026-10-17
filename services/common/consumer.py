"""One owner for AMQP consumer generations; never restore abandoned iterators."""

import asyncio
import logging
from collections.abc import Awaitable, Callable

import aio_pika
from aio_pika.abc import AbstractIncomingMessage

logger = logging.getLogger(__name__)


class ConsumerSupervisor:
    def __init__(self, url: str, queue_name: str,
                 handler: Callable[[AbstractIncomingMessage], Awaitable[None]], *,
                 prefetch: int, timeout: float = 10, retry_delay: float = 1,
                 heartbeat: int = 10):
        self.url, self.queue_name, self.handler = url, queue_name, handler
        self.prefetch, self.timeout = prefetch, timeout
        self.retry_delay, self.heartbeat = retry_delay, heartbeat
        self.connection = self.channel = None
        self.active = False
        self.generations = 0
        self._lost = asyncio.Event()
        self._handlers: set[asyncio.Task] = set()

    @property
    def healthy(self) -> bool:
        return bool(self.active and not self._lost.is_set() and self.connection
                    and not self.connection.is_closed and self.connection.connected.is_set()
                    and self.channel and not self.channel.is_closed)

    def _disconnected(self, *_args) -> None:
        self.active = False
        self._lost.set()

    async def _handle(self, message: AbstractIncomingMessage) -> None:
        task = asyncio.current_task()
        self._handlers.add(task)
        try:
            # Late callbacks from a closing generation must not perform work.
            if self._lost.is_set():
                return
            await self.handler(message)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Consumer handler interrupted (%s)", type(exc).__name__)
            self._disconnected()
        finally:
            self._handlers.discard(task)

    async def probe(self) -> bool:
        if not self.healthy:
            return False
        channel = self.channel
        try:
            async with asyncio.timeout(self.timeout):
                queue = await channel.declare_queue(self.queue_name, durable=True, passive=True,
                                                   robust=False, timeout=self.timeout)
            if queue.declaration_result.consumer_count < 1:
                self._disconnected()
            return self.healthy and self.channel is channel
        except Exception:
            self._disconnected()
            return False

    async def _dispose(self) -> None:
        self._disconnected()
        # Roll back in-flight jobs before closing their transport and redelivering.
        while self._handlers:
            tasks = tuple(self._handlers)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        if self.connection is not None:
            # Close cancels connect_robust's reconnect task as well as the transport.
            # Do not create the next generation until the old connection is closed.
            await self.connection.close()
        self.connection = self.channel = None

    async def run(self) -> None:
        while True:
            self._lost = asyncio.Event()
            try:
                async with asyncio.timeout(self.timeout):
                    self.connection = await aio_pika.connect_robust(
                        self.url, timeout=self.timeout, heartbeat=self.heartbeat,
                        reconnect_interval=self.retry_delay,
                    )
                    self.connection.close_callbacks.add(self._disconnected)
                    self.channel = await self.connection.channel()
                    self.channel.close_callbacks.add(self._disconnected)
                    await self.channel.set_qos(prefetch_count=self.prefetch)
                    # The supervisor owns registration. Library restoration must
                    # not resurrect callbacks belonging to a previous generation.
                    queue = await self.channel.declare_queue(self.queue_name, durable=True, robust=False)
                    await queue.consume(self._handle, robust=False, timeout=self.timeout)
                if self._lost.is_set():
                    raise ConnectionError('Channel closed during consumer setup')
                self.generations += 1
                self.active = True
                logger.info("Consumer %s generation %s registered", self.queue_name, self.generations)
                while not self._lost.is_set():
                    try:
                        await asyncio.wait_for(self._lost.wait(), timeout=self.heartbeat)
                    except TimeoutError:
                        # Also detect a cancelled registration while the TCP
                        # transport itself is still open, without external probes.
                        await self.probe()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Consumer %s recovery (%s)", self.queue_name, type(exc).__name__)
            finally:
                await self._dispose()
            await asyncio.sleep(self.retry_delay)
