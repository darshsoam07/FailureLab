# Experiment Controller

From the repository root:

```powershell
python -m pip install -r services/experiment_controller/requirements.txt
python -m uvicorn services.experiment_controller.main:app
```

Set `UVICORN_HOST` and `UVICORN_PORT` for the API bind address, plus the shared
database/RabbitMQ settings. All controllers for one experiment target must share
the same PostgreSQL database. Additional required environment variables are:

- `ORDER_API_URL`: Order API base URL for metrics.
- `INVENTORY_API_URL`: direct inventory base URL for fault configuration,
  bypassing Toxiproxy so cleanup works during a network fault.

The requested local defaults are exposed through Pydantic settings:
`TOXIPROXY_API_URL=http://localhost:8474`,
`TOXIPROXY_PROXY_NAME=inventory_proxy`, `TOXIPROXY_LISTEN=0.0.0.0:8475`,
and `TOXIPROXY_UPSTREAM=inventory-service:8001`. Override them for your environment.
The worker's `INVENTORY_PROXY_URL` must point to this proxy listener. The shared
settings now use the same requested default for `TOXIPROXY_API_URL`.
`TOXIPROXY_AUTH_TOKEN` optionally supplies a bearer token.

`GET /api/experiments/catalog` returns JSON schemas for validated parameters.
Only `inventory_service` is an allowed target. Example start body:

```json
{
  "name": "Inventory latency experiment",
  "fault_type": "LATENCY",
  "target_service": "inventory_service",
  "parameters": {"latency_ms": 400, "jitter_ms": 50},
  "duration_seconds": 60,
  "slo_max_error_rate": 0.1,
  "slo_max_p95_ms": 500
}
```

Other parameter objects:

| Fault type | Parameters |
| --- | --- |
| `TIMEOUT` | `{"timeout_ms": 0}` (drop data until cleanup) |
| `ERROR_RATE` | `{"mode": "http_503", "error_rate_percent": 25}` |
| `ERROR_RATE` | `{"mode": "reset_peer", "error_rate_percent": 25}` |
| `BANDWIDTH` | `{"rate_kbps": 10}` (kilobytes per second) |

The network toxics affect downstream traffic. Reset probability applies to TCP
links, not individual HTTP requests; use `http_503` for request-level error
injection. These semantics and REST payloads follow the
[official Toxiproxy API](https://github.com/Shopify/toxiproxy#http-api).
HTTP 503 configuration is process-local in the existing Inventory Service;
target one inventory process per experiment, without load balancing that control
URL across independently configured replicas.

The watchdog samples every two seconds while RUNNING, using the Order API's
rolling 60-second metrics. `queue_depth` is the broker's ready-message count,
excluding unacknowledged deliveries. PostgreSQL stores each snapshot before
evaluating the last three snapshots. The predicate is strictly
`error_rate > slo_max_error_rate OR p95_latency_ms > slo_max_p95_ms`.
An equality is safe, a safe snapshot resets the streak, and alternating breached
metrics count because the OR predicate still holds on each snapshot. A third
breach takes precedence over duration completion in the same cycle. Reasons
include each observed breached metric and its threshold.

Starts are serialized across controller processes by a PostgreSQL advisory lock.
A PLANNED intent is committed before injection, and interrupted starts are
cleaned up on recovery. RUNNING experiments resume from persisted snapshots;
monitoring gaps beyond six seconds (or the configured HTTP budget plus four
seconds, whichever is larger) trigger a safety stop. Stop requests bypass the
polling interval and wait only for an in-flight serialized transition. A stale
stop request for an already finished experiment cannot clear a newer fault.

Cleanup removes every toxic on the configured inventory proxy and resets the
inventory HTTP error percentage to zero. Both are attempted even if one fails.
No terminal state is recorded until cleanup succeeds. A failed cleanup leaves
the active record with durable `_controller.phase="cleanup_pending"`, blocks
new experiments, returns 503 for stop, and is retried by the watchdog. If the
database is unavailable, emergency stop still attempts external fault removal;
database finalization waits for recovery. Remote fault removal cannot be
guaranteed while the control endpoints themselves are unreachable.

The existing shared enum is preserved. SLO breaches use `ABORTED_SLO_BREACH`.
Normal duration completion uses `COMPLETED` with a null `abort_reason`.
Manual stops, interrupted starts, controller shutdown, and monitoring failures
use `COMPLETED` with a non-null reason (`MANUAL_STOP`, `START_FAILED: ...`,
`STARTUP_RECOVERY`, `CONTROLLER_SHUTDOWN`, or `SAFETY_STOP_...`). Consumers must
check `abort_reason` before interpreting COMPLETED as a safely completed run.

`Experiment.parameters._controller` stores internal cleanup and event-delivery
state; clients cannot supply that namespace. The existing OutboxEvent cannot
hold experiment events because it has an Order foreign key. A separate notifier
therefore publishes committed pending intents to durable `ai_analysis_queue`
with persistent delivery, publisher confirms, and a stable
`experiment_finished:<UUID>` message ID. It retries after broker failure without
blocking safety checks. Delivery is at least once; the AI service must deduplicate.
The JSON event includes `event_type`, `experiment_id`, `status`, `abort_reason`,
and `ended_at`.

Listing supports `limit` (1–100) and `offset`. Detail responses include ordered
`telemetry_snapshots` and the latest linked `ai_report`, or null if none exists.
`/health` is liveness; `/ready` checks DB, broker, Toxiproxy, tasks, and safety
engine status. Shutdown attempts cleanup before closing clients and connections.

For isolated client tests only, `TOXIPROXY_TEST_FALLBACK=true` permits an in-memory
simulation after an initial connection refusal. It never suppresses HTTP errors,
timeouts, failed mutations, or lost connectivity after real-server contact.
The API exposes simulation in experiment metadata and readiness. Full controller
tests still need mocked DB, broker, metrics, and inventory control endpoints.

Install the root test extra and the other service requirements before running
`python -m pytest`. The local suite exercises contracts, SQL compilation, safety
logic, and failure paths; it does not replace a real PostgreSQL/RabbitMQ/Toxiproxy
integration test.
# Built-in synthetic traffic

`POST /api/traffic/toggle` accepts `{"enabled": true, "requests_per_second": 5}`.
Send `enabled: false` to stop. The integer rate must be 1–10 and defaults to 1
when omitted. Repeated enables update the existing loop rather than creating
another loop. `GET /api/traffic/status` returns `active`, `requests_per_second`,
`total_orders_sent`, `accepted_orders`, `failed_requests`, `in_flight`, and
`skipped_requests`.

Traffic starts disabled and cycles through the three seeded SKUs with quantity
one and unique synthetic customer IDs. It targets the environment's
`ORDER_API_URL`. `TRAFFIC_HTTP_TIMEOUT_SECONDS` defaults to 2 and
`TRAFFIC_MAX_IN_FLIGHT` defaults to 25; traffic has a separate HTTP connection
pool from safety monitoring. Slow requests cannot create an unbounded backlog:
saturated slots are skipped, and missed slots are never replayed in a burst.

`total_orders_sent` counts POST attempts; `accepted_orders` counts successful
HTTP responses. A failed request can still have committed an order before its
response was lost, so traffic requests are never retried. Stop and shutdown
drain outstanding requests within their request deadlines. Counters persist
across toggles but reset on process restart. State is process-local: run one
controller process for the single-click demo; these endpoints do not coordinate
traffic across replicas. Stopping an experiment does not stop synthetic traffic.

