import React from 'react';
import { useChaos } from '../context/ChaosContext.tsx';
import { ScreenTab } from '../types/chaos.ts';

export const SideNavBar: React.FC = () => {
  const { currentScreen, setCurrentScreen } = useChaos();

  const navItems: { id: ScreenTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'experiments', label: 'Experiments', icon: 'science' },
    { id: 'reports', label: 'Reports', icon: 'assessment' },
    { id: 'topology', label: 'Topology', icon: 'hub' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <aside className="fixed top-0 left-0 h-screen w-16 md:w-64 bg-[#080d1d] border-r border-[#1E2942]/60 flex flex-col justify-between py-3 z-50 select-none">
      <div className="flex flex-col gap-3">
        {/* Header / Logo Mark */}
        <div className="px-3 md:px-4 flex items-center gap-2.5 h-10 border-b border-[#1E2942]/40 pb-2">
          <div className="w-8 h-8 rounded-lg bg-[#00e5ff]/10 border border-[#00e5ff]/40 flex items-center justify-center shrink-0 shadow-sm">
            <span className="material-symbols-outlined text-[#00e5ff] text-[18px] font-bold">
              dns
            </span>
          </div>
          <div className="hidden md:flex flex-col min-w-0">
            <span className="text-[17px] font-bold text-[#c3f5ff] tracking-tight truncate leading-tight font-sans">
              FailureLab
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#10b981] glow-dot-emerald"></span>
              <span className="text-[#849396] font-mono text-[9px] uppercase tracking-wider">
                prod-east-order
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-col gap-1 px-1.5">
          {navItems.map((item) => {
            const isActive = currentScreen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentScreen(item.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 rounded-r-lg group transition-colors duration-150 active:scale-[0.98] cursor-pointer ${
                  isActive
                    ? 'text-[#c3f5ff] bg-[#25293a]/40 border-l-2 border-[#00e5ff] font-semibold'
                    : 'text-[#849396] hover:text-[#dee1f9] hover:bg-[#161b2b]'
                }`}
                title={item.label}
              >
                <span
                  className={`material-symbols-outlined shrink-0 text-[20px] ${
                    isActive ? 'text-[#00e5ff]' : 'text-[#849396] group-hover:text-[#dee1f9]'
                  }`}
                >
                  {item.icon}
                </span>
                <span className="hidden md:inline text-[13px] tracking-tight font-medium">
                  {item.label}
                </span>
                {item.id === 'experiments' && (
                  <span className="hidden md:inline-block ml-auto text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20">
                    Live
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Navigation Footer */}
      <div className="px-1.5 flex flex-col gap-1 border-t border-[#1E2942]/40 pt-3">
        <a
          href="#docs"
          onClick={(e) => {
            e.preventDefault();
            alert('FailureLab Docs: Chaos orchestration manual, Toxiproxy client API, and circuit breaker runbooks.');
          }}
          className="text-[#849396] hover:text-[#dee1f9] hover:bg-[#161b2b] px-3 py-2 flex items-center gap-2.5 rounded-r-lg transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">menu_book</span>
          <span className="hidden md:inline text-[13px]">Docs</span>
        </a>
        <a
          href="#help"
          onClick={(e) => {
            e.preventDefault();
            alert('FailureLab Guardrail Support: Watchdog threshold guide and recovery telemetry.');
          }}
          className="text-[#849396] hover:text-[#dee1f9] hover:bg-[#161b2b] px-3 py-2 flex items-center gap-2.5 rounded-r-lg transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">help</span>
          <span className="hidden md:inline text-[13px]">Help</span>
        </a>
      </div>
    </aside>
  );
};
