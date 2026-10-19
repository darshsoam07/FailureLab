import { startVisiblePolling } from './lib/visiblePolling.js';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { usePolling } from './hooks/usePolling';

// Shell Primitives
import { SideNavBar } from './components/shell/SideNavBar.jsx';
import { TopNavBar } from './components/shell/TopNavBar.jsx';
import { MobileNavBar } from './components/shell/MobileNavBar.jsx';
import { MobilePinnedStopBar } from './components/shell/MobilePinnedStopBar.jsx';
import { EmergencyStopModal } from './components/shell/EmergencyStopModal.jsx';
import { ErrorBanner } from './components/common/ErrorBanner.jsx';

// Feature Views & Components
const DashboardView = lazy(() => import('./components/dashboard/DashboardView.jsx').then(m => ({ default: m.DashboardView })));
const ExperimentsView = lazy(() => import('./components/experiments/ExperimentsView.jsx').then(m => ({ default: m.ExperimentsView })));
const ReportsView = lazy(() => import('./components/reports/ReportsView.jsx').then(m => ({ default: m.ReportsView })));
import TopologyBanner from './components/TopologyBanner.jsx';
const TopologyOverview = lazy(() => import('./components/topology/TopologyOverview.jsx').then(m => ({ default: m.TopologyOverview })));
const SettingsView = lazy(() => import('./components/settings/SettingsView.jsx').then(m => ({ default: m.SettingsView })));

// Lib Utilities
import { appendMetricsPoint } from './lib/metricsBuffer.js';
import { isExperimentAlreadyEndedError } from './lib/shell.js';

