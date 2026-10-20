# FailureLab frontend

The dashboard now opens behind a five-screen authentication portal. See
[authentication setup and verification](AUTHENTICATION.md) for local demo flags,
SMTP configuration, session behavior, and the intentionally public operational APIs.

A read-only settings view and four operational pages share one application shell: Dashboard, Experiments, Reports, Topology, and Settings. The frontend uses React, Vite, Tailwind CSS, Lucide, and Recharts. No additional dependencies were introduced for Phase 7.

The Terminal Neon theme uses Technical Fog for the workspace, Deep Terminal Teal for navigation and terminal panels, and Neon Lime for selected controls and primary actions. Color values live only in `src/theme.css`; Tailwind utilities reference semantic properties. Use `text-accent-ink` for readable accent text on light surfaces, and pair `bg-primary` with `text-primary-foreground`. Add `terminal-panel` to an intentional dark region; its children inherit the corresponding token roles. Existing `.dark` host support is retained, but the document defaults to the light workspace.

See [the Terminal Neon review](TERMINAL_NEON_REVIEW.md) for the token table, changed-file inventory, contrast measurements, browser checks, bundle sizes, and outstanding manual QA.

## Run

Requires Node 22.12+ and the existing Python services. From this directory:

```powershell
npm.cmd ci
$env:VITE_ORDER_API_URL = '/order-api'
$env:VITE_CONTROLLER_API_URL = '/controller-api'
$env:ORDER_API_UPSTREAM = 'http://127.0.0.1:8000'
$env:CONTROLLER_API_UPSTREAM = 'http://127.0.0.1:8003'
$env:FRONTEND_HOST = '127.0.0.1'
$env:FRONTEND_PORT = '5173'
npm.cmd run dev
```

The upstreams are server-side Vite proxy configuration. `VITE_*` values are public build-time configuration: never put secrets in them. Settings displays only explicitly configured relative proxy prefixes; absolute URLs, credentials, query strings, and fragments are suppressed. A deployed static frontend needs its proxy routes configured separately; the Vite development proxy is not included in `dist/`.

See [the local runbook](LOCAL_VERIFICATION.md) for backend setup. This frontend phase did not change the backend.

## Structure

```text
src/
  App.jsx                    Shared polling, mutations and page selection
  main.jsx                   Root error boundary and React bootstrap
  api/                       Fetch contracts and validated experiment/proposal bodies
  hooks/usePolling.js        Shared React polling lifecycle and successful-poll timestamps
  lib/                       Pure derivations, settings sanitization, visiblePolling scheduler
  components/
    shell/                   Sidebar, top bar, mobile navigation, emergency modal
    common/                  Cards, badges, empty/error states, root error boundary
    dashboard/               Dashboard page, KPIs, telemetry chart, traffic controls
    experiments/             Experiments page, launcher, live run timeline
    reports/                 Reports page, paginated history, post-mortem and exports
    topology/                Topology page, graph, layer list, node inspection panel
    settings/                Read-only Settings page
```

Page components retain their `*View` names inside feature directories; there is no separate `pages/` directory. All five pages are lazy-loaded. Recharts is shared by Dashboard and Experiments in a separate chunk. The single `h1` lives in the shell; pages use subordinate headings.

## Real data only

- Catalog bounds and allowed parameters come from the controller catalog. Missing Settings values display unknown/unavailable, without invented defaults.
- The three-consecutive-breach auto-abort rule is a fixed server policy, displayed as server-controlled. The browser cannot change it.
- Dashboard metrics use `since=experiment.started_at` while running. A new scope clears the chart buffer. Dashboard threshold labels remain qualified as **Above SLO ceiling (dashboard view)**; the server owns watchdog status and abort decisions.
- The experiment-start marker is omitted outside the chart buffer. Launch does not redirect to Dashboard.
- Readiness is fetched only for the Controller and Order API. Known `503 not_ready` responses retain their failing checks. Transport failures suppress stale positive health signals.
- “Last probe” means the client's last successfully received readiness response, including a valid `not_ready` payload. It is not the time the server executed a probe. Before the first response it says **never**, independently for each endpoint.
- A reported Toxiproxy mode other than `real` is styled **Simulated**, with the tooltip “Faults are simulated; results are not from a real proxy”. Missing responses remain unknown. Connected edges inherit the simulated classification.
- AI proposals load into the launcher for review. They never launch automatically. Reports distinguish manual stop from successful completion, and preserve unconfirmed evidence wording.

