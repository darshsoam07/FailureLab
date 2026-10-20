# Terminal Neon migration review

The migration is based on the completed five-page frontend at `8aa1a76`, not the older frontend on `main`. Implementation is saved in `ad6907a` on `codex/terminal-neon`. This report records the checks performed during the migration; it does not certify backend chaos behavior.

## Design and scope

Technical Fog is the default workspace canvas. Deep Terminal Teal anchors navigation, topology visualization, the latency chart, live experiment telemetry, and recommended-fix code blocks. Neon Lime marks the active navigation item and primary actions. Dark green provides readable accent text on light surfaces. Warning, destructive, and simulated states retain distinct labels and functional colors.

`src/theme.css` owns the color values. Tailwind maps semantic utility names to these properties, and SVG/chart properties use CSS variables. `.terminal-panel` supplies local dark contexts; `.dark` remains supported for an explicitly configured host. The document no longer forces the entire application into dark mode. No theme-switching state or new dependency was added.

Existing components, props, handlers, API adapters, polling, safety logic, page selection, lazy loading, and report contracts were reused. The only non-color control adjustment fixes native input step validation: a minimum of 1 with steps of 5/25 rejected the existing defaults of 60 seconds/500ms. Duration now accepts integer seconds; the P95 input accepts numeric values subject to the existing application validation.

## Semantic tokens

Values below resolve inherited variables for readability. The source of truth remains `src/theme.css`.

| Token | Workspace | Terminal region |
|---|---|---|
| background | `#E9E9E9` | `#122023` |
| foreground | `#122023` | `#E9E9E9` |
| surface | `#F5F6F3` | `#1B2D30` |
| surface-elevated | `#FFFFFF` | `#263C3F` |
| surface-dark | `#122023` | same |
| primary | `#E1FCAD` | same |
| primary-foreground | `#122023` | same |
| secondary | `#DCE1DC` | `#263C3F` |
| accent | `#E1FCAD` | same |
| accent-foreground | `#122023` | same |
| accent-ink | `#36551C` | `#E1FCAD` |
| border | `#B8C2BC` | `#486064` |
| input | `#FFFFFF` | `#1B2D30` |
| focus-ring | `#456729` | `#E1FCAD` |
| muted | `#DCE1DC` | `#263C3F` |
| muted-foreground | `#53635F` | `#ACBCB8` |
| success | `#315619` | `#E1FCAD` |
| warning | `#805000` | `#F2C66D` |
| destructive | `#AE2536` | `#FF9CA8` |
| danger-button | `#AE2536` | same |
| on-destructive | `#FFFFFF` | same |
| simulated | `#6A4489` | `#D4B6EC` |
| chart-series | `#36551C` | `#E1FCAD` |
| chart-secondary | `#9A4D0A` | `#F2B278` |
| sidebar | `#122023` | same |
| sidebar-active | `#E1FCAD` | same |

## Changed files and purpose

All paths in this table are relative to `services/frontend/`.

| Files | Purpose |
|---|---|
| `index.html` | Remove forced dark mode and obsolete body utilities/theme meta color. |
| `src/theme.css` (new) | Central semantic palette and local terminal contexts. |
| `tailwind.config.js`, `src/styles.css` | Map tokens, preserve focus/motion/mobile rules, remove decorative glow effects. |
| `src/App.jsx` | Apply tokens and remove the broad horizontal-overflow mask. |
| `src/components/TopologyBanner.jsx` | Tokenized pipeline; wrapping header and state actions. |
| `src/components/common/AppErrorBoundary.jsx`, `Card.jsx`, `EmptyState.jsx`, `ErrorBanner.jsx`, `KpiCard.jsx`, `SectionHeader.jsx`, `StatusBadge.jsx` | Reuse shared primitives with semantic colors; restrained card styling; wrapping KPI rows. |
| `src/components/dashboard/DashboardKpiRow.jsx`, `LatencyChartCard.jsx`, `TrafficControlCard.jsx` | Metric colors, dark chart, readable axis margin, wrapping legend/footer, switch contrast. |
| `src/components/experiments/ExperimentLauncherCard.jsx`, `ExperimentsView.jsx`, `LiveRunCard.jsx` | Lime launch action, themed form, native step fix, dark telemetry/log panel, wrapping legend. |
| `src/components/reports/ExperimentsHistoryTable.jsx`, `PostMortemPanel.jsx`, `ReportsView.jsx` | Table/report colors, dark code block, lime proposal action, intentional focusable table scrolling. |
| `src/components/settings/SettingsView.jsx` | Read-only settings colors; source data unchanged. |
| `src/components/shell/EmergencyStopModal.jsx`, `MobileNavBar.jsx`, `MobilePinnedStopBar.jsx`, `SideNavBar.jsx`, `TopNavBar.jsx` | Teal navigation, lime selection, accessible destructive buttons, solid mobile stop surface, wrapping page heading. |
| `src/components/topology/TopologyDetailPanel.jsx`, `TopologyGraphView.jsx`, `TopologyLayerList.jsx`, `TopologyOverview.jsx` | Themed graph and inspection surfaces; simulated state remains distinct. |
| `tests/theme.test.js` (new), `tests/render.test.js` | Token/contrast/hex-literal checks and native-input regression. |
| `README.md`, `TERMINAL_NEON_REVIEW.md` (new) | Theme usage and review evidence. |

