import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const TrafficControlCard: React.FC = () => {
  const {
    backgroundTraffic,
    setBackgroundTraffic,
    requestsPerSecond,
    setRequestsPerSecond,
    totalAttempts,
    totalSuccesses,
  } = useChaos();

  // Compute live fidelity percentage
  const fidelity = totalAttempts > 0
    ? ((totalSuccesses / totalAttempts) * 100).toFixed(2)
    : '99.96';

  return (
    <div className="lg:col-span-4 rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 md:p-5 flex flex-col justify-between shadow-md">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1E2942]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#00E5FF] text-[18px]">
              tune
            </span>
            <h2 className="text-[17px] font-semibold text-[#dee1f9]">Traffic Control</h2>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#00E5FF]/10 text-[#00E5FF] border border-[#00E5FF]/30 font-semibold tracking-wider">
            SYNTHETIC GEN
          </span>
        </div>

        {/* Background Traffic Toggle Control */}
        <div className="mt-4 p-3.5 rounded-lg bg-[#0B1020] border border-[#1E2942] flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium text-[#dee1f9]">Background Traffic</div>
            <div className="text-[11px] text-[#849396]">Injecting simulated customer orders</div>
          </div>

          {/* Glowing Cyan Switch */}
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={backgroundTraffic}
              onChange={(e) => setBackgroundTraffic(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-[#1a1f30] rounded-full peer peer-checked:bg-[#00E5FF] transition-all peer-checked:glow-cyan"></div>
            <div className="absolute left-1 top-1 bg-[#0B1020] w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5 shadow-sm"></div>
          </label>
        </div>

        {/* RPS Rate Slider */}
        <div className="mt-3.5 p-3.5 rounded-lg bg-[#0B1020] border border-[#1E2942]">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
              REQUESTS PER SECOND
            </label>
            <span className="font-mono text-[17px] text-[#00E5FF] font-semibold">
              {requestsPerSecond} <span className="text-[12px] font-normal text-[#849396]">req/s</span>
            </span>
          </div>

          <input
            type="range"
            min="1"
            max="20"
            value={requestsPerSecond}
            onChange={(e) => setRequestsPerSecond(Number(e.target.value))}
            className="w-full h-1.5 bg-[#25293a] rounded appearance-none cursor-pointer accent-[#00E5FF]"
          />

          <div className="flex justify-between items-center text-[10px] font-mono text-[#849396] mt-1.5">
            <span>1 req/s</span>
            <span className="text-amber-400/80">Threshold: 15 req/s</span>
            <span>20 req/s</span>
          </div>
        </div>
      </div>

      {/* Counter Telemetry Blocks */}
      <div className="mt-4 pt-3 border-t border-[#1E2942] space-y-2">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="p-2 rounded bg-[#0B1020] border border-[#1E2942]">
            <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
              Attempts
            </div>
            <div className="text-[14px] font-mono text-[#dee1f9] font-semibold mt-0.5 tabular-nums">
              {totalAttempts.toLocaleString()}
            </div>
          </div>

          <div className="p-2 rounded bg-[#0B1020] border border-[#1E2942]">
            <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
              Successes
            </div>
            <div className="text-[14px] font-mono text-emerald-400 font-semibold mt-0.5 tabular-nums">
              {totalSuccesses.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Success Rate Bar */}
        <div className="p-2.5 rounded bg-[#0B1020] border border-[#1E2942]">
          <div className="flex justify-between items-center text-[11px] font-mono mb-1.5">
            <span className="text-[#849396]">Success Fidelity</span>
            <span className="text-emerald-400 font-semibold">{fidelity}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#25293a] overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, Number(fidelity)))}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};
