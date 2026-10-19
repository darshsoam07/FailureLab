# Phase 6 fixes and Phase 7 QA

Scope: frontend only on `ui/stitch-redesign`. Phase 6 fixes are commit `1629c5d`; Phase 7 follows separately. No backend changes or new dependencies.

## Earlier fixes confirmed

- Dashboard badges use **Above SLO ceiling (dashboard view)** in `src/components/dashboard/DashboardKpiRow.jsx`. Metrics are also scoped by experiment start in `src/App.jsx`.
- `App.jsx`'s `launch` calls `change('start', body)` without changing the selected screen.
- `LatencyChartCard.jsx` renders the experiment marker only when its parsed timestamp is between the first and last buffered timestamps.
- Simulated Toxiproxy nodes and connected edges have a distinct violet style and the required tooltip. Regression tests cover non-real and missing mode values in a received response.
- Successful-poll timestamps originate in `usePolling.js`, not topology rendering. They are endpoint-specific, retain the last response time during failures, and start at never. Known 503 readiness payloads count as received responses, not passing probes.

## Test counts

The original 49 tests were counted before edits. Final counts include the Phase 6 regressions and Phase 7 tests.

| File | Original | Final |
|---|---:|---:|
| `client.test.js` | 5 | 6 |
| `experimentLogic.test.js` | 6 | 6 |
| `experiments.test.js` | 4 | 4 |
| `metricsBuffer.test.js` | 5 | 5 |
| `render.test.js` | 0 | 7 |
| `reportsLogic.test.js` | 7 | 7 |
| `settings.test.js` | 0 | 3 |
| `shell.test.js` | 5 | 5 |
| `sparkline.test.js` | 4 | 4 |
| `topologyGraph.test.js` | 6 | 8 |
| `topologyHealth.test.js` | 5 | 6 |
| `traffic.test.js` | 2 | 2 |
| `visiblePolling.test.js` | 0 | 7 |
| **Total** | **49** | **70** |

Render regressions cover empty Reports, absent Settings data, failed readiness checks and URL suppression, null Dashboard metrics, empty Experiments, unknown Topology, and the boundary fallback. Pure polling tests cover initial hidden state, abort, cleanup, rapid visibility changes, non-overlap, late responses, one-shot refresh, and recovery.

## Cleanup evidence

Before deletion, repository-wide `rg` searches (excluding dependencies, generated bundles, logs and virtualenv) found only self-definitions for the legacy components after their dead App imports were removed. The similarly named `ExperimentLauncherCard` remains used by `ExperimentsView`. A search for `common/index` and imports from the common directory found no barrel consumers; active code imports specific component files. `EmptyState` remains used by the history table and was retained.

Removed files:

- `src/components/ExperimentLauncher.jsx`
- `src/components/ExperimentHistoryAndAIReport.jsx`
- `src/components/LiveTelemetryPanel.jsx`
- `src/components/common/index.js`

Removed unused named imports, the obsolete `.eyebrow` and `.font-code-inline` selectors, and the legacy Tailwind aliases `ink`, `panel`, `edge`, `mint`. The error boundary now uses the current palette; a follow-up source search found no remaining legacy alias consumers. Glow classes referenced by Card and active controls were retained. Temporary browser QA fixture files and Vite test cache at the repository root were removed.

## WCAG contrast measurements

Computed using sRGB linearization and WCAG relative luminance, `(Llighter + 0.05) / (Ldarker + 0.05)`. Normal text requires at least 4.5:1.

| Text / surface | Before `#849396` | After `#9aa9ac` |
|---|---:|---:|
| Card `#121A2F` | 5.430:1 | **7.118:1** |
| Background `#0B1020` | 5.946:1 | **7.794:1** |
| Raised surface `#1E2942` | 4.545:1 | **5.958:1** |
| Hover surface `#22304D` | 4.127:1 — fail | **5.410:1** |

The muted token was replaced consistently, and readable live-run notes no longer reduce it to 80% opacity. Disabled controls are exempt from normal-text contrast requirements. Emergency buttons use darker red normal/hover surfaces. This is a focused palette measurement, not a claim of an exhaustive WCAG audit.

## Browser verification actually performed

