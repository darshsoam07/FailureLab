import React, { useState, useRef, useEffect } from 'react';
import { useChaos } from '../context/ChaosContext.tsx';

export const TopNavBar: React.FC = () => {
  const {
    currentScreen,
    currentCluster,
    setCurrentCluster,
    clusters,
    activeToxic,
    guardrailsActive,
    totalGuardrails,
    setIsEmergencyModalOpen,
    isTerminalOpen,
    setIsTerminalOpen,
    isNotificationsOpen,
    setIsNotificationsOpen,
    unreadAlertCount,
  } = useChaos();

  const [clusterDropdownOpen, setClusterDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setClusterDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getScreenTitle = () => {
    switch (currentScreen) {
      case 'dashboard':
        return 'Command Center Dashboard';
      case 'experiments':
        return 'Chaos Experiments Studio';
      case 'reports':
        return 'Resilience Reports & Post-Mortems';
      case 'topology':
        return 'Distributed System Topology';
      case 'settings':
        return 'System & Guardrail Settings';
      default:
        return 'Command Center Dashboard';
    }
  };

  return (
    <header className="sticky top-0 right-0 h-12 w-full z-40 bg-[#0e1323]/90 backdrop-blur-md border-b border-[#1E2942]/60 flex justify-between items-center px-4 md:px-6">
      {/* Left: Title, Cluster Pill, Steady State Health Pill */}
      <div className="flex items-center gap-3">
        <h1 className="text-[16px] md:text-[18px] font-bold text-[#dee1f9] tracking-tight truncate hidden sm:block">
          {getScreenTitle()}
        </h1>

        {/* Cluster Dropdown Pill */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setClusterDropdownOpen(!clusterDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#121A2F] border border-[#1E2942] hover:border-[#00e5ff]/40 transition-colors cursor-pointer group"
          >
            <span className="material-symbols-outlined text-[#849396] text-[14px]">
              hub
            </span>
            <span className="text-[#849396] group-hover:text-[#dee1f9] font-mono text-[11px] truncate max-w-[170px] sm:max-w-none">
              {currentCluster}
            </span>
            <span className="material-symbols-outlined text-[#849396] text-[14px]">
              expand_more
            </span>
          </button>

          {/* Dropdown Menu */}
          {clusterDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-64 rounded-lg bg-[#121A2F] border border-[#1E2942] shadow-xl py-1 z-50">
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase text-[#849396] border-b border-[#1E2942]/60">
                Select Active Cluster
              </div>
              {clusters.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCurrentCluster(c.name);
                    setClusterDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center justify-between hover:bg-[#1A2238] transition-colors cursor-pointer ${
                    currentCluster === c.name ? 'text-[#00e5ff] bg-[#00e5ff]/5' : 'text-[#dee1f9]'
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  {currentCluster === c.name && (
                    <span className="material-symbols-outlined text-[14px] text-[#00e5ff]">
                      check
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Steady State Health Pill */}
        <div
          className={`hidden lg:flex items-center gap-2 px-2.5 py-0.5 rounded-full border ${
            activeToxic?.running
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
              : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400'
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                activeToxic?.running ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            ></span>
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                activeToxic?.running ? 'bg-amber-500 glow-dot-amber' : 'bg-emerald-500 glow-dot-emerald'
              }`}
            ></span>
          </span>
          <span className="font-mono text-[11px] font-medium">
            {activeToxic?.running ? `Chaos active: ${activeToxic.type}` : 'All services ready'}
          </span>
        </div>
      </div>

      {/* Right: Watchdogs, Trailing Actions & Emergency Stop */}
      <div className="flex items-center gap-3">
        {/* Watchdog Safety Status */}
        <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1a1f30] border border-[#1E2942] font-mono text-[11px] text-[#849396]">
          <span className="material-symbols-outlined text-[#a8ffd2] text-[14px]">
            check_circle
          </span>
          <span className="text-[#dee1f9] font-semibold">{guardrailsActive}/{totalGuardrails}</span> GUARDRAILS ACTIVE
        </div>

        {/* Terminal & Notification Icons */}
        <div className="flex items-center gap-1 text-[#849396]">
          <button
            onClick={() => setIsTerminalOpen(!isTerminalOpen)}
            className={`w-8 h-8 rounded flex items-center justify-center hover:bg-[#25293a]/40 hover:text-[#dee1f9] transition-colors relative cursor-pointer ${
              isTerminalOpen ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : ''
            }`}
            title="CLI Stream Logs"
          >
            <span className="material-symbols-outlined text-[18px]">terminal</span>
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#00e5ff]"></span>
          </button>

          <button
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className={`w-8 h-8 rounded flex items-center justify-center hover:bg-[#25293a]/40 hover:text-[#dee1f9] transition-colors relative cursor-pointer ${
              isNotificationsOpen ? 'bg-[#00e5ff]/20 text-[#00e5ff]' : ''
            }`}
            title="Alert Notifications"
          >
            <span className="material-symbols-outlined text-[18px]">notifications</span>
            {unreadAlertCount > 0 && (
              <span className="absolute top-1 right-1 px-1 min-w-[14px] h-[14px] text-[9px] font-mono font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                {unreadAlertCount}
              </span>
            )}
          </button>
        </div>

        <div className="h-4 w-[1px] bg-[#1E2942]"></div>

        {/* Emergency Stop Trigger Button */}
        <button
          onClick={() => setIsEmergencyModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#93000a] text-white border border-red-500/50 hover:bg-red-600 transition-all font-sans font-semibold tracking-wide text-xs glow-red active:scale-95 cursor-pointer shadow-lg"
          title="Emergency Abort All Faults"
        >
          <span className="material-symbols-outlined text-[16px] text-white animate-pulse">
            error
          </span>
          <span className="whitespace-nowrap">Emergency Stop</span>
        </button>
      </div>
    </header>
  );
};
