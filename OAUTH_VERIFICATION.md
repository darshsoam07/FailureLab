# OAuth implementation verification

## Results

- Python: **193 passed, 2 skipped**. The two existing infrastructure recovery
  tests require `FAILURELAB_INTEGRATION_TESTS=1`; this run did not enable them.
- Frontend: **89 passed**.
- Vite production build: passed. Main JS: 282.63 kB / 88.20 kB gzip;
  lazy chart chunk: 356.22 kB / 103.43 kB gzip; CSS: 55.66 kB / 10.71 kB gzip.
- `git diff --check`: passed.
- No lint or typecheck scripts are configured.
- Local PostgreSQL: migration v1 applied, rerun idempotently; duplicate external
  identities rejected by the database. Temporary verification account rolled back.
- Google/GitHub HTTP responses and Google RSA signing keys were mocked in tests.
  No real provider login, consent, browser callback, or SMTP delivery was tested.
- No push, deployment, billing changes, or production infrastructure changes.
  The stale local controller was restarted and its readiness is healthy with
  `toxiproxy_mode=real`. Other backend services were not restarted in this follow-up;
  they still need the documented environment and restart for their new checks.

## Security coverage

Tests cover new/returning users for each provider, password login, verified private
GitHub email, missing verified email, Google issuer/audience/expiry/nonce checks,
invalid code, mismatched/expired/missing state, cancelled consent, identity
collisions, explicit linking, expired linking session, concurrent duplicate
handling, session restoration, logout, anonymous denial, viewer/operator/internal
permissions, worker-stats access, and callback query redaction.

Normal sessions remain HttpOnly and SameSite=Strict. HTTPS OAuth requires secure
cookies. The temporary callback-binding cookie is HttpOnly and SameSite=Lax.
Provider tokens are not persisted. Account matching uses stable provider IDs;
email equality alone never links accounts. A server-only service token is a
privileged machine credential and must remain private.

## Files added

- `.env.example`, `OAUTH_SETUP.md`, `OAUTH_VERIFICATION.md`
- `scripts/auth_admin.py`
- `services/common/auth_migrations.py`
- `services/common/authorization.py`
- `services/common/safe_access_log.py`
- `services/experiment_controller/oauth.py`
- `tests/test_oauth.py`

## Files updated

- `README.md`, `pyproject.toml`, `scripts/verify_live.py`
- `services/common/models.py`, `services/common/schemas.py`
- `services/experiment_controller/auth.py`, `main.py`, `requirements.txt`, `watchdog.py`
- `services/order_api/main.py`, `services/inventory_service/main.py`
- `services/fulfillment_worker/resilience.py`, `worker.py`
- `services/frontend/README.md`, `AUTHENTICATION.md`
- `services/frontend/src/api/auth.js`, `client.js`
- `services/frontend/src/components/auth/AuthPortal.jsx`, `AuthenticatedApp.jsx`, `auth.css`
- `services/frontend/tests/auth.test.js`, `render.test.js`
- `tests/test_auth.py`, `test_experiment_controller.py`, `test_fulfillment_worker.py`,
  `test_inventory_service.py`, `test_order_api.py`, `test_traffic_gen.py`

Facebook's button, icon, color token, request schema, and mock endpoint are removed.
Existing demo user rows are preserved but cannot sign in. Negative tests still
mention removed providers/endpoints to verify rejection.

## Remaining setup

Follow [OAUTH_SETUP.md](OAUTH_SETUP.md): create the two OAuth applications, register
their exact same-origin proxy callbacks, set provider secrets and internal service
credentials, restart services, grant operator access only to trusted accounts, and
perform the live browser checklist. Ordinary users remain viewers. No real OAuth
success is claimed by these automated results.

## Disabled-provider follow-up

Confirmed live before repair: config lacked `providers`, Google start returned 404.
Confirmed after restart: both providers report `missing_settings`, specifically
only their client ID/secret; both start routes return 503; anonymous experiment
start returns 401. The root ignored `.env` now contains consistent local URLs and
empty credential fields. It is ignored by Git; no private credentials were supplied.
The same readiness JSON was verified through Vite at
`http://127.0.0.1:5173/controller-api/api/auth/config`, confirming the frontend
proxy reaches the updated controller.

Additional changes: `services/common/config.py`, `authorization.py`, controller
`auth.py`/`oauth.py`, `AuthPortal.jsx`, `api/auth.js`, new
`src/lib/providerReadiness.js`, new `tests/providerReadiness.test.js`, updated OAuth
tests, and `tests/conftest.py` to isolate private dotenv configuration from unit tests.
No additional schema change was needed. No account data was deleted.

Google: **implemented but awaiting credentials**.
GitHub: **implemented but awaiting credentials**.

Browser rendering and real OAuth consent/callbacks were not manually tested.
The recorded live checks are HTTP API calls, not browser verification.
