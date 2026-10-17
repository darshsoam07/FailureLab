import React from 'react';
import { ChaosProvider, useChaos } from './context/ChaosContext.tsx';
import { SideNavBar } from './components/SideNavBar.tsx';
import { TopNavBar } from './components/TopNavBar.tsx';
import { KpiCards } from './components/dashboard/KpiCards.tsx';
import { LatencyChart } from './components/dashboard/LatencyChart.tsx';
import { TrafficControlCard } from './components/dashboard/TrafficControlCard.tsx';
import { SystemTopology } from './components/dashboard/SystemTopology.tsx';
import { ExperimentsView } from './components/experiments/ExperimentsView.tsx';
import { ReportsView } from './components/reports/ReportsView.tsx';
import { TopologyView } from './components/topology/TopologyView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { EmergencyStopModal } from './components/modals/EmergencyStopModal.tsx';
import { ToxiproxyModal } from './components/modals/ToxiproxyModal.tsx';
import { NodeDetailModal } from './components/modals/NodeDetailModal.tsx';
import { CliTerminalDrawer } from './components/modals/CliTerminalDrawer.tsx';
import { NotificationsDrawer } from './components/modals/NotificationsDrawer.tsx';

const AppContent: React.FC = () => {
  const { currentScreen } = useChaos();

  return (
    <div className="bg-[#080d1d] text-[#dee1f9] antialiased min-h-screen flex selection:bg-[#00e5ff] selection:text-[#00363d] relative">
      {/* Side Navigation Rail */}
      <SideNavBar />

      {/* Main Workspace Frame */}
      <div className="flex-1 ml-16 md:ml-64 flex flex-col min-w-0 bg-[#0B1020] min-h-screen">
        {/* Dense Header */}
        <TopNavBar />

        {/* Content Canvas (Fluid 12-Column Frame, dark mission control) */}
        <main className="flex-1 p-4 md:p-6 max-w-[1920px] w-full mx-auto space-y-4 md:space-y-6">
          {currentScreen === 'dashboard' && (
            <>
              {/* Row 1: Four KPI Cards */}
              <KpiCards />

              {/* Row 2: Latency Chart (2/3) & Traffic Control (1/3) */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                <LatencyChart />
                <TrafficControlCard />
              </section>

              {/* Row 3: System Topology Banner */}
              <SystemTopology />
            </>
          )}

          {currentScreen === 'experiments' && <ExperimentsView />}
          {currentScreen === 'reports' && <ReportsView />}
          {currentScreen === 'topology' && <TopologyView />}
          {currentScreen === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Interactive Global Modals and Drawers */}
      <EmergencyStopModal />
      <ToxiproxyModal />
      <NodeDetailModal />
      <CliTerminalDrawer />
      <NotificationsDrawer />
    </div>
  );
};

export default function App() {
  return (
    <ChaosProvider>
      <AppContent />
    </ChaosProvider>
  );
}
