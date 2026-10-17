import React, { useState } from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const SettingsView: React.FC = () => {
  const { currentCluster, sloThresholdMs } = useChaos();
  const [threshold, setThreshold] = useState<number>(sloThresholdMs);
  const [errorTripwire, setErrorTripwire] = useState<number>(1.0);
  const [autoAbort, setAutoAbort] = useState<boolean>(true);
  const [pagerdutyActive, setPagerdutyActive] = useState<boolean>(true);
  const [slackActive, setSlackActive] = useState<boolean>(true);
  const [savedNotification, setSavedNotification] = useState<boolean>(false);

  const handleSave = () => {
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-md">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#00e5ff] text-[20px]">
            tune
          </span>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Watchdog Guardrails & Resilience Configuration
          </h2>
        </div>
        <p className="text-xs text-[#849396] mt-1">
          Active Cluster: <span className="font-mono text-[#00e5ff]">{currentCluster}</span> · All guardrails enforced in real-time.
        </p>
      </div>

      {/* Guardrail Rules Section */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-6 shadow-md space-y-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono border-b border-[#1E2942] pb-3">
          1. Service Level Objective (SLO) Thresholds
        </h3>

        {/* P95 Latency Slider */}
        <div className="p-4 rounded-lg bg-[#0B1020] border border-[#1E2942] space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">P95 SLO Breach Ceiling</div>
              <div className="text-xs text-[#849396]">
                Alarm triggers danger zone when overall P95 latency exceeds this limit.
              </div>
            </div>
            <span className="font-mono text-lg font-bold text-red-400">{threshold} ms</span>
          </div>

          <input
            type="range"
            min="200"
            max="1000"
            step="50"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full h-1.5 bg-[#25293a] rounded appearance-none cursor-pointer accent-red-500"
          />
          <div className="flex justify-between text-[10px] font-mono text-[#849396]">
            <span>200ms (Aggressive)</span>
            <span>500ms (Production Default)</span>
            <span>1000ms (Relaxed)</span>
          </div>
        </div>

        {/* Error Rate Tripwire */}
        <div className="p-4 rounded-lg bg-[#0B1020] border border-[#1E2942] space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Error Rate Circuit Breaker</div>
              <div className="text-xs text-[#849396]">
                Automatically trips circuit breaker if 5xx error percentage exceeds this limit.
              </div>
            </div>
            <span className="font-mono text-lg font-bold text-amber-400">{errorTripwire.toFixed(1)}%</span>
          </div>

          <input
            type="range"
            min="0.2"
            max="5.0"
            step="0.1"
            value={errorTripwire}
            onChange={(e) => setErrorTripwire(Number(e.target.value))}
            className="w-full h-1.5 bg-[#25293a] rounded appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Auto-Abort Toggle */}
        <div className="p-4 rounded-lg bg-[#0B1020] border border-[#1E2942] flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Auto-Abort Experiments on SLO Breach</div>
            <div className="text-xs text-[#849396]">
              Instant kill-switch trigger if continuous breach persists for &gt; 5 seconds.
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoAbort}
              onChange={(e) => setAutoAbort(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-[#1a1f30] rounded-full peer peer-checked:bg-[#00e5ff] transition-all peer-checked:glow-cyan"></div>
            <div className="absolute left-1 top-1 bg-[#0B1020] w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>

        {/* Notification Webhooks */}
        <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono border-b border-[#1E2942] pb-3 pt-2">
          2. Emergency Alert Webhook Integrations
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-[#0B1020] border border-[#1E2942] flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">PagerDuty On-Call Sync</div>
              <div className="text-[11px] text-[#849396] font-mono">Service: order-core-p1</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={pagerdutyActive}
                onChange={(e) => setPagerdutyActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#1a1f30] rounded-full peer peer-checked:bg-emerald-400 transition-all"></div>
              <div className="absolute left-1 top-1 bg-[#0B1020] w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5"></div>
            </label>
          </div>

          <div className="p-4 rounded-lg bg-[#0B1020] border border-[#1E2942] flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Slack Incident Room</div>
              <div className="text-[11px] text-[#849396] font-mono">#war-room-chaos-drills</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={slackActive}
                onChange={(e) => setSlackActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#1a1f30] rounded-full peer peer-checked:bg-emerald-400 transition-all"></div>
              <div className="absolute left-1 top-1 bg-[#0B1020] w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5"></div>
            </label>
          </div>
        </div>

        {/* Save Bar */}
        <div className="pt-4 border-t border-[#1E2942] flex items-center justify-between">
          <div>
            {savedNotification && (
              <span className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Guardrail configuration synced to cluster!
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg bg-[#00e5ff] text-[#0e1323] hover:bg-[#00daf3] transition-all font-sans font-bold text-xs shadow-lg glow-cyan cursor-pointer"
          >
            Save Guardrail Policy
          </button>
        </div>
      </div>
    </div>
  );
};
