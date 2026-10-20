# Authentication

The five-screen portal sits before the Terminal Neon dashboard. It uses original
inline SVG VR portraits, screen-specific gradients, labelled controls, OTP paste
and keyboard handling, and reduced-motion support. No new dependencies are needed.

`components/auth/` owns the portal, artwork, styles, and session gate.
`lib/auth.js` contains the testable state machine; `api/auth.js` sends cookie-based
requests through `VITE_CONTROLLER_API_URL`. Session and reset tokens are never
written to local storage. `App` remains directly renderable in existing tests;
`AuthenticatedApp.initialUser` is an explicit test seam, unused by production.

## Local demo

Keep the backend environment from `LOCAL_VERIFICATION.md`. Before starting the
controller, set these additional environment variables in its terminal:

```powershell
$env:AUTH_DEMO_MODE = 'true'
$env:AUTH_COOKIE_SECURE = 'false'
.\.venv\Scripts\python.exe -m uvicorn services.experiment_controller.main:app --host $env:CONTROLLER_HOST --port $env:CONTROLLER_PORT
```

Set `CONTROLLER_HOST` and `CONTROLLER_PORT` for your local environment first.
Use the frontend's existing relative `/controller-api` proxy configuration, then
run `npm.cmd --prefix services/frontend run dev`. Restart an already running
controller to load the new routes and settings.

Demo mode displays reset codes in the portal and enables clearly labelled Google
and Facebook **demo** identities. These buttons do not contact either provider.
Create an ordinary account to exercise password recovery. Passwords require at
least 12 characters. Codes expire after 10 minutes, allow five guesses, and can be
resent after 30 seconds. Successful password changes consume reset challenges
and revoke all sessions; previous passwords cannot be reused.

## Deployment configuration and scope

Defaults are `AUTH_DEMO_MODE=false` and `AUTH_COOKIE_SECURE=true`. Use HTTPS and a
same-origin reverse proxy for cookie authentication. Recovery email requires
`AUTH_RESET_SECRET` (at least 32 characters), `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`,
and `AUTH_SMTP_FROM`; optional credentials are `AUTH_SMTP_USERNAME` and
`AUTH_SMTP_PASSWORD`. SMTP uses STARTTLS. Configure secrets only on the backend.
`AUTH_SESSION_SECONDS` defaults to 28800.

The controller creates its separate auth metadata tables (`auth_users`,
`password_reset_codes`, `auth_sessions`) during startup. The original seven
reliability tables and existing unauthenticated operational API contracts remain
unchanged. **This is a dashboard sign-in gate, not access control for the chaos
APIs.** Restrict those APIs at your deployment boundary if exposed beyond trusted
users. Logging out does not stop traffic or experiments.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix services/frontend test
npm.cmd --prefix services/frontend run build
```

Manual checks: signup; logout/login; invalid credentials; password visibility;
forgot-password email preservation; OTP typing/paste/backspace; resend countdown;
wrong/expired codes; mismatched/reused passwords; successful reset and revoked
sessions; mock identity labels; controller-down errors; mobile scrolling and
keyboard focus. Verify all five palettes and artwork against the supplied visual
references. SMTP delivery and real-browser session behavior require separate
environment testing; mocked tests do not establish these.
