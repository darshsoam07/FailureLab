# Authentication

The five-screen portal preserves email/password signup, login, and recovery.
Google and GitHub now use real server-side OAuth; Facebook and mock social login
are removed. Unconfigured providers are disabled. No frontend dependencies were
added; the backend uses PyJWT with cryptographic signature verification.

See [OAuth setup](../../OAUTH_SETUP.md) for the architecture, additive migration,
exact localhost callbacks, credentials, role administration, internal service
tokens, and manual verification checklist.

`components/auth/` contains the portal, SVG portraits, session gate, and scoped
styles. `lib/auth.js` contains the state machine; `api/auth.js` sends
cookie-authenticated requests through `VITE_CONTROLLER_API_URL`. No tokens go in
local storage. Session restoration runs on refresh. `App` remains directly
renderable in tests, and `AuthenticatedApp.initialUser` is a test-only seam.

The account strip provides explicit Google/GitHub linking after signing in.
Email collisions never silently merge accounts. OAuth errors/cancellation appear
as dismissible messages. Existing password recovery behavior remains: 12-character
minimum, expiring four-digit codes, a resend cooldown, five guesses, password-reuse
rejection, and session revocation after reset. `AUTH_DEMO_MODE=true` only enables
local reset-code display; it no longer enables any social login.

Browser reads require a session; operational mutations require an operator grant.
Internal APIs require server credentials. Signing out does not stop experiments
or traffic. All old backend processes must restart to enforce the new checks.

```powershell
npm.cmd --prefix services/frontend test
npm.cmd --prefix services/frontend run build
```

Live provider testing requires configured credentials. Automated tests use mocked
providers and are not evidence of a successful real Google/GitHub browser login.
