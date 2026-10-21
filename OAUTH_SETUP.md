# Google and GitHub authentication

## Architecture and audit

FailureLab already had React authentication forms, PBKDF2 password hashes, and
PostgreSQL `auth_users`, `auth_sessions`, and `password_reset_codes` tables. The
controller issues opaque tokens in HttpOnly, SameSite=Strict cookies; only token
hashes are stored. There was no OAuth library, and the previous social handler
created demo identities. Operational APIs were public.

The implementation retains these forms and sessions. `services/experiment_controller/oauth.py`
uses httpx for authorization-code exchange and S256 PKCE for both providers.
Google ID-token signatures use `PyJWT[crypto]` (the only new direct dependency).
It verifies RS256, issuer, audience, expiry, issued-at presence, nonce, authorized
party, and verified email. GitHub identity uses its stable numeric ID and
`/user/emails` to find a verified email, including private addresses. Scopes are
`openid email profile` and `read:user user:email`.

Tokens from providers are used only during the callback and are not persisted.
State is random, browser-bound, expires in ten minutes, and is consumed once
before token exchange. A separate HttpOnly SameSite=Lax cookie permits the
provider's cross-site GET callback while the session cookie stays Strict.
Callbacks redirect only to the configured frontend URL.

## Additive database migration

Migration v1 in `services/common/auth_migrations.py` creates:

- `auth_provider_identities`: composite primary key `(provider, subject)`.
- `auth_oauth_transactions`: expiring, single-use state and PKCE data.
- `auth_operator_roles`: explicit operator grants, separate from account signup.
- `auth_schema_versions`: migration ledger.

Existing user records and all reliability tables are preserved. No tables or
columns are dropped. The controller applies this migration under its existing
PostgreSQL advisory lock at startup. It is idempotent and transactional. To apply
before restarting services, set the existing backend environment and run:

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
.\.venv\Scripts\python.exe -m scripts.auth_admin migrate
```

Matching email addresses never cause automatic linking. When a new provider's
email already exists, sign in with that existing account, then choose **Link
Google** or **Link GitHub** in the account strip. Linking requires a valid session
when it starts and again at callback. An identity already owned by another user
cannot be transferred. A unique database key prevents concurrent duplicate
identities. Concurrent conflicting signups return a retry/link message.

## Local URLs and environment

Use one host spelling consistently. The current local Vite server is
`http://127.0.0.1:5173`; its `/controller-api` proxy targets the controller on
`http://127.0.0.1:8003`. The registered browser callbacks are:

| Provider | Exact callback |
| --- | --- |
| Google | `http://127.0.0.1:5173/controller-api/api/auth/oauth/google/callback` |
| GitHub | `http://127.0.0.1:5173/controller-api/api/auth/oauth/github/callback` |

These correspond to implemented controller routes
`GET /api/auth/oauth/{provider}/callback`. Initiation is
`POST /api/auth/oauth/{provider}/start`, optionally `?link=true`.

The backend now reads the repository-root `.env` automatically. A local ignored
file has been created with the correct URLs and empty provider credential fields.
Edit its four `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET` entries using values from your consoles. Do not paste secrets
into chat, frontend files, or Git. `.env.example` is a template only; do not copy
it over an existing populated `.env`.

Process environment variables take precedence. The following is an alternative
to `.env` when launching a controller from a terminal:

```powershell
$env:AUTH_PUBLIC_BASE_URL = 'http://127.0.0.1:5173/controller-api'
$env:AUTH_FRONTEND_URL = 'http://127.0.0.1:5173'
$env:AUTH_COOKIE_SECURE = 'false' # Loopback HTTP only; true for HTTPS deployments.
$env:AUTH_DEMO_MODE = 'false'
$env:GOOGLE_CLIENT_ID = Read-Host 'Google client ID'
$env:GOOGLE_CLIENT_SECRET = Read-Host 'Google client secret' -MaskInput
$env:GITHUB_CLIENT_ID = Read-Host 'GitHub client ID'
$env:GITHUB_CLIENT_SECRET = Read-Host 'GitHub client secret' -MaskInput
```

Keep credentials server-side. Do not commit `.env` or paste secrets into frontend
variables. `AUTH_SESSION_SECONDS` retains the existing eight-hour default.
Password recovery still requires the existing SMTP settings and a strong
`AUTH_RESET_SECRET`; OAuth does not require SMTP.

## Google console