No existing component was removed or duplicated. No backend, API adapter, hook, business-logic library, dependency manifest, lockfile, environment file, or deployment configuration changed.

## Responsive and interaction evidence

Browser checks used an isolated local HTTP fixture with explicit fixture experiment/report text. They did not call production infrastructure or prove real fault injection.

All five pages were navigated and measured at **320, 375, 768, 1024, 1440, and 1920 CSS pixels**, with 1000px height for the matrix. The 30 combinations had:

- No horizontal document overflow.
- No detected content extending beyond the viewport, excluding intentional internal table scrolling.
- One `h1` per page.
- No visible buttons, links, inputs, or selects below 44×44px in the two mobile widths.

Screenshots were visually inspected for the 1440px dashboard, 320px dashboard and emergency dialog, 768px reports, 1024px experiments, and 1920px settings. This is not a claim that screenshots were manually inspected for all 30 combinations.

Additional observed interactions:

- Launch succeeds with the default form values and stays on Experiments.
- Launch controls disable while the fixture experiment is running.
- The mobile emergency modal fits at 320px (280px wide, approximately 589px high in a 900px viewport), focuses Cancel initially, and confirms a stop.
- Stop produces visible `MANUAL_STOP` feedback and re-enables launch.
- Reports load populated post-mortem data, evidence, confidence, recommendations, and a proposal action.
- The mobile Toxiproxy inspection panel opens with the explicit simulated warning.
- The captured browser console contained no error or warning entries at the inspection point.

Issues found and addressed:

- Global HTML dark class prevented the requested light canvas.
- Negative chart margin clipped the first digit of Y-axis labels.
- Narrow header title was truncated; it now wraps.
- KPI, pipeline, and timeline headers needed wrapping.
- Audit table cells broke short values mid-word at tablet width; cells now stay together inside a labelled, keyboard-focusable horizontal scroll region.
- Native numeric input steps rejected default launch values.

The final table nowrap adjustment was built and tested but **was not rechecked in the browser**. Browser approval later rejected further access after a usage-limit gate. The proposal-button click after report loading and final screenshot export were not completed. No screenshot files are included as saved evidence.

## Accessibility measurements

WCAG relative-luminance calculations from the actual token values:

| Pair | Contrast |
|---|---:|
| Teal foreground / Fog canvas | 13.76:1 |
| Muted workspace text / Fog canvas | 5.21:1 |
| Muted workspace text / light card | 5.83:1 |
| Muted workspace text / elevated surface | 6.33:1 |
| Muted terminal text / dark background | 8.47:1 |
| Muted terminal text / dark card | 7.26:1 |
| Muted terminal text / dark elevated surface | 5.91:1 |
| Teal text / Lime primary action | 14.90:1 |
| White text / destructive action | 6.74:1 |

The token tests cover foreground, muted, accent ink, success, warning, destructive, and simulated text on each of three surfaces in both contexts at 4.5:1, plus focus contrast at 3:1. These are token-pair measurements, not a complete rendered-page accessibility certification; opacity, disabled states, screen-reader behavior, zoom, and all possible data lengths require further manual review.

## Validation and bundle

Commands run from this directory: `npm.cmd test` (**75 passed, 0 failed**) and `npm.cmd run build` (**passed**). There are no configured lint or type-check scripts. `git diff --check 8aa1a76..HEAD` passed.

Per-file test counts: client 6; experimentLogic 6; experiments 4; metricsBuffer 5; render 8; reportsLogic 7; settings 3; shell 5; sparkline 4; theme 4; topologyGraph 8; topologyHealth 6; traffic 2; visiblePolling 7.

Final production bundle (decimal kB):

| Asset | Raw | Gzip |
|---|---:|---:|
| Main JS | 259.10 | 80.61 |
| CSS | 49.78 | 9.24 |
| Shared Recharts chunk | 356.22 | 103.43 |
| Dashboard | 20.69 | 7.02 |
| Experiments | 47.88 | 13.36 |
| Reports | 31.29 | 8.24 |
| Topology | 33.53 | 8.51 |
| Settings | 4.45 | 1.66 |

Existing page lazy loading is retained. The chart chunk is loaded when chart-bearing pages are requested; Dashboard is the default page.

Not rerun: live PostgreSQL/RabbitMQ/Toxiproxy scenarios, backend tests, actual SLO aborts, dependency outages, cross-browser/real-device QA, or a complete screen-reader audit. Existing automated tests cover unavailable-data rendering, proposal validation, export payloads, polling visibility behavior, readiness failures, and safety-state derivation.

## Review and merge

Implementation diff against `8aa1a76`: **34 files, 772 insertions, 745 deletions**. The documentation follow-up adds this report and updates the frontend README.

Suggested descriptive commit/squash title: `feat(frontend): apply Terminal Neon theme and responsive polish`.

Review against `ui/stitch-redesign` (the Phase 7 baseline), rather than `main`, to isolate the theme:

```powershell
git diff ui/stitch-redesign...codex/terminal-neon -- services/frontend
git diff --check ui/stitch-redesign...codex/terminal-neon
```

Review the documentation working-tree changes separately before committing them. Run the frontend commands above, complete the explicitly outstanding browser checks, then merge through the repository's normal reviewed PR process. No automatic merge was performed.
