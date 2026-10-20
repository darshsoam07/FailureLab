import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const NotificationsDrawer: React.FC = () => {
  const {
    isNotificationsOpen,
    setIsNotificationsOpen,
    alerts,
    markAlertAsRead,
    dismissAllAlerts,
    unreadAlertCount,
  } = useChaos();

  if (!isNotificationsOpen) return null;

  return (
    <div className="fixed top-12 right-4 md:right-6 w-80 md:w-96 z-50 rounded-xl bg-[#121A2F] border border-[#1E2942] shadow-2xl p-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#1E2942]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#00e5ff] text-[18px]">
            notifications
          </span>
          <h3 className="text-sm font-bold text-white font-sans">System Guardrail Feed</h3>
          {unreadAlertCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-red-500/20 text-red-300 border border-red-500/40">
              {unreadAlertCount} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadAlertCount > 0 && (
            <button
              onClick={dismissAllAlerts}
              className="text-[10px] text-[#00e5ff] hover:underline cursor-pointer"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={() => setIsNotificationsOpen(false)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#1E2942] text-[#849396] hover:text-white cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {/* Alerts list */}
      <div className="mt-3 max-h-[360px] overflow-y-auto space-y-2 pr-1">
        {alerts.length === 0 ? (
          <div className="text-center py-6 text-xs text-[#849396]">
            No watchdog alerts or notices recorded.
          </div>
        ) : (
          alerts.map((alert) => {
            const isDanger = alert.type === 'danger';
            const isWarning = alert.type === 'warning';

            return (
              <div
                key={alert.id}
                onClick={() => markAlertAsRead(alert.id)}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                  !alert.read ? 'bg-[#0B1020]' : 'bg-[#0e162d]/50 opacity-80'
                } ${
                  isDanger
                    ? 'border-red-500/40 hover:border-red-500/80'
                    : isWarning
                    ? 'border-amber-500/40 hover:border-amber-500/80'
                    : 'border-[#1E2942] hover:border-[#00e5ff]/40'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span
                    className={`font-semibold uppercase ${
                      isDanger ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-[#00e5ff]'
                    }`}
                  >
                    {alert.title}
                  </span>
                  <span className="text-[#849396]">{alert.timestamp} UTC</span>
                </div>
                <p className="text-[11px] text-[#dee1f9]/90 leading-tight">
                  {alert.description}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
