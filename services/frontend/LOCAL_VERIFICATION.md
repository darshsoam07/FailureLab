# Local verification checklist (PowerShell)

Prerequisites: Python 3.11+, Node 22.12+, a running PostgreSQL instance with an
empty FailureLab database and DDL privileges, a running RabbitMQ instance with
an accessible vhost, and the native Toxiproxy server executable on PATH.
Use a dedicated local test database. No containers are required.
Install Toxiproxy from its [official releases](https://github.com/Shopify/toxiproxy/releases).

## 1. Install once, from the repository root

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e '.[test]' -r services/order_api/requirements.txt -r services/experiment_controller/requirements.txt -r services/ai_worker/requirements.txt
npm.cmd --prefix services/frontend ci
```

## 2. Shared environment

Run this block in **each backend terminal**, from the repository root. The
addresses and ports below are local example environment values, not application
constants; change them together if occupied. Supply your real DSNs at the prompts
(URL-encode reserved characters in credentials). Use the same database and vhost
in every terminal. Do not commit secrets.

```powershell
$env:DATABASE_URL = Read-Host 'PostgreSQL DSN (postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE)'
$env:RABBITMQ_URL = Read-Host 'RabbitMQ DSN (amqp://USER:PASSWORD@HOST:PORT/VHOST; encode / as %2F)'
$env:USE_MOCK_AI = 'true'
$env:LOG_LEVEL = 'INFO'
$env:UVICORN_HOST = '127.0.0.1'
$env:ORDER_API_URL = 'http://127.0.0.1:8000'
$env:INVENTORY_API_URL = 'http://127.0.0.1:8001'
$env:INVENTORY_PROXY_URL = 'http://127.0.0.1:8475'
$env:TOXIPROXY_API_URL = 'http://127.0.0.1:8474'
$env:TOXIPROXY_LISTEN = '127.0.0.1:8475'
$env:TOXIPROXY_UPSTREAM = '127.0.0.1:8001'
$env:TOXIPROXY_PROXY_NAME = 'inventory_proxy'
$env:TOXIPROXY_TEST_FALLBACK = 'false'
$env:WORKER_HOST = '127.0.0.1'
$env:WORKER_PORT = '8002'
# Five consumers allow the demo to sustain 5 RPS during a 450ms latency injection.
$env:WORKER_PREFETCH_COUNT = '5'
```

Mock AI requires no LLM key. The local upstream override is essential: the
container-style hostname `inventory-service` does not resolve on a normal host.

## 3. Start each process in a separate terminal

Toxiproxy terminal (no Python environment required):

```powershell
$env:TOXIPROXY_HOST = '127.0.0.1'
$env:TOXIPROXY_PORT = '8474'
toxiproxy-server -host $env:TOXIPROXY_HOST -port $env:TOXIPROXY_PORT
```

The `-host` and `-port` flags are defined by the
[official Toxiproxy server CLI](https://github.com/Shopify/toxiproxy/blob/main/cmd/server/server.go).

After the shared environment block, run one command pair per terminal:

```powershell
# Order API (creates tables and seeds inventory)
$env:UVICORN_PORT = '8000'
.\.venv\Scripts\python.exe -m uvicorn services.order_api.main:app
```

```powershell
# Inventory Service
$env:UVICORN_PORT = '8001'
.\.venv\Scripts\python.exe -m uvicorn services.inventory_service.main:app
```

```powershell
# Fulfillment Worker and its health API
$env:UVICORN_PORT = $env:WORKER_PORT
.\.venv\Scripts\python.exe -m uvicorn services.fulfillment_worker.worker:app
```

```powershell
# Experiment Controller
$env:UVICORN_PORT = '8003'
.\.venv\Scripts\python.exe -m uvicorn services.experiment_controller.main:app
```

```powershell
# AI Analysis Worker and its health API
$env:UVICORN_PORT = '8004'
.\.venv\Scripts\python.exe -m uvicorn services.ai_worker.main:app
```

Use one process for each service, without `--reload` or multiple Uvicorn workers.
In a verification terminal, configure the shared environment and initialize the
inventory proxy **before enabling traffic** (the controller otherwise creates it
only when an experiment starts):

```powershell
.\.venv\Scripts\python.exe -c 'import asyncio, httpx; from services.experiment_controller.toxiproxy_client import ToxiproxyClient; exec("async def setup():\n    async with httpx.AsyncClient() as client:\n        print(await ToxiproxyClient(client).ensure_proxy_exists())"); asyncio.run(setup())'
$env:CONTROLLER_API_URL = 'http://127.0.0.1:8003'
$env:AI_WORKER_API_URL = 'http://127.0.0.1:8004'
$env:WORKER_API_URL = 'http://127.0.0.1:8002'
@($env:ORDER_API_URL, $env:INVENTORY_API_URL, $env:WORKER_API_URL, $env:CONTROLLER_API_URL, $env:AI_WORKER_API_URL) | ForEach-Object { Invoke-RestMethod "$_/ready" | ConvertTo-Json -Depth 6 }
```

All readiness responses must succeed; controller `toxiproxy_mode` must be `real`.

## 4. Start the frontend in another terminal

```powershell
Set-Location services/frontend
$env:VITE_ORDER_API_URL = '/order-api'
$env:VITE_CONTROLLER_API_URL = '/controller-api'
$env:ORDER_API_UPSTREAM = 'http://127.0.0.1:8000'
$env:CONTROLLER_API_UPSTREAM = 'http://127.0.0.1:8003'
$env:FRONTEND_HOST = '127.0.0.1'
$env:FRONTEND_PORT = '5173'
npm.cmd run dev
```

Open the Local URL printed by Vite. Its proxy avoids browser CORS issues.

## 5. Exercise the complete flow

- Enable **Background Traffic** at 5 RPS. Confirm attempts, successes, and chart
  samples increase. Wait for successful fulfillment before injecting faults.
- Launch **Latency Spike**: 450ms latency, 50ms jitter, 60s duration, 10% error
  ceiling, 200ms P95 ceiling. Observe the fault highlight and latency increase.
  After three breached watchdog samples, expect `ABORTED_SLO_BREACH`; the rolling
  window can delay the first breach. Open that history row and wait for its AI
  report. Confirm evidence, confidence, recommended fix, and proposed parameters.
- Click **Run AI's Next Proposed Experiment** once; confirm a new RUNNING row
  with the displayed inherited SLO limits. Use **EMERGENCY ABORT / KILL SWITCH**.
  Expect `COMPLETED / STOPPED`, reason `MANUAL_STOP`, and cleared fault state.
- After the 60-second metrics window clears, launch a 15-second 0ms latency / 0ms
  jitter experiment with a generous P95 ceiling. Confirm normal `COMPLETED`
  without a stop reason, then inspect its report.
- Disable traffic. Confirm attempts stop increasing after in-flight requests
  drain. Stop any active experiment before terminating service terminals.

Optional API inspection, from the configured verification terminal:

```powershell
Invoke-RestMethod "$env:ORDER_API_URL/api/orders/metrics-summary"
Invoke-RestMethod "$env:CONTROLLER_API_URL/api/traffic/status"
Invoke-RestMethod "$env:WORKER_API_URL/worker-stats"
Invoke-RestMethod "$env:TOXIPROXY_API_URL/proxies/$env:TOXIPROXY_PROXY_NAME/toxics"
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix services/frontend test
npm.cmd --prefix services/frontend run build
```

After cleanup, the toxics response should be an empty array. HTTP 503 injection
is cleared separately by the controller. These are verification instructions;
unit tests and a frontend build alone do not prove real-service integration.