export default function App({ client = api }) {
  const [activeScreen, setActiveScreen] = useState('dashboard');
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [stagedProposal, setStagedProposal] = useState(null);
  const mutation = useRef(null);

  const handleStageProposal = useCallback((proposalBody) => {
    setStagedProposal(proposalBody);
    setActiveScreen('experiments');
  }, []);

  // Single Source of Truth Polling for Experiments and Catalog
  const loadExperiments = useCallback(signal => client.getExperiments({ limit: 100, signal }), [client]);
  const loadCatalog = useCallback(signal => client.getExperimentCatalog({ signal }), [client]);
  const loadControllerReadiness = useCallback(signal => client.getControllerReadiness({ signal }), [client]);
  const loadOrderReadiness = useCallback(signal => client.getOrderReadiness({ signal }), [client]);

  const history = usePolling(loadExperiments, 2000, !busy);
  const catalog = usePolling(loadCatalog, 30000);
  const controllerReadiness = usePolling(loadControllerReadiness, 5000);
  const orderReadiness = usePolling(loadOrderReadiness, 10000);

  const loaded = history.data !== null;
  const error = history.error || catalog.error;
  const experiment = history.data?.find(row => ['RUNNING', 'PLANNED'].includes(row.status)) ?? null;
  const isRunning = experiment?.status === 'RUNNING';
  const latestExperiment = experiment || (history.data && history.data.length > 0 ? history.data[0] : null);
  const blocked = !loaded || !catalog.data || Boolean(error) || uncertain;

  // Single Telemetry & Traffic Polling Source
  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState(null);
  const [lastMetricsUpdated, setLastMetricsUpdated] = useState(null);
  const [metricsBuffer, setMetricsBuffer] = useState([]);

  const [traffic, setTraffic] = useState(null);
  const [trafficBusy, setTrafficBusy] = useState(false);
  const [trafficError, setTrafficError] = useState(null);
  const trafficMutation = useRef(false);

  const metricsSince = isRunning ? experiment.started_at : undefined;

  // Single shared polling effect for metrics summary and traffic status
  useEffect(() => {
    setMetrics(null);
    setMetricsBuffer([]);
    const polling = startVisiblePolling(async signal => {
      await Promise.allSettled([
        client.getMetricsSummary({ signal: signal, since: metricsSince })
          .then(data => {
            if (signal.aborted) return;
            const now = Date.now();
            setMetrics(data);
            setLastMetricsUpdated(now);
            setMetricsError(null);
            setMetricsBuffer(prev => appendMetricsPoint(prev, data, now));
          })
          .catch(err => {
            if (signal.aborted) return;
            // On failure: retain last good data, set error banner, do NOT append null as 0
            setMetricsError(err.message || 'Metrics polling failed');
          }),

        client.getTrafficStatus({ signal: signal })
          .then(data => {
            if (signal.aborted || trafficMutation.current) return;
            setTraffic(data);
            setTrafficError(null);
          })
          .catch(err => {
            if (signal.aborted || trafficMutation.current) return;
            setTrafficError(err.message || 'Traffic status polling failed');
          }),
      ]);

    }, 2000);
    return () => polling.stop();
  }, [client, metricsSince]);

  // Single Detail Polling Source for Current / Most Recent Experiment
  const [experimentDetail, setExperimentDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const targetExperimentId = latestExperiment?.id;
  const isTargetRunning = latestExperiment?.status === 'RUNNING';

  useEffect(() => {
    if (!targetExperimentId || activeScreen !== 'experiments') {
      setExperimentDetail(null);
      setDetailError(null);
      return;
    }

    setExperimentDetail(null);
    setDetailLoading(true);
    const polling = startVisiblePolling(async signal => {
      try {
        const data = await client.getExperiment(targetExperimentId, { signal: signal });
        if (!signal.aborted) {
          setExperimentDetail(data);
          setDetailError(null);
          setDetailLoading(false);
        }
      } catch (err) {
        if (!signal.aborted) {
          // Retain last good data on error and display degraded message
          setDetailError(err.message || 'Failed to sync experiment detail');
          setDetailLoading(false);
        }
      }

      return isTargetRunning;
    }, 2000);
    return () => polling.stop();
  }, [client, targetExperimentId, isTargetRunning, revision, activeScreen]);

  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    if (history.data && !history.error) setUncertain(false);
  }, [history.data, history.error]);

  // Traffic Toggle Handler
  const handleToggleTraffic = useCallback(async (enabled, rps) => {
    trafficMutation.current = true;
    setTrafficBusy(true);
    setTrafficError(null);
    try {
      const result = await client.toggleTraffic(enabled, rps);
      setTraffic(result);
    } catch (err) {
      setTrafficError(err.message || 'Failed to update traffic configuration');
    } finally {
      trafficMutation.current = false;
      setTrafficBusy(false);
    }
  }, [client]);

  // Experiment Mutation Handler
  async function change(action, body) {
    if (mutation.current) throw new Error('Another experiment change is in progress.');
    if (action === 'start' && (blocked || experiment)) {
      throw new Error('Wait for a current control plane with no active experiment.');
    }

    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setNotice('');

    // Cancel older history reads so they cannot overwrite a confirmed mutation.
    history.refresh();

    try {
      const result = action === 'start'
        ? await client.startExperiment(body, { signal: controller.signal })
        : await client.stopExperiment(body, { signal: controller.signal });

      if (controller.signal.aborted) return result;
      history.setData(rows => [result, ...(rows ?? []).filter(row => row.id !== result.id)]);
      setNotice(action === 'start'
        ? `Started ${result.name}.`
        : `Fault cleanup confirmed for ${result.name}. ${result.abort_reason ?? result.status}`
      );
      return result;
    } catch (err) {
      // Handle the stop race: if stopExperiment fails because the experiment already finished,
      // refresh state and show a neutral message instead of a red error.
      if (action === 'stop' && isExperimentAlreadyEndedError(err)) {
        setNotice('Experiment already ended (completed or watchdog-aborted).');
        history.refresh();
        return;
      }

      if (!controller.signal.aborted) {
        setUncertain(true);
        setNotice(`Change not confirmed: ${err.message} Refreshing control-plane state.`);
      }
      throw err;
    } finally {
      mutation.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
        history.refresh();
        setRevision(value => value + 1);
      }
    }
  }

  const launch = async (body) => {
    await change('start', body);
  };

  const stop = id => change('stop', id);

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#dee1f9] flex flex-col md:flex-row antialiased font-sans">
      <a href="#main" className="skip-link">Skip to content</a>
      {/* Desktop & Tablet Sidebar */}
      <SideNavBar
        activeScreen={activeScreen}
        onSelectScreen={setActiveScreen}
        isRunning={isRunning}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 md:ml-16 lg:ml-64 flex flex-col min-h-screen overflow-x-hidden">
        <TopNavBar
          activeScreen={activeScreen}
          activeExperiment={experiment}
          controllerReadiness={controllerReadiness.error ? null : controllerReadiness.data}
          controllerError={controllerReadiness.error}
          controllerLoading={controllerReadiness.loading}
          onOpenEmergencyStop={() => setIsEmergencyModalOpen(true)}
        />

        {/* Page Content: pb-36 guarantees mobile bottom nav + pinned stop bar never cover content */}
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 sm:px-8 sm:py-8 pb-36 md:pb-12 max-w-[1440px] w-full mx-auto space-y-6">
          {/* Status Notices */}
          {notice && (
            <div
              role="status" aria-live="polite"
              className="rounded-xl border border-[#1E2942] bg-[#121A2F] px-4 py-3 text-xs font-mono text-[#c3f5ff] flex items-center justify-between shadow-md"
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-[#9aa9ac] hover:text-white text-xs underline font-sans cursor-pointer ml-3 shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Control Plane Error Alert */}
          {error && (
            <ErrorBanner
              title="Control Plane Connection Error"
              message={`Unable to synchronize with controller: ${error}`}
            />
          )}

          {(orderReadiness.error || controllerReadiness.error) && <p role="status" aria-live="polite" className="text-amber-200 text-sm">Readiness probe unavailable: {orderReadiness.error ? 'Order API' : ''} {controllerReadiness.error ? 'Controller' : ''}. Health signals are unknown until a response succeeds.</p>}
          <Suspense fallback={<p role="status" aria-live="polite">Loading page…</p>}>
          {/* Screen Routing */}
          {activeScreen === 'dashboard' && (
            <DashboardView
              metrics={metrics}
              metricsError={metricsError}
              lastMetricsUpdated={lastMetricsUpdated}
              buffer={metricsBuffer}
              experiment={experiment}
              stale={!loaded || Boolean(error)}
              traffic={traffic}
              trafficBusy={trafficBusy}
              trafficError={trafficError}
              onToggleTraffic={handleToggleTraffic}
              orderReadiness={orderReadiness.error ? null : orderReadiness.data}
              controllerReadiness={controllerReadiness.error ? null : controllerReadiness.data}
              onNavigate={setActiveScreen}
            />
          )}

          {activeScreen === 'experiments' && (
            <div className="space-y-6">
              <TopologyBanner
                experiment={experiment}
                stale={!loaded || Boolean(error)}
                orderReadiness={orderReadiness.error ? null : orderReadiness.data}
                controllerReadiness={controllerReadiness.error ? null : controllerReadiness.data}
                onNavigate={setActiveScreen}
              />
              <ExperimentsView
                catalog={catalog.data}
                activeExperiment={experiment}
                latestExperiment={latestExperiment}
                detail={experimentDetail}
                detailError={detailError}
                detailLoading={detailLoading}
                blocked={blocked}
                busy={busy}
                onLaunch={launch}
                onTriggerEmergencyStop={() => setIsEmergencyModalOpen(true)}
                latestReport={experimentDetail?.ai_report}
                latestProposal={stagedProposal}
              />
            </div>
          )}

          {activeScreen === 'reports' && (
            <ReportsView
              client={client}
              catalog={catalog.data}
              onStageProposal={handleStageProposal}
              revision={revision}
            />
          )}

          {activeScreen === 'topology' && (
            <TopologyOverview
              orderLastSuccessAt={orderReadiness.lastSuccessAt}
              controllerLastSuccessAt={controllerReadiness.lastSuccessAt}
              experiment={experiment}
              stale={!loaded || Boolean(error)}
              orderReadiness={orderReadiness.error ? null : orderReadiness.data}
              controllerReadiness={controllerReadiness.error ? null : controllerReadiness.data}
              onNavigate={setActiveScreen}
            />
          )}

          {activeScreen === 'settings' && (
            <SettingsView
              controllerReadiness={controllerReadiness.error ? null : controllerReadiness.data}
              orderReadiness={orderReadiness.error ? null : orderReadiness.data}
              controllerError={controllerReadiness.error}
              orderError={orderReadiness.error}
              catalogError={catalog.error}
              controllerLastSuccessAt={controllerReadiness.lastSuccessAt}
              orderLastSuccessAt={orderReadiness.lastSuccessAt}
              apiPrefixes={client.displayPrefixes}
              catalog={catalog.data}
            />
          )}
          </Suspense>
        </main>

        <footer className="px-4 py-4 sm:px-8 border-t border-[#1E2942]/60 text-center sm:flex sm:justify-between font-mono text-[10px] text-[#9aa9ac] uppercase tracking-widest select-none">
          <span>FailureLab · AI-Assisted Resilience Engineering</span>
          <span className="hidden sm:inline">Transactional Outbox · Idempotent Fulfillment · SLO Watchdogs</span>
        </footer>
      </div>

      {/* Mobile-pinned emergency abort bar (visible on mobile only when fault is active) */}
      <MobilePinnedStopBar
        experiment={experiment}
        onTriggerStop={() => setIsEmergencyModalOpen(true)}
      />

      {/* Mobile bottom navigation rail (< 768px) */}
      <MobileNavBar
        activeScreen={activeScreen}
        onSelectScreen={setActiveScreen}
        isRunning={isRunning}
      />

      {/* Emergency Stop Confirmation Modal */}
      <EmergencyStopModal
        isOpen={isEmergencyModalOpen}
        experiment={experiment}
        onClose={() => setIsEmergencyModalOpen(false)}
        onConfirmStop={stop}
      />
    </div>
  );
}
