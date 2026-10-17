# Inventory and fulfillment

From the repository root, install both services with
`python -m pip install -r services/fulfillment_worker/requirements.txt`.
The existing order API requirements are also needed when running the entire test suite.

Configure the shared `BaseAppSettings` environment variables for both services.
The worker and Order API must use the same PostgreSQL database and RabbitMQ
virtual host. Inventory may use its own database, but the Order API's initial
stock seeding then needs to be applied to that inventory database separately.
The default shared database setup uses the three SKUs seeded by the Order API.

Run inventory with `python -m uvicorn services.inventory_service.main:app`,
setting `UVICORN_HOST` and `UVICORN_PORT` in the environment.
For fulfillment, set `WORKER_HOST` to the bind interface and `WORKER_PORT=8002`,
then run `python -m services.fulfillment_worker.worker`. No port is hardcoded.
`INVENTORY_PROXY_URL` must be the HTTP base URL of Toxiproxy's inventory listener.

Reservation accepts `{ "order_id": "<UUID>", "sku": "SKU-PHONE", "quantity": 1 }`
and `X-Idempotency-Key`. Successful first calls and replays return the identical
`{ "order_id": "<UUID>", "status": "RESERVED" }` with HTTP 200. A key reused for
a different order returns 409. Unknown SKU returns 404 and insufficient stock
returns 409; neither deducts stock nor creates a success record. Under the
existing schema the record stores order ID and HTTP status, not a request-body
fingerprint: callers must keep SKU/quantity immutable for a given order/key.
The worker enforces this by checking events against the stored order and always
using the order UUID as the key.

`POST /api/inventory/fault-config` accepts `{ "error_rate_percent": 25 }` to
inject 503 responses for approximately 25% of new reservations. Set it to zero
to disable. Successful cached reservations bypass this fault. The fault state
is in memory, resets on restart, and is local to one process; use one inventory
process per experiment target or configure each replica. Expose this endpoint
only on the internal experiment control network.

Each inventory HTTP attempt has a total deadline of at most 1.5 seconds, including
body reads, in addition to HTTPX phase timeouts. Transient transport failures,
408, 429, and 5xx responses retry up to three attempts with exponential full
jitter. Other HTTP errors fail immediately. Settings can lower these limits:
`HTTP_TIMEOUT_SECONDS`, `HTTP_MAX_ATTEMPTS`,
`RETRY_BACKOFF_MULTIPLIER_SECONDS`, and `RETRY_BACKOFF_MAX_SECONDS`.
The breaker counts exhausted logical calls, not individual attempts; defaults
are five consecutive failures and a ten-second recovery interval, configured
by `CIRCUIT_BREAKER_FAILURE_THRESHOLD` and `CIRCUIT_BREAKER_RECOVERY_SECONDS`.
One recovery probe is allowed at a time. Business rejections do not trip it.

The worker acknowledges only after the order transaction commits. Redelivery
of terminal orders performs no HTTP call. Infrastructure/DB failures requeue;
malformed, missing-order, or mismatched events are rejected without requeue
(routed to a dead-letter exchange only if one is configured externally).
`latency_ms` measures from delivery handling through the reservation outcome,
including retries and order lock waits, before the final DB commit. It excludes
time waiting in RabbitMQ. Timeout after inventory commits can still leave stock
reserved while the worker records FAILED if every response is lost; retries
prevent duplicate deduction but do not provide distributed atomicity.

`/worker-stats` exposes process-lifetime counters, including actual extra HTTP
attempts as `retry_count`, and the current circuit state. `/ready` checks DB,
RabbitMQ, consumer task, and HTTP client, not the faulted downstream inventory;
an intentionally open breaker does not make the worker unready. Inventory
readiness checks its DB. Both services provide dependency-free `/health`.

Install the root test extra and run `python -m pytest` for the local contract and
failure-path suite. Real broker/DB integration requires those configured services.
