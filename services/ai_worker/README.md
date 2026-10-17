# AI Analysis Worker

From the repository root:

```powershell
python -m pip install -r services/ai_worker/requirements.txt
python -m uvicorn services.ai_worker.main:app
```

Set `UVICORN_HOST` and `UVICORN_PORT` for the bind address and supply the shared
`BaseAppSettings` environment variables. The worker uses the same PostgreSQL
database and RabbitMQ virtual host as the Experiment Controller.

`USE_MOCK_AI=true` is the default. Offline analysis needs no provider endpoint,
model, or key and performs no HTTP calls. It uses the actual fault type, status,
stop reason, timeline, SLOs, and request/queue measurements. Results are deterministic
for the same input, including when snapshots arrive out of order. There is no
artificial sleep or token charge. The target is under 50 ms for ordinary timelines,
not a real-time scheduling guarantee. On the development host, 20 warmed runs
with 1,800 snapshots measured 12.31 ms median and 57.69 ms maximum.

For live analysis, set:

- `USE_MOCK_AI=false`
- `LLM_API_KEY`: provider key, held as a secret setting.
- `LLM_API_URL`: complete OpenAI-compatible **chat completions** endpoint URL,
  including its `/chat/completions` path. No provider address is hardcoded.
- `LLM_MODEL`: a model supporting strict JSON-schema responses.

The HTTP request uses bearer authentication and `response_format.type=json_schema`
with strict schema adherence. This follows the official
[OpenAI structured-output contract](https://developers.openai.com/api/docs/guides/structured-outputs)
and [Gemini OpenAI compatibility interface](https://ai.google.dev/gemini-api/docs/openai#structured-output).
Provider/model compatibility must be checked for the configured deployment.
`LLM_TEMPERATURE` is optional and omitted by default because model support varies.
Schema validation constrains the JSON structure; it does not make live prose
deterministic or prove causal conclusions.

`LLM_TIMEOUT_SECONDS` defaults to 20, with an outer total deadline in addition
to HTTPX phase timeouts. `LLM_MAX_INPUT_BYTES` defaults to 1 MiB and
`LLM_MAX_RESPONSE_BYTES` to 128 KiB. Inputs that exceed the configured budget
fall back locally rather than silently truncating the timeline. One live request
is made per analysis attempt; 429, transport failures, timeouts, other HTTP errors,
refusals, incomplete/invalid responses, changed evidence, and excessive confidence
all fall back to deterministic diagnostics. Cancellation still propagates for
shutdown. Missing required live configuration fails startup rather than hiding
a misconfiguration. No API keys, endpoint URLs, response bodies, or experiment
text are written to application error logs.

`LLMExperimentAnalysis` rejects extra fields, coerced numeric strings, non-finite
scores, and unallowlisted fault proposals. Its nested proposal remains a Python
dict with `fault_type`, `suggested_parameters`, and `rationale`. The parameter
bounds match the controller catalog and are checked against it in tests. Proposals
are advisory; the AI worker never starts experiments or changes resilience settings.

Both modes cite exact timestamps, P95 values, error-rate fractions, request counts,
queue depth, and breach streaks from persisted snapshots. Live evidence must match
the locally verified evidence verbatim. Reports do not sum overlapping 60-second
windows or average snapshot P95s into a request percentile. Empty timelines and
zero observed traffic are inconclusive. COMPLETED with a non-null abort reason
is not presented as successful SLO completion; simulated faults are identified.
Confidence is a conservative heuristic, not a calibrated probability.

The existing TelemetrySnapshot has **no retry counter, circuit-breaker state,
per-request error details, or pre-fault baseline**. Every report states that these
behaviors were not measured. Retry amplification and breaker activation can be
discussed only as hypotheses to instrument and test, never fabricated observations.
An evidence bullet records whether analysis was deterministic, live, or a fallback
and identifies the fallback category without exposing sensitive error details.

The consumer declares durable `ai_analysis_queue`, accepts the controller's
`experiment_finished` JSON envelope, and loads authoritative data from PostgreSQL.
It locks the Experiment row before checking for an existing AIReport, generating
analysis, and inserting the report. Concurrent instances following this protocol
produce one report per experiment; arbitrary external writers must follow the
same lock protocol because the shared schema has no unique experiment-report
constraint. A duplicate event performs no extra provider call after a committed
report. Broker acknowledgement happens only after commit. A lost commit/ack can
cause redelivery; an uncommitted live call may therefore be repeated.

Malformed/oversized events and missing/deleted experiments are rejected without
requeue. Premature events for nonterminal experiments and infrastructure failures
are delayed and requeued. Set `AI_REQUEUE_DELAY_SECONDS` (default 1),
`AI_JOB_TIMEOUT_SECONDS` (default 60), `AI_PREFETCH_COUNT` (default 1), and
`AI_MAX_MESSAGE_BYTES` (default 64 KiB) as needed. The job timeout must exceed
the live-provider timeout, leaving room for fallback and database commit.
One consumer processes jobs sequentially per process; scale with more processes.

`/health` is dependency-free liveness. `/ready` checks PostgreSQL, RabbitMQ, the
consumer task, and the HTTP client lifecycle. It does not make paid provider
calls or become unready merely because deterministic fallback is being used.
Shutdown cancels the consumer before closing the broker, HTTP client, and DB.

Install the root test extra and all service requirements, then run
`python -m pytest`. Provider behavior is tested with HTTPX mock transports;
database and broker lifecycle tests use mocks and PostgreSQL SQL compilation.
The local suite does not replace live provider/PostgreSQL/RabbitMQ integration.
