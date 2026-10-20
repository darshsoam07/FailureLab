import React from 'react';
import { LayoutDashboard, FlaskConical, FileText, Network, Settings, Activity, HelpCircle, BookOpen } from 'lucide-react';

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
      className="terminal-panel hidden md:flex fixed top-0 left-0 h-dvh w-16 lg:w-64 bg-sidebar border-r border-border/60 flex-col justify-between py-3 z-40 select-none transition-all duration-200"
      aria-label="Sidebar navigation"
    >
      <div className="flex flex-col gap-3">
        {/* Header / Logo Mark */}
        <div className="px-3 lg:px-4 flex items-center gap-2.5 h-12 border-b border-border/40 pb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-accent-ink/40 flex items-center justify-center shrink-0 shadow-sm">
            <Activity className="h-4 w-4 text-accent-ink" aria-hidden="true" />
          </div>
          <div className="hidden lg:flex flex-col min-w-0">
            <span className="text-[16px] font-bold text-foreground tracking-tight truncate leading-tight font-sans">
              FailureLab
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                aria-hidden="true"
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  isRunning ? 'bg-destructive glow-dot-red animate-pulse' : 'bg-success glow-dot-emerald'
                }`}
              />
              <span className="text-muted-foreground font-mono text-[9px] uppercase tracking-wider">
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
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 rounded-lg group transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  isActive
                    ? 'text-primary-foreground bg-sidebar-active border-l-2 border-sidebar-active font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface'
                }`}
                title={label}
              >
                <span className="relative shrink-0">
                  <Icon
                    className={`h-5 w-5 ${
                      isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                    aria-hidden="true"
                  />
                  {id === 'experiments' && isRunning && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-danger-button animate-ping"
                    />
                  )}
                </span>
                <span className="hidden lg:inline text-[13px] tracking-tight font-medium truncate">
                  {label}
                </span>
                {id === 'experiments' && isRunning && (
                  <span className="hidden lg:inline-block ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/60 font-bold uppercase animate-pulse">
                    Live
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Navigation Footer */}
      <div className="px-1.5 flex flex-col gap-1 border-t border-border/40 pt-3">
        <a
          href="#architecture" aria-label="Service Map"
          onClick={(e) => {
            e.preventDefault();
            onSelectScreen('topology');
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-surface px-3 py-2 flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          title="System Architecture"
        >
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline text-[12px] font-mono">Service Map</span>
        </a>
        <a
          href="#settings" aria-label="Environment settings"
          onClick={(e) => {
            e.preventDefault();
            onSelectScreen('settings');
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-surface px-3 py-2 flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          title="Runtime Settings"
        >
          <HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline text-[12px] font-mono">Environment</span>
        </a>
      </div>
    </aside>
  );
}
