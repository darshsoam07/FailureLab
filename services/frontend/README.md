# FailureLab frontend core

Requires Node 22.12+ and the existing Order API and Experiment Controller.
Run `npm ci`, copy `.env.example` to `.env.local`, and fill in the upstream
URLs and frontend port. Run `npm run dev`. `npm run build` produces `dist/`;
`npm run preview` uses `FRONTEND_PREVIEW_PORT`.

`VITE_ORDER_API_URL` and `VITE_CONTROLLER_API_URL` are public, build-time API
bases. Use `/order-api` and `/controller-api` with the supplied Vite proxy for
local development, pointing `ORDER_API_UPSTREAM` and
`CONTROLLER_API_UPSTREAM` at the real services. This avoids requiring CORS
changes to the Python services. A deployed static frontend needs the same
paths routed to the services by your infrastructure, or absolute API bases
with CORS allowed at those services. Vite's proxy is not part of `dist/`.
Never put credentials or LLM keys in `VITE_*` variables. Browser configuration
uses Vite environment variables; Python services retain pydantic-settings.

The app polls experiment history, telemetry, and traffic every two seconds
without overlapping polls. Requests have an eight-second timeout and are
cancelled on unmount. Writes are never automatically retried. The chart keeps
90 samples (roughly three minutes), inserts gaps on errors, and draws the
currently running experiment's P95 SLO threshold. No threshold is invented
when there is no running experiment. The SLO badge is an instantaneous sample
assessment; the server owns consecutive-breach tracking and automatic abort.
Metrics use the backend's rolling 60-second window, not interval counts.

Choose 1–10 RPS before enabling traffic. Stop traffic before choosing a new
rate. The switch confirms server state and reconciles uncertain writes on
the next poll. Attempt and accepted counters are distinct because a timed-out
POST may already have created an order. Simulator state belongs to one
controller process. The launcher reads parameter limits from the backend catalog.
History is paginated and selected experiment reports refresh automatically while
analysis is pending. AI follow-ups validate against the current allowlist and
retain the source experiment's duration and SLO thresholds. Recommendations are
rendered as text, never executed. AI reports come from experiment detail
(`ai_report` may be null). Manual stops appear as COMPLETED / STOPPED with their
reason; they are not presented as successful safety tests.

See [Local verification checklist](LOCAL_VERIFICATION.md) for complete PowerShell
environment and launch commands for all services and the frontend.

Run `npm test` for API contract and cancellation checks, and `npm run build`
for compilation. Real service integration requires the backend dependencies.