- Navigated the five pages with live service data during the initial pass, including real catalog bounds, readiness tables, and relative API prefixes.
- Tested all five pages at 1440, 1024, 768 and 390px. Found and fixed horizontal pipeline/graph overflow. The final 20-page matrix with both upstreams unreachable had zero document or in-content overflow and exactly one h1 per page.
- Measured visible mobile controls at 390px; no control below 44px remained in the final backend-down matrix. The initial live Reports close button issue was corrected by enforcing its minimum size.
- Used a separate local Vite instance whose proxy upstreams pointed to an unavailable local port. All five pages rendered error/unknown states without crashing. This did not stop or modify real backend services.
- Reproduced and fixed the Reports empty-state crash; revisited its empty/error page successfully. Settings showed never/unknown and no invented catalog limits before the first successful response.
- Opened the mobile node inspection panel, verified never for an unreceived probe, closed it and confirmed focus returned to the selected node.
- Used an isolated emergency-modal fixture at 390x640 (no backend mutation). Dialog bounds were x=16, y=99.33, width=358, height=441.33; all buttons were at least 44px. Initial focus was Cancel; Tab and Shift+Tab wrapped within the modal. The fixture was deleted afterward.

## Automated or source-verified only; not rerun as live browser flows

- Live SLO abort, second-launch conflict, real manual stop, RabbitMQ/PostgreSQL outage recovery, proposal staging without auto-launch, and downloaded export contents were not rerun end-to-end in this phase. Existing contract/helper tests cover relevant logic; the README includes their manual QA checklist.
- Dependency failures were tested as 503 payloads and rendered FAIL checks, rather than by stopping real database/broker processes.
- Reduced-motion rules and disabled chart animations were source-verified; an OS/browser reduced-motion preference toggle was not exercised.
- Hidden-tab scheduling and immediate refresh are covered by injected visibility/timer tests; browser network polling traces were not captured.
- The boundary fallback was both encountered during the pre-fix Reports crash and covered by a render regression. Tests do not simulate a full browser reload/recovery cycle.

## Files changed

Paths below are relative to `services/frontend/`; the four removals are listed above.

- `README.md`
- `src/App.jsx`
- `src/api/client.js`
- `src/components/TopologyBanner.jsx`
- `src/components/common/AppErrorBoundary.jsx`
- `src/components/common/EmptyState.jsx`
- `src/components/common/ErrorBanner.jsx`
- `src/components/common/KpiCard.jsx`
- `src/components/common/SectionHeader.jsx`
- `src/components/common/StatusBadge.jsx`
- `src/components/dashboard/DashboardKpiRow.jsx`
- `src/components/dashboard/DashboardView.jsx`
- `src/components/dashboard/LatencyChartCard.jsx`
- `src/components/dashboard/TrafficControlCard.jsx`
- `src/components/experiments/ExperimentLauncherCard.jsx`
- `src/components/experiments/ExperimentsView.jsx`
- `src/components/experiments/LiveRunCard.jsx`
- `src/components/reports/ExperimentsHistoryTable.jsx`
- `src/components/reports/PostMortemPanel.jsx`
- `src/components/reports/ReportsView.jsx`
- `src/components/settings/SettingsView.jsx`
- `src/components/shell/EmergencyStopModal.jsx`
- `src/components/shell/MobileNavBar.jsx`
- `src/components/shell/MobilePinnedStopBar.jsx`
- `src/components/shell/SideNavBar.jsx`
- `src/components/shell/TopNavBar.jsx`
- `src/components/topology/TopologyDetailPanel.jsx`
- `src/components/topology/TopologyGraphView.jsx`
- `src/components/topology/TopologyLayerList.jsx`
- `src/components/topology/TopologyOverview.jsx`
- `src/hooks/usePolling.js`
- `src/lib/settings.js`
- `src/lib/topologyGraph.js`
- `src/lib/topologyHealth.js`
- `src/lib/visiblePolling.js`
- `src/main.jsx`
- `src/styles.css`
- `tailwind.config.js`
- `tests/client.test.js`
- `tests/render.test.js`
- `tests/settings.test.js`
- `tests/topologyGraph.test.js`
- `tests/topologyHealth.test.js`
- `tests/visiblePolling.test.js`
- `PHASE7_QA.md`

## Production bundle

`npm.cmd test`: 70 passed, 0 failed. `npm.cmd run build`: passed.

| Chunk | Minified kB | Gzip kB |
|---|---:|---:|
| Shell / index | 258.80 | 80.72 |
| Shared Recharts / CartesianChart | 356.22 | 103.43 |
| Dashboard page | 20.31 | 7.06 |
| Experiments page | 47.30 | 13.42 |
| Reports page | 30.93 | 8.23 |
| Topology page | 33.27 | 8.57 |
| Settings page | 4.41 | 1.68 |
| Shared StatusBadge | 9.68 | 4.02 |
| Shared JSX/runtime | 8.91 | 3.39 |
| Experiment validation helper | 3.08 | 1.41 |
| CSS | 52.47 | 9.94 |

The earlier single JS chunk was 766.93kB / 219.53kB gzip. These are per-chunk sizes, not a claim that the first visit downloads only the shell: Dashboard is the default page, so its chart chunk loads when that page renders. Other page chunks load on demand.
