import { useCallback, useEffect, useRef, useState } from 'react';
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
import { DashboardView } from './components/dashboard/DashboardView.jsx';
import { ExperimentsView } from './components/experiments/ExperimentsView.jsx';
import TopologyBanner from './components/TopologyBanner.jsx';
import ExperimentLauncher from './components/ExperimentLauncher.jsx';
import ExperimentHistoryAndAIReport from './components/ExperimentHistoryAndAIReport.jsx';
import { TopologyOverview } from './components/topology/TopologyOverview.jsx';
import { SettingsView } from './components/settings/SettingsView.jsx';

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
  const mutation = useRef(null);

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
    const controller = new AbortController();
    let timer;

    async function pollTelemetry() {
      const started = performance.now();
      await Promise.allSettled([
        client.getMetricsSummary({ signal: controller.signal, since: metricsSince })
          .then(data => {
            if (controller.signal.aborted) return;
            const now = Date.now();
            setMetrics(data);
            setLastMetricsUpdated(now);
            setMetricsError(null);
            setMetricsBuffer(prev => appendMetricsPoint(prev, data, now));
          })
          .catch(err => {
            if (controller.signal.aborted) return;
            // On failure: retain last good data, set error banner, do NOT append null as 0
            setMetricsError(err.message || 'Metrics polling failed');
          }),

        client.getTrafficStatus({ signal: controller.signal })
          .then(data => {
            if (controller.signal.aborted || trafficMutation.current) return;
            setTraffic(data);
            setTrafficError(null);
          })
          .catch(err => {
            if (controller.signal.aborted || trafficMutation.current) return;
            setTrafficError(err.message || 'Traffic status polling failed');
          }),
      ]);

      if (!controller.signal.aborted) {
        timer = setTimeout(pollTelemetry, Math.max(0, 2000 - (performance.now() - started)));
      }
    }

    pollTelemetry();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, metricsSince]);

  // Single Detail Polling Source for Current / Most Recent Experiment
  const [experimentDetail, setExperimentDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const targetExperimentId = latestExperiment?.id;
  const isTargetRunning = latestExperiment?.status === 'RUNNING';

  useEffect(() => {
    if (!targetExperimentId) {
      setExperimentDetail(null);
      setDetailError(null);
      return;
    }

    const controller = new AbortController();
    let timer;

    async function pollDetail() {
      const started = performance.now();
      try {
        const data = await client.getExperiment(targetExperimentId, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setExperimentDetail(data);
          setDetailError(null);
          setDetailLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          // Retain last good data on error and display degraded message
          setDetailError(err.message || 'Failed to sync experiment detail');
          setDetailLoading(false);
        }
      }

      // Single source of truth: poll GET /api/experiments/{id} ONLY while it is RUNNING
      if (!controller.signal.aborted && isTargetRunning) {
        timer = setTimeout(pollDetail, Math.max(0, 2000 - (performance.now() - started)));
      }
    }

    setDetailLoading(true);
    pollDetail();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, targetExperimentId, isTargetRunning, revision]);

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
          controllerReadiness={controllerReadiness.data}
          controllerError={controllerReadiness.error}
          controllerLoading={controllerReadiness.loading}
          onOpenEmergencyStop={() => setIsEmergencyModalOpen(true)}
        />

        {/* Page Content: pb-36 guarantees mobile bottom nav + pinned stop bar never cover content */}
        <main id="main" className="flex-1 px-4 py-6 sm:px-8 sm:py-8 pb-36 md:pb-12 max-w-[1440px] w-full mx-auto space-y-6">
          {/* Status Notices */}
          {notice && (
            <div
              role="status"
              className="rounded-xl border border-[#1E2942] bg-[#121A2F] px-4 py-3 text-xs font-mono text-[#c3f5ff] flex items-center justify-between shadow-md"
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-[#849396] hover:text-white text-xs underline font-sans cursor-pointer ml-3 shrink-0"
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
              orderReadiness={orderReadiness.data}
              controllerReadiness={controllerReadiness.data}
              onNavigate={setActiveScreen}
            />
          )}

          {activeScreen === 'experiments' && (
            <div className="space-y-6">
              <TopologyBanner
                experiment={experiment}
                stale={!loaded || Boolean(error)}
                orderReadiness={orderReadiness.data}
                controllerReadiness={controllerReadiness.data}
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
              />
            </div>
          )}

          {activeScreen === 'reports' && (
            <div className="space-y-6">
              <ExperimentHistoryAndAIReport
                catalog={catalog.data}
                blocked={blocked || Boolean(experiment)}
                busy={busy}
                onLaunch={launch}
                revision={revision}
                client={client}
              />
            </div>
          )}

          {activeScreen === 'topology' && (
            <TopologyOverview
              experiment={experiment}
              stale={!loaded || Boolean(error)}
              orderReadiness={orderReadiness.data}
              controllerReadiness={controllerReadiness.data}
              onNavigate={setActiveScreen}
            />
          )}

          {activeScreen === 'settings' && (
            <SettingsView
              controllerReadiness={controllerReadiness.data}
              catalog={catalog.data}
            />
          )}
        </main>

        <footer className="px-4 py-4 sm:px-8 border-t border-[#1E2942]/60 text-center sm:flex sm:justify-between font-mono text-[10px] text-[#849396] uppercase tracking-widest select-none">
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