1. Open [Google Cloud Console](https://console.cloud.google.com/auth/overview),
   select/create a project, and configure Google Auth
   Platform branding, audience, and contact details. Billing is not required by
   this implementation.
2. If the app is External and in Testing, add your test Google accounts.
3. Open [Credentials](https://console.cloud.google.com/apis/credentials), select
   Create credentials → OAuth client ID, and choose **Web application**.
4. Register the Google callback above under **Authorized redirect URIs**.
   If the console requires an authorized JavaScript origin, enter
   `http://127.0.0.1:5173` without a path. This app uses server-side redirects,
   not the browser Google SDK.
5. Copy its client ID/secret into the ignored root `.env`. Click **Refresh sign-in
   availability** on the signup/login page, or wait 15 seconds. If you changed
   process environment variables instead, restart the controller first.

See [Google's OIDC documentation](https://developers.google.com/identity/openid-connect/openid-connect).

## GitHub console

1. Open [New GitHub OAuth App](https://github.com/settings/applications/new)
   (Settings → Developer settings → OAuth Apps → New OAuth App).
2. Set the homepage to `http://127.0.0.1:5173`.
3. Set **Authorization callback URL** to the exact GitHub callback above.
4. Register the app, generate a client secret, and fill both GitHub values in the
   ignored repository-root `.env`.
   Use a separate OAuth app for a different deployment callback.
5. Click **Refresh sign-in availability**, or wait 15 seconds. Provider values
   are re-read from `.env` on each readiness/start/callback request. Changing
   process environment variables or cached cookie/session settings requires a
   controller restart. Unconfigured providers stay disabled with a precise reason.

See [GitHub's OAuth authorization documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Service authorization and operator access

**Authentication now applies to backend APIs, not just the UI.** Browser users
may read operational data. Experiment start/stop, synthetic traffic changes, and
order creation require an explicit operator grant plus the custom CSRF header.
Inventory reservations and fault configuration require internal credentials.
Health/readiness remain unauthenticated for local monitoring. They and internal
services should remain network-isolated; this change does not modify infrastructure.

Generate a strong `INTERNAL_SERVICE_TOKEN` (at least 32 characters) and set the
same value only on trusted backend processes and the verification script. The
controller and worker pass it to Order/Inventory APIs; it is not sent to Google,
GitHub, or Toxiproxy. Do not expose it through `VITE_*`, browser storage, or logs.
No token means machine requests fail closed. Restart **all** Python services
after configuring it; an old running process still has its old authorization
behavior. `scripts/verify_live.py` now reads this environment credential.

New and existing users are viewers unless the local operator grants permission.
Get the account's UUID from authenticated `GET /api/auth/me`, then run locally:

```powershell
.\.venv\Scripts\python.exe -m scripts.auth_admin grant --user-id ACCOUNT_UUID
.\.venv\Scripts\python.exe -m scripts.auth_admin revoke --user-id ACCOUNT_UUID
```

There is no HTTP role-grant endpoint. The dashboard is a shared reliability
workspace, not a multi-tenant data store; viewers see shared experiment data.
Viewer mutation attempts return 403 even if a UI control is visible.
Do not publish private inventory, worker, AI-worker, database, broker, or
Toxiproxy ports. Backend checks complement network isolation; they do not
configure it.

## Verification and logging

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix services/frontend test
npm.cmd --prefix services/frontend run build
```

No lint/typecheck scripts are configured in this JavaScript project. OAuth tests
mock provider HTTP responses, including Google signatures with generated RSA
keys. They do not demonstrate a successful live provider login.

With credentials configured, manually test new/returning users for both
providers, refresh, logout, consent denial, private GitHub email, linking an
existing password account, collision rejection, and viewer/operator permissions.
Also verify that deleting/expiring a session yields 401 and reset passwords revoke
all sessions. Do not claim live OAuth success until those browser checks pass.

Controller ASGI access logging strips OAuth query strings before response logs.
Configure any external proxy to omit query strings on callback paths too:
authorization codes arrive in the URL even though application code never logs
them. Do not enable HTTP wire/debug logging with live credentials.

Facebook and the `/api/auth/oauth-mock` handler have been removed. Old demo
accounts are retained for data preservation but cannot authenticate.

## Diagnosing disabled buttons

The original running controller returned only `demo_mode` and `password_min_length`;
its Google start route returned 404. The frontend treated the absent `providers`
field as both providers being disabled, swallowed fetch failures, and fetched only
once. That stale process has been replaced. The current controller runs on 8003;
Vite remains on 5173. The current remaining blockers are the four empty provider
credential fields, confirmed by `GET /api/auth/config`.

Readiness reports only variable names and fixed reason codes, never values.
It distinguishes missing settings, invalid/split origins, and missing Secure cookies
for HTTPS. The UI distinguishes old backend responses and network failures, polls
while visible, refreshes on tab return, and includes a manual refresh button.
Both fetch and response use no-store caching. Availability means configured, not
that credentials have been accepted by a real provider.

Verify locally without displaying secrets:

```powershell
Invoke-RestMethod http://127.0.0.1:8003/api/auth/config | ConvertTo-Json -Depth 5
```

After entering valid values, expect `providers.google` and `providers.github` to
be true, then perform real provider login, refresh, logout, consent cancellation,
and account-linking tests. No successful real OAuth login has been claimed.

Google permits localhost/loopback exceptions to its HTTPS redirect requirements;
GitHub recommends literal loopback addresses. Keep `127.0.0.1` consistent in the
browser, both registered callbacks, and both auth URL settings. See
[Google redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server)
and [GitHub redirect rules](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
