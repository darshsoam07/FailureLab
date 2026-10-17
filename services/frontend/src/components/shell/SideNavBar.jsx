import React from 'react';
import {
  LayoutDashboard,
  FlaskConical,
  FileText,
  Network,
  Settings,
  Activity,
  HelpCircle,
  BookOpen,
} from 'lucide-react';

const NAV_CONFIG = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'experiments', label: 'Experiments', Icon: FlaskConical },
  { id: 'reports', label: 'Reports', Icon: FileText },
  { id: 'topology', label: 'Topology', Icon: Network },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

/**
 * Side navigation bar with responsive collapse (icon rail on tablet, drawer/hidden on mobile).
 *
 * @param {Object} props
 * @param {string} props.activeScreen - Current active tab id
 * @param {(screenId: string) => void} props.onSelectScreen - Navigation handler
 * @param {boolean} [props.isRunning=false] - Whether an experiment is actively RUNNING
 */
export function SideNavBar({ activeScreen, onSelectScreen, isRunning = false }) {
  return (
    <aside
      className="hidden md:flex fixed top-0 left-0 h-screen w-16 lg:w-64 bg-[#080d1d] border-r border-[#1E2942]/60 flex-col justify-between py-3 z-40 select-none transition-all duration-200"
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-col gap-3">
        {/* Header / Logo Mark */}
        <div className="px-3 lg:px-4 flex items-center gap-2.5 h-12 border-b border-[#1E2942]/40 pb-2">
          <div className="w-8 h-8 rounded-lg bg-[#00e5ff]/10 border border-[#00e5ff]/40 flex items-center justify-center shrink-0 shadow-sm">
            <Activity className="h-4 w-4 text-[#00e5ff]" aria-hidden="true" />
          </div>
          <div className="hidden lg:flex flex-col min-w-0">
            <span className="text-[16px] font-bold text-[#c3f5ff] tracking-tight truncate leading-tight font-sans">
              FailureLab
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                aria-hidden="true"
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  isRunning ? 'bg-red-400 glow-dot-red animate-pulse' : 'bg-[#10b981] glow-dot-emerald'
                }`}
              />
              <span className="text-[#849396] font-mono text-[9px] uppercase tracking-wider">
                {isRunning ? 'FAULT ACTIVE' : 'COMMAND CENTER'}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-col gap-1 px-1.5" aria-label="Main Navigation">
          {NAV_CONFIG.map(({ id, label, Icon }) => {
            const isActive = activeScreen === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectScreen(id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 rounded-lg group transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff] ${
                  isActive
                    ? 'text-[#c3f5ff] bg-[#25293a]/50 border-l-2 border-[#00e5ff] font-semibold shadow-inner'
                    : 'text-[#849396] hover:text-[#dee1f9] hover:bg-[#161b2b]'
                }`}
                title={label}
              >
                <span className="relative shrink-0">
                  <Icon
                    className={`h-5 w-5 ${
                      isActive ? 'text-[#00e5ff]' : 'text-[#849396] group-hover:text-[#dee1f9]'
                    }`}
                    aria-hidden="true"
                  />
                  {id === 'experiments' && isRunning && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 animate-ping"
                    />
                  )}
                </span>
                <span className="hidden lg:inline text-[13px] tracking-tight font-medium truncate">
                  {label}
                </span>
                {id === 'experiments' && isRunning && (
                  <span className="hidden lg:inline-block ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/60 font-bold uppercase animate-pulse">
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
          href="#architecture"
          onClick={(e) => {
            e.preventDefault();
            onSelectScreen('topology');
          }}
          className="text-[#849396] hover:text-[#dee1f9] hover:bg-[#161b2b] px-3 py-2 flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff]"
          title="System Architecture"
        >
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline text-[12px] font-mono">Service Map</span>
        </a>
        <a
          href="#settings"
          onClick={(e) => {
            e.preventDefault();
            onSelectScreen('settings');
          }}
          className="text-[#849396] hover:text-[#dee1f9] hover:bg-[#161b2b] px-3 py-2 flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff]"
          title="Runtime Settings"
        >
          <HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline text-[12px] font-mono">Environment</span>
        </a>
      </div>
    </aside>
  );
}
