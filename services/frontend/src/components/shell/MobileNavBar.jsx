import React from 'react';
import { LayoutDashboard, FlaskConical, FileText, Network, Settings } from 'lucide-react';

const NAV_CONFIG = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'experiments', label: 'Experiments', Icon: FlaskConical },
  { id: 'reports', label: 'Reports', Icon: FileText },
  { id: 'topology', label: 'Topology', Icon: Network },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

/**
 * Mobile bottom navigation bar for viewports < 768px.
 *
 * @param {Object} props
 * @param {string} props.activeScreen
 * @param {(screenId: string) => void} props.onSelectScreen
 * @param {boolean} [props.isRunning=false]
 */
export function MobileNavBar({ activeScreen, onSelectScreen, isRunning = false }) {
  return (
    <nav
      className="terminal-panel md:hidden fixed bottom-0 left-0 right-0 h-14 bg-sidebar border-t border-border/80 flex items-center justify-around px-2 z-40 select-none"
      aria-label="Mobile Navigation"
    >
      {NAV_CONFIG.map(({ id, label, Icon }) => {
        const isActive = activeScreen === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectScreen(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex flex-col items-center justify-center flex-1 py-1 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              isActive
                ? 'text-accent-ink font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden="true" />
              {id === 'experiments' && isRunning && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-danger-button animate-ping"
                />
              )}
            </span>
            <span className="text-[10px] tracking-tight mt-0.5 truncate font-sans">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
