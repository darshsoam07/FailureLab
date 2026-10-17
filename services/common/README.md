# FailureLab shared package

Install from the repository root with Python 3.11+: `python -m pip install -e ".[test]"`.
Run checks with `python -m pytest`.

Set `DATABASE_URL` (PostgreSQL with the `postgresql+asyncpg` scheme),
`RABBITMQ_URL` (AMQP or AMQPS), `TOXIPROXY_API_URL`, and
`INVENTORY_PROXY_URL` in the process environment. No service addresses or ports
are supplied except the explicitly requested local Toxiproxy API default
(`http://localhost:8474`, overridable by `TOXIPROXY_API_URL`). `USE_MOCK_AI` defaults to true; `LLM_API_KEY` is
required when it is false. `LOG_LEVEL` defaults to INFO. Settings do not
automatically load a dotenv file. Subclass `BaseAppSettings` for later services.

Use `init_db()` in a FastAPI lifespan startup and `close_db()` at shutdown.
The engine and async session factory are lazily cached by `get_engine()` and
`get_session_factory()`. Imports do not require environment configuration or
connect to PostgreSQL. `init_db()` registers all models and creates missing
tables and enums under a PostgreSQL transaction advisory lock, serializing
concurrent startups using this helper. It does not migrate existing tables.

Inject `get_db_session` with FastAPI `Depends`. Explicitly commit successful
units of work (or use `async with session.begin()`). The dependency rolls back
on errors and closes every session; closing rolls back uncommitted changes.
Insert an order and its outbox event in the same transaction. With autoflush
disabled, flush the order before inserting its outbox event to satisfy its FK.

Every model has a `*Create` input and `*Response` output in `schemas.py`.
Inputs omit generated IDs, timestamps, and server-owned lifecycle fields.
Serialize flushed/refreshed ORM instances with `Response.model_validate(row)`.
All timestamps are timezone-aware. Rates and confidence are fractions in [0, 1].
Customer IDs are external strings; telemetry IDs are UUIDs. JSON fields accept
JSON values only; experiment fault parameters remain extensible for later
fault adapters. Replace JSON values as a whole when updating ORM instances;
in-place nested mutations are not automatically tracked by SQLAlchemy.

`response_status` is an HTTP status code. The idempotency key primary key provides
the concurrency uniqueness boundary, but stock deduction and insertion of the
record **must occur in one transaction** in the inventory service. A duplicate
key must return the recorded outcome, and reuse with a different order must be
rejected. The schema alone cannot enforce this workflow. `order_id` deliberately
has no FK in the inventory-owned idempotency table so separate service databases
remain possible. Outbox aggregates reference orders; experiment telemetry and
reports cascade when their experiment is deleted.

`updated_at` is updated by SQLAlchemy-generated inventory updates. Raw SQL writers
must also set it explicitly. This package does not install database triggers.