## Polling and resilience

`lib/visiblePolling.js` serializes each poll stream, aborts outstanding reads and cancels timers while `document.visibilityState` is hidden, and immediately refreshes on return. Tests inject visibility and timers to cover cancellation, late responses, rapid visibility changes, and recovery. Writes are never retried automatically.

| Read | Owner | Cadence while visible |
|---|---|---|
| Experiment list, 100 rows | App | 2s; paused during experiment mutations |
| Catalog | App | 30s |
| Controller readiness | App | 5s |
| Order readiness | App | 10s |
| Metrics and traffic | App shared loop | 2s |
| Current experiment detail | App, Experiments page only | 2s while running; otherwise one read |
| Reports list, 10 rows + offset | Reports page | On selection/pagination/revision and visibility return; no interval |
| Selected report detail | PostMortemPanel | One serial stream, 3s while report pending, at most 20 attempts per refresh |

The Reports table receives selected detail from the panel; it does not issue a duplicate detail request. App detail polling is inactive on Reports. HTTP reads time out after eight seconds. Loading, empty, unavailable, and stale states are explicit. A root error boundary provides a friendly reload fallback; it does not stop server-managed experiments.

Charts have accessible labels and text summaries. Keyboard focus is visible, the shell includes a skip link, and status notices are polite live regions. Mobile controls have 44px minimum targets. The topology uses a layer list below 1280px, avoiding squeezed graph controls. CSS animations, transitions, and glows are disabled under reduced motion; Recharts line/area animations are disabled.

## Tests and build

```powershell
npm.cmd test
npm.cmd run build
```

Tests use Node's built-in test runner. Pure helpers cover contracts, pagination, proposal validation, topology derivations, and polling. Render regressions use the existing Vite build pipeline and React server rendering in memory, without a new test dependency or listener. Render tests do not replace interactive browser QA.

See [Phase 7 QA and cleanup report](PHASE7_QA.md) for per-file counts, measurements, removals, and the exact scope of browser verification.

## Intentionally omitted features and backend gaps

- No P50 endpoint: only P95 is charted.
- No list total: pagination uses limit/offset and loaded-page counts, never a fabricated global total.
- No browser-accessible per-service probes for Inventory, Fulfillment Worker, or AI Worker: these nodes remain unknown.
- No CPU, memory, replica, resource-utilization, or infrastructure metrics.
- No global SLO configuration endpoint: thresholds belong to individual experiments.
- No editable Settings, authentication management, provider-secret display, automatic AI experiment execution, or deployment controls.
- Telemetry snapshots do not record retry counts or circuit-breaker transitions. Reports must not infer these as measured facts.

## Manual QA checklist

Use real backing services and `toxiproxy_mode=real` for operational checks. Stop traffic and clear active faults afterward.

- [ ] At 5 RPS, confirm a warm baseline below the intended SLO; inject 450ms latency/50ms jitter and observe three consecutive breaches, automatic abort, cleared toxics, and an AI report.
- [ ] Attempt a second launch while another experiment is active. Confirm disabled controls or the backend conflict is reported without creating a second run.
- [ ] Open emergency stop, test Escape and keyboard focus cycling, confirm stop, and verify `COMPLETED` with `MANUAL_STOP` and empty toxics.
- [ ] Make each API unreachable. Visit all five pages; verify error/unknown states, disabled unsafe actions, no crash, and recovery after connectivity returns.
- [ ] Stop RabbitMQ or PostgreSQL in a dedicated test stack. Confirm readiness returns 503 with FAIL checks, derived topology degradation, and recovery after restart.
- [ ] Select an AI proposal. Confirm Experiments opens with populated fields, no start request is sent until explicit launch, and launch stays on that page.
- [ ] Export a selected report. Verify experiment identity, snapshots, AI report and expected filename. Export the loaded audit page and verify it contains only those rows; no environment values or credentials.
- [ ] At 1440, 1024, 768 and 390px, check all pages, long content, the emergency modal and node inspection; no horizontal overflow or content obscured by fixed bars.
- [ ] Tab through controls, use the skip link, check labelled icons, chart summaries, one h1, modal focus return, and reduced-motion preferences.
- [ ] Hide the tab and return. Confirm read intervals stop while hidden and refresh once immediately; no duplicate detail poll stream.
