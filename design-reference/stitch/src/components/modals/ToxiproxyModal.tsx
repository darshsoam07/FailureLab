import React, { useState } from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const ToxiproxyModal: React.FC = () => {
  const {
    isToxiproxyModalOpen,
    setIsToxiproxyModalOpen,
    activeToxic,
    injectToxic,
    stopActiveToxic,
  } = useChaos();

  const [toxicType, setToxicType] = useState<'latency' | 'jitter' | 'bandwidth' | 'timeout'>('latency');
  const [latencyMs, setLatencyMs] = useState<number>(350);
  const [jitterMs, setJitterMs] = useState<number>(50);
  const [duration, setDuration] = useState<number>(45);
  const [targetService, setTargetService] = useState<string>('downstream');

  if (!isToxiproxyModalOpen) return null;

  const handleInject = () => {
    injectToxic(targetService, toxicType, latencyMs, jitterMs, duration);
    setIsToxiproxyModalOpen(false);
  };

  const handleStop = () => {
    stopActiveToxic();
  };

  const presets = [
    {
      name: 'Moderate Latency (+350ms)',
      desc: 'P95 stays safely below 500ms SLO threshold',
      latency: 350,
      jitter: 40,
      type: 'latency' as const,
      color: 'border-[#00e5ff]/50 text-[#00e5ff]',
    },
    {
      name: 'SLO Breach Spike (+550ms)',
      desc: 'Trips 500ms SLO Breach Risk alarm in red zone',
      latency: 550,
      jitter: 80,
      type: 'latency' as const,
      color: 'border-red-500/60 text-red-400',
    },
    {
      name: 'Network Jitter & Slicer (+250ms)',
      desc: 'Fluctuating TCP packet arrival intervals',
      latency: 250,
      jitter: 140,
      type: 'jitter' as const,
      color: 'border-amber-500/60 text-amber-300',
    },
    {
      name: 'Heavy Timeout (+900ms)',
      desc: 'Forces downstream gRPC circuit breaker trips',
      latency: 900,
      jitter: 60,
      type: 'timeout' as const,
      color: 'border-purple-500/60 text-purple-300',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-xl rounded-xl bg-[#121A2F] border-2 border-amber-500/70 p-6 shadow-2xl glow-amber max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={() => setIsToxiproxyModalOpen(false)}
          className="absolute top-4 right-4 text-[#849396] hover:text-white transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#1E2942]">
          <div className="w-10 h-10 rounded-lg bg-amber-950/60 border border-amber-500/50 flex items-center justify-center">
            <span className="material-symbols-outlined text-amber-400 text-[22px]">bolt</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Toxiproxy Fault Engine
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40">
                Port :8474
              </span>
            </h3>
            <p className="text-xs text-[#849396]">
              Inject TCP/gRPC latency, bandwidth limits, and timeouts into microservices
            </p>
          </div>
        </div>

        {/* Active Toxic Banner if Running */}
        {activeToxic?.running && (
          <div className="mt-4 p-3.5 rounded-lg bg-red-950/40 border border-red-500/60 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-red-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                ACTIVE TOXIC: {activeToxic.type.toUpperCase()} (+{activeToxic.latencyMs}ms)
              </div>
              <div className="text-[11px] text-[#849396] font-mono mt-0.5">
                Target: {activeToxic.target} · Remaining: <span className="text-white font-bold">{activeToxic.remainingSeconds}s</span>
              </div>
            </div>
            <button
              onClick={handleStop}
              className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-mono text-xs font-bold transition-all shadow cursor-pointer"
            >
              STOP TOXIC
            </button>
          </div>
        )}

        {/* Preset Experiments */}
        <div className="mt-4">
          <label className="text-[11px] font-sans font-semibold text-[#849396] uppercase tracking-wider block mb-2">
            Quick Injection Presets
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presets.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setLatencyMs(preset.latency);
                  setJitterMs(preset.jitter);
                  setToxicType(preset.type);
                }}
                className={`text-left p-3 rounded-lg bg-[#0B1020] border hover:bg-[#161f36] transition-all cursor-pointer ${
                  latencyMs === preset.latency ? preset.color + ' ring-1' : 'border-[#1E2942] text-[#dee1f9]'
                }`}
              >
                <div className="text-xs font-bold">{preset.name}</div>
                <div className="text-[10px] text-[#849396] mt-0.5">{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Configuration Form */}
        <div className="mt-5 space-y-4 bg-[#0B1020] p-4 rounded-lg border border-[#1E2942]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-sans font-semibold text-[#849396] uppercase block mb-1">
                Target Service
              </label>
              <select
                value={targetService}
                onChange={(e) => setTargetService(e.target.value)}
                className="w-full bg-[#121A2F] border border-[#1E2942] rounded px-3 py-1.5 text-xs text-[#dee1f9] font-mono focus:border-[#00e5ff] focus:outline-none cursor-pointer"
              >
                <option value="downstream">Inventory Service (gRPC :50051)</option>
                <option value="persistence">PostgreSQL Outbox (:5432)</option>
                <option value="queue">RabbitMQ Broker (:5672)</option>
                <option value="gateway">Order API Gateway (:8000)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-sans font-semibold text-[#849396] uppercase block mb-1">
                Toxic Primitive
              </label>
              <select
                value={toxicType}
                onChange={(e) => setToxicType(e.target.value as any)}
                className="w-full bg-[#121A2F] border border-[#1E2942] rounded px-3 py-1.5 text-xs text-[#dee1f9] font-mono focus:border-[#00e5ff] focus:outline-none cursor-pointer"
              >
                <option value="latency">Latency (ms)</option>
                <option value="jitter">Network Jitter (ms)</option>
                <option value="bandwidth">Bandwidth Throttle</option>
                <option value="timeout">Timeout / Slicer</option>
              </select>
            </div>
          </div>

          {/* Latency Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#849396]">Injected Latency:</span>
              <span className="font-mono font-bold text-[#00e5ff]">{latencyMs} ms</span>
            </div>
            <input
              type="range"
              min="50"
              max="950"
              step="25"
              value={latencyMs}
              onChange={(e) => setLatencyMs(Number(e.target.value))}
              className="w-full h-1.5 bg-[#25293a] rounded appearance-none cursor-pointer accent-[#00e5ff]"
            />
            <div className="flex justify-between text-[10px] font-mono text-[#849396] mt-1">
              <span>50ms</span>
              <span className="text-red-400 font-semibold">500ms SLO Threshold</span>
              <span>950ms</span>
            </div>
          </div>

          {/* Jitter & Duration Row */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-[#849396]">Jitter (±):</span>
                <span className="font-mono text-amber-300 font-semibold">{jitterMs} ms</span>
              </div>
              <input
                type="range"
                min="0"
                max="150"
                step="10"
                value={jitterMs}
                onChange={(e) => setJitterMs(Number(e.target.value))}
                className="w-full h-1.5 bg-[#25293a] rounded appearance-none cursor-pointer accent-amber-400"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-[#849396]">Duration:</span>
                <span className="font-mono text-white font-semibold">{duration}s</span>
              </div>
              <input
                type="range"
                min="15"
                max="120"
                step="5"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full h-1.5 bg-[#25293a] rounded appearance-none cursor-pointer accent-white"
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 mt-5 pt-3 border-t border-[#1E2942]">
          <button
            onClick={() => setIsToxiproxyModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold text-[#849396] hover:text-[#dee1f9] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleInject}
            className="px-5 py-2 text-xs font-bold text-[#0e1323] bg-amber-400 hover:bg-amber-300 rounded-lg shadow-lg glow-amber transition-all active:scale-95 flex items-center gap-2 cursor-pointer font-sans"
          >
            <span className="material-symbols-outlined text-[16px]">bolt</span>
            <span>INJECT CHAOS TOXIC</span>
          </button>
        </div>
      </div>
    </div>
  );
};
