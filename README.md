# FailureLab

**An AI-assisted reliability experiment platform for distributed Python services.**

FailureLab makes reliability behavior visible: generate order traffic, inject a controlled downstream fault, observe latency and errors, and let deterministic SLO guardrails stop the experiment. An AI analysis worker then turns the recorded timeline into an evidence-backed post-mortem and proposes a follow-up experiment for the user to launch.

The React dashboard brings together live telemetry, a topology view, traffic controls, an emergency kill switch, experiment history, and AI reports.

**Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, asyncpg, PostgreSQL, Pydantic v2, pydantic-settings, RabbitMQ, aio-pika, httpx, tenacity, Toxiproxy, React, Vite, Tailwind CSS, Lucide, and Recharts.

## Contents

- [Architecture](#architecture)
- [Reliability primitives](#reliability-primitives)
- [Service map](#service-map)
- [Repository structure](#repository-structure)
- [Run locally](#run-locally)
- [Verification scenario](#verification-scenario)
- [Verified results](#verified-results)
- [AI analysis](#ai-analysis)
- [Tests](#tests)
- [Deployment scope](#deployment-scope)

## Architecture

```mermaid
flowchart LR
    UI[React SRE dashboard] --> Order[Order API]
    UI --> Controller[Experiment Controller]
    Controller -->|Synthetic traffic| Order
    Order -->|Atomic order + outbox write| DB[(PostgreSQL)]
    DB --> Relay[Outbox relay]
    Relay --> MQ[order_fulfillment_queue]
    MQ --> Worker[Fulfillment Worker]
    Worker --> Proxy[Toxiproxy fault point]
    Proxy --> Inventory[Inventory Service]
    Inventory -->|Idempotent reservation| DB
    Worker -->|Order outcome| DB
    Controller -->|Inject / clear faults| Proxy
    Controller -->|Poll experiment-scoped metrics| Order
    Controller -->|Snapshots and experiment state| DB
    Controller --> AnalysisQueue[ai_analysis_queue]
    AnalysisQueue --> AI[AI Analysis Worker]
    AI -->|Read timeline / save report| DB
```

1. The Order API commits a `PENDING` order and its outbox event together.
2. The relay publishes the event to RabbitMQ. The fulfillment worker reserves inventory through Toxiproxy using the order UUID as its idempotency key.
3. The worker records the outcome and latency, including outbox and queue residence time.
4. The controller injects an allowlisted fault and monitors the experiment's SLOs. Three consecutive threshold breaches trigger cleanup and `ABORTED_SLO_BREACH`.
5. After completion or abort, the AI worker persists a report. Proposed experiments remain advisory until the user launches them.

## Reliability primitives

| Pattern | Implementation | Failure addressed |
|---|---|---|
| Transactional outbox | Order and outbox event share one PostgreSQL transaction; the relay uses `FOR UPDATE SKIP LOCKED`, persistent messages, and publisher confirmations. | Database/broker dual-write inconsistency. |
| Idempotent reservations | `X-Idempotency-Key` is checked and recorded atomically with stock deduction. | Duplicate stock deductions after retries or message redelivery. |
| Bounded retries | At most three inventory HTTP attempts, a 1.5-second request deadline, and exponential backoff with jitter. | Unbounded retry amplification against a slow dependency. |
| Circuit breaker | `CLOSED`, `OPEN`, and `HALF_OPEN` states gate inventory calls. | Repeated calls to an unhealthy downstream service. |
| Supervised consumers | Robust connections with one supervisor owning queue/consumer registration, teardown, and recovery. Readiness checks task and channel health. | Abandoned consumers, duplicate registrations, and workers appearing ready after consumption stops. |
| Responsive outbox relay | Idle polling defaults to 50ms; available batches drain immediately. | Avoidable queueing delay before fulfillment. |
| Isolated SLO telemetry | Metrics support `since` and `window_seconds`; watchdog queries exclude orders created before the experiment started. | Cold-start or previous-experiment latency contaminating the current experiment. |
| Deterministic safety guardrail | Error-rate or P95 breaches across three consecutive snapshots clear faults and abort the experiment. | An experiment continuing past its configured safety limits. |
| Structured AI diagnostics | Validated report schema, allowlisted proposals, and deterministic fallback analysis. | Unusable provider responses and analysis failures during offline development or provider outages. |

Outbox delivery is **at least once**: publication can succeed before the processed flag commits. Idempotency handles redelivery; the system does not claim exactly-once message transport.

## Service map

Ports below are the local verification configuration, supplied through environment variables.

| Service | Module / executable | Local port | Operational endpoints |
|---|---|---:|---|
| Order API | `services.order_api.main:app` | 8000 | `/health`, `/ready`, `/api/orders/metrics-summary` |
| Inventory Service | `services.inventory_service.main:app` | 8001 | `/health`, `/ready` |
| Fulfillment Worker | `services.fulfillment_worker.worker:app` | 8002 | `/health`, `/ready`, `/worker-stats` |
| Experiment Controller | `services.experiment_controller.main:app` | 8003 | `/health`, `/ready`, `/api/traffic/status` |
| AI Analysis Worker | `services.ai_worker.main:app` | 8004 | `/health`, `/ready` |
| Toxiproxy | `toxiproxy-server` | 8474 API / 8475 proxy | `/version`, `/proxies/inventory_proxy/toxics` |
| React dashboard | `services/frontend` | 5173 | `/` |
| PostgreSQL | Local backing service | 5432 | Database `failurelab` |
| RabbitMQ | Local backing service | 5672 | Vhost `/` |

Every Python service exposes separate liveness and readiness endpoints. Readiness checks are service-specific; a healthy HTTP client alone does not prove that every downstream request will succeed. The controller must report `toxiproxy_mode: "real"` for a real fault-injection run.

## Repository structure

```text
FailureLab/
├── README.md
├── pyproject.toml
├── scripts/
│   └── verify_live.py                 # HTTP scenario, baseline assertions, evidence capture
├── services/
│   ├── common/
│   │   ├── config.py                 # Shared environment settings
│   │   ├── database.py               # Async engine, sessions, table initialization
│   │   ├── consumer.py               # Shared AMQP consumer supervisor
│   │   ├── models.py                 # Orders, outbox, inventory, experiments, reports
│   │   └── schemas.py                # Pydantic request and response contracts
│   ├── order_api/                    # Order ingestion, metrics, outbox relay
│   ├── inventory_service/            # Stock reservations and HTTP fault injection
│   ├── fulfillment_worker/           # Fulfillment, retries, circuit breaker
│   ├── experiment_controller/        # Catalog, Toxiproxy client, watchdog, traffic
│   ├── ai_worker/                    # Structured analysis and report persistence
│   └── frontend/
│       ├── src/                      # Dashboard, API client, interactive components
│       ├── tests/                    # Frontend contract and validation tests
│       └── LOCAL_VERIFICATION.md     # Detailed PowerShell runbook
└── tests/                            # Python unit and infrastructure integration tests
```

Local verification generates evidence under `.logs/verification-fixed/`. Those files are runtime artifacts, not prerequisites for a fresh checkout.

## Run locally

### Prerequisites

- Python 3.11+ and Node.js 22.12+.
- PostgreSQL with a dedicated `failurelab` database and table-creation privileges.
- RabbitMQ with an accessible vhost.
- `toxiproxy-server` installed and available on `PATH`.

The recorded run used PostgreSQL 17, RabbitMQ 4, and Toxiproxy 2.13.0. Backing services may run natively or in your own containers. Infrastructure provisioning is managed separately.

### Install dependencies

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.[test]' -r services/order_api/requirements.txt -r services/inventory_service/requirements.txt -r services/fulfillment_worker/requirements.txt -r services/experiment_controller/requirements.txt -r services/ai_worker/requirements.txt
npm.cmd --prefix services/frontend ci
```

### Configure the backend

Set these variables in each backend terminal, or source them from a private local PowerShell file. These are localhost development values; credentials must match your backing services.

```powershell
$env:DATABASE_URL = 'postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/failurelab'
$env:RABBITMQ_URL = 'amqp://guest:guest@127.0.0.1:5672/%2F'
$env:USE_MOCK_AI = 'true'
$env:LOG_LEVEL = 'INFO'
$env:UVICORN_HOST = '127.0.0.1'
$env:ORDER_API_URL = 'http://127.0.0.1:8000'
$env:INVENTORY_API_URL = 'http://127.0.0.1:8001'
$env:CONTROLLER_API_URL = 'http://127.0.0.1:8003'
$env:INVENTORY_PROXY_URL = 'http://127.0.0.1:8475'
$env:TOXIPROXY_API_URL = 'http://127.0.0.1:8474'
$env:TOXIPROXY_HOST = '127.0.0.1'
$env:TOXIPROXY_PORT = '8474'
$env:TOXIPROXY_LISTEN = '127.0.0.1:8475'
$env:TOXIPROXY_UPSTREAM = '127.0.0.1:8001'
$env:TOXIPROXY_PROXY_NAME = 'inventory_proxy'
$env:TOXIPROXY_TEST_FALLBACK = 'false'
$env:WORKER_HOST = '127.0.0.1'
$env:WORKER_PORT = '8002'
$env:WORKER_PREFETCH_COUNT = '5'
```

Backend application settings use `pydantic-settings`. Uvicorn and Toxiproxy receive their bind configuration through their respective environment/CLI interfaces. Mock AI needs no API key.

### Start the stack

Run each block in a separate terminal with the shared environment loaded. Start the Order API first so tables and inventory are initialized. Use one process per service, without `--reload` or multiple Uvicorn workers for this local scenario.

```powershell
# Toxiproxy
toxiproxy-server -host $env:TOXIPROXY_HOST -port $env:TOXIPROXY_PORT
```

```powershell
# Order API
$env:UVICORN_PORT = '8000'
.\.venv\Scripts\python.exe -m uvicorn services.order_api.main:app
```

```powershell
# Inventory Service
$env:UVICORN_PORT = '8001'
.\.venv\Scripts\python.exe -m uvicorn services.inventory_service.main:app
```

```powershell
# Fulfillment Worker
$env:UVICORN_PORT = $env:WORKER_PORT
.\.venv\Scripts\python.exe -m uvicorn services.fulfillment_worker.worker:app
```

```powershell
# Experiment Controller
$env:UVICORN_PORT = '8003'
.\.venv\Scripts\python.exe -m uvicorn services.experiment_controller.main:app
```

```powershell
# AI Analysis Worker
$env:UVICORN_PORT = '8004'
.\.venv\Scripts\python.exe -m uvicorn services.ai_worker.main:app
```

Initialize the proxy **before enabling traffic**, in a configured verification terminal:

```powershell
@'
import asyncio
import httpx
from services.experiment_controller.toxiproxy_client import ToxiproxyClient

async def main():
    async with httpx.AsyncClient() as client:
        print(await ToxiproxyClient(client).ensure_proxy_exists())

asyncio.run(main())
'@ | .\.venv\Scripts\python.exe -

$env:WORKER_API_URL = 'http://127.0.0.1:8002'
$env:AI_WORKER_API_URL = 'http://127.0.0.1:8004'
@($env:ORDER_API_URL, $env:INVENTORY_API_URL, $env:WORKER_API_URL, $env:CONTROLLER_API_URL, $env:AI_WORKER_API_URL) | ForEach-Object {
    Invoke-RestMethod "$_/ready" | ConvertTo-Json -Depth 6
}
```

All five readiness endpoints must return HTTP 200. Verify the controller reports `"toxiproxy_mode": "real"`.

### Start the dashboard

In another terminal, from the repository root:

```powershell
$env:VITE_ORDER_API_URL = '/order-api'
$env:VITE_CONTROLLER_API_URL = '/controller-api'
$env:ORDER_API_UPSTREAM = 'http://127.0.0.1:8000'
$env:CONTROLLER_API_UPSTREAM = 'http://127.0.0.1:8003'
$env:FRONTEND_HOST = '127.0.0.1'
$env:FRONTEND_PORT = '5173'
npm.cmd --prefix services/frontend run dev
```

Open the local URL printed by Vite. Its development proxy routes browser requests to the backend services.

## Verification scenario

With the stack ready and the shared environment configured:

```powershell
.\.venv\Scripts\python.exe scripts/verify_live.py
```

The script performs the following without restarting workers:

1. Enable traffic at 5 RPS, warm up for 20 seconds, and require three baseline samples below 200ms P95 with successful orders and zero failures.
2. Inject 450ms latency with 50ms jitter, a 60-second duration, a 10% error ceiling, and a 200ms P95 ceiling. Require automatic SLO abort, fault P95 above 500ms, and an AI report.
3. Launch the AI proposal, immediately stop it, and verify `MANUAL_STOP` and empty toxics.
4. Immediately run a 15-second zero-latency control with the same 200ms ceiling and require `COMPLETED`.
5. Disable traffic and verify that orders and outbox events drain.

The script saves scenario and AI report JSON under `.logs/verification-fixed/`. It assumes the services are running; it does not launch or stop their processes. After verification, terminate each service gracefully with Ctrl+C. See the [detailed local verification runbook](services/frontend/LOCAL_VERIFICATION.md) for the UI workflow and additional checks.

## Verified results

The local run on **17 October 2026** used real Toxiproxy faults and deterministic AI analysis:

| Check | Recorded result |
|---|---|
| Pre-fault P95 | **107.39279511818513ms** |
| Fault P95, consecutive snapshots | **624.2387749754481ms**, **658.3514599857599ms**, **651.6474999275953ms** |
| Fault experiment | `ABORTED_SLO_BREACH` |
| AI-proposed follow-up | Stopped with `MANUAL_STOP`; toxics `[]` |
| Immediate zero-latency control | `COMPLETED`; maximum snapshot P95 **114.88507501563724ms** |
| Worker restarts / manual recovery | **0**; original worker PIDs and one consumer generation each |
| Orders | **291 reserved**, 0 failed, 0 pending |
| Unprocessed outbox events after drain | **0** |
| Validation | **153 Python tests**, **9 frontend tests**, frontend build passed |
| Shutdown | All six application processes exited gracefully; backing services remained running |

The baseline and immediate control demonstrate telemetry isolation in this run. These are measurements from one development environment, not a universal latency guarantee or production certification. Separate integration tests exercised repeated RabbitMQ transport loss and automatic consumer recovery.

## AI analysis

`USE_MOCK_AI=true` runs deterministic, zero-provider-cost diagnostics over actual experiment data. For live structured analysis, configure `USE_MOCK_AI=false`, `LLM_API_KEY`, `LLM_API_URL`, and `LLM_MODEL`. Provider/network errors and invalid responses fall back to local diagnostics; missing required configuration fails startup.

Reports contain a root-cause summary, confidence score, exact telemetry evidence, a recommended resilience adjustment, and an allowlisted follow-up proposal. This proposal excerpt came from the verified latency experiment:

```json
{
  "fault_type": "LATENCY",
  "suggested_parameters": {
    "jitter_ms": 50,
    "latency_ms": 225
  },
  "rationale": "Vary only the injected delay to locate the SLO boundary after testing the proposed resilience change."
}
```

Schema validation constrains structure; it does not prove causality. Persisted telemetry does not include retry counts or circuit-breaker transitions, so reports identify those mechanisms as unconfirmed. Confidence is a heuristic. See the [AI worker documentation](services/ai_worker/README.md) for provider settings, evidence validation, and fallback behavior.

## Tests

From the repository root after dependency installation:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix services/frontend test
npm.cmd --prefix services/frontend run build
```

To include real PostgreSQL and RabbitMQ regressions, configure the shared DSNs, initialize the database through the Order API, and enable the integration tests:

```powershell
$env:FAILURELAB_INTEGRATION_TESTS = '1'
.\.venv\Scripts\python.exe -m pytest -q
```

Without that flag, infrastructure-dependent tests are skipped. The recorded 153-test pass included them.

## Deployment scope

This repository supplies application services and a local verification workflow. Dockerfiles, Kubernetes manifests, Terraform, and CI/CD configuration are intentionally managed separately.

Future deployment work can add orchestration, queue-based autoscaling, and Prometheus/Grafana instrumentation. Those are roadmap items rather than implemented capabilities. The current local workflow uses one instance per service; validate coordination and lifecycle behavior before extending it to multiple replicas.

## Author

**Darsh Soam** — Cloud & DevOps Engineering · Backend & Distributed Systems  
GitHub: [@darshsoam07](https://github.com/darshsoam07) · [FailureLab](https://github.com/darshsoam07/FailureLab)
