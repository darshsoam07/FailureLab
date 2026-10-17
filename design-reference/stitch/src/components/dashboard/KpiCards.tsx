import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const KpiCards: React.FC = () => {
  const { p95Latency, errorRate, ordersPerSecond, ordersReserved, activeToxic, sloThresholdMs } = useChaos();

  const isDegraded = p95Latency >= 250;
  const isBreached = p95Latency >= sloThresholdMs;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* KPI 1: P95 LATENCY */}
      <div className={`rounded-xl bg-[#121A2F] border ${
        isBreached ? 'border-red-500/80 glow-red' : isDegraded ? 'border-amber-500/70 glow-amber' : 'border-[#1E2942]'
      } p-4 flex flex-col justify-between hover:border-[#22304D] transition-all relative overflow-hidden group shadow-md`}>
        <div className="flex items-center justify-between text-[10px] font-sans font-semibold text-[#849396]">
          <span className="tracking-widest uppercase">P95 LATENCY</span>
          <span className={`flex items-center font-mono text-[11px] font-medium ${
            isDegraded ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            {activeToxic?.running ? `+${p95Latency - 132}ms vs baseline` : '-8ms vs baseline'}
          </span>
        </div>

        <div className="my-1.5 flex items-baseline justify-between">
          <span className={`font-mono text-[28px] leading-8 font-semibold ${
            isBreached ? 'text-red-400' : isDegraded ? 'text-amber-300' : 'text-[#dee1f9]'
          }`}>
            {p95Latency} <span className="text-[18px] font-normal text-[#849396]">ms</span>
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
            isBreached
              ? 'bg-red-950/60 text-red-300 border-red-800/60 font-bold animate-pulse'
              : isDegraded
              ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
              : 'bg-emerald-950/50 text-emerald-300 border-emerald-800/40'
          }`}>
            {isBreached ? 'SLO BREACH' : isDegraded ? 'DEGRADED' : 'HEALTHY'}
          </span>
        </div>

        {/* Sparkline */}
        <div className="h-8 w-full mt-1">
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 24">
            <defs>
              <linearGradient id="cyan-grad-kpi" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={isBreached ? '#ef4444' : isDegraded ? '#f59e0b' : '#00daf3'} />
                <stop offset="100%" stopColor={isBreached ? '#ef4444' : isDegraded ? '#f59e0b' : '#00daf3'} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={isDegraded ? "M0,18 Q15,14 30,16 T50,8 T75,4 T100,2" : "M0,18 Q15,16 25,12 T50,14 T75,9 T100,8"}
              fill="none"
              stroke={isBreached ? '#ef4444' : isDegraded ? '#f59e0b' : '#00daf3'}
              strokeLinecap="round"
              strokeWidth="2"
            />
            <path
              d={isDegraded ? "M0,18 Q15,14 30,16 T50,8 T75,4 T100,2 L100,24 L0,24 Z" : "M0,18 Q15,16 25,12 T50,14 T75,9 T100,8 L100,24 L0,24 Z"}
              fill="url(#cyan-grad-kpi)"
              opacity="0.2"
            />
          </svg>
        </div>
      </div>

      {/* KPI 2: ERROR RATE */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 flex flex-col justify-between hover:border-[#22304D] transition-colors relative overflow-hidden group shadow-md">
        <div className="flex items-center justify-between text-[10px] font-sans font-semibold text-[#849396]">
          <span className="tracking-widest uppercase">ERROR RATE</span>
          <span className="flex items-center text-amber-400 font-mono text-[11px] font-medium">
            {errorRate > 0.04 ? `+${(errorRate - 0.04).toFixed(2)}% vs baseline` : '+0.01% vs baseline'}
          </span>
        </div>

        <div className="my-1.5 flex items-baseline justify-between">
          <span className={`font-mono text-[28px] leading-8 font-semibold ${errorRate > 0.5 ? 'text-amber-400' : 'text-[#dee1f9]'}`}>
            {errorRate.toFixed(2)}<span className="text-[18px] font-normal text-[#849396]">%</span>
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
            errorRate > 0.5
              ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
              : 'bg-blue-950/50 text-[#c3f5ff] border-[#00e5ff]/30'
          }`}>
            {errorRate > 0.5 ? 'WARNING' : 'STEADY'}
          </span>
        </div>

        {/* Sparkline (Low purple line) */}
        <div className="h-8 w-full mt-1">
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 24">
            <path
              d={errorRate > 0.3 ? "M0,20 L20,19 L35,16 L50,12 L65,15 L80,10 L100,8" : "M0,20 L20,20 L35,19 L45,21 L60,19 L75,20 L85,18 L100,20"}
              fill="none"
              stroke="#8B5CF6"
              strokeLinecap="round"
              strokeWidth="2"
            />
            <path
              d={errorRate > 0.3 ? "M0,20 L20,19 L35,16 L50,12 L65,15 L80,10 L100,8 L100,24 L0,24 Z" : "M0,20 L20,20 L35,19 L45,21 L60,19 L75,20 L85,18 L100,20 L100,24 L0,24 Z"}
              fill="#8B5CF6"
              opacity="0.15"
            />
          </svg>
        </div>
      </div>

      {/* KPI 3: ORDERS PER SECOND */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 flex flex-col justify-between hover:border-[#22304D] transition-colors relative overflow-hidden group shadow-md">
        <div className="flex items-center justify-between text-[10px] font-sans font-semibold text-[#849396]">
          <span className="tracking-widest uppercase">ORDERS PER SECOND</span>
          <span className="flex items-center text-emerald-400 font-mono text-[11px] font-medium">
            +14 req/s
          </span>
        </div>

        <div className="my-1.5 flex items-baseline justify-between">
          <span className="font-mono text-[28px] leading-8 font-semibold text-[#dee1f9]">
            {ordersPerSecond} <span className="text-[18px] font-normal text-[#849396]">req/s</span>
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/50 text-emerald-300 border border-emerald-800/40">
            LOAD OPTIMAL
          </span>
        </div>

        {/* Sparkline (Active green pulse) */}
        <div className="h-8 w-full mt-1">
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 24">
            <path
              d="M0,16 Q10,10 20,18 T40,6 T60,19 T80,11 T100,7"
              fill="none"
              stroke="#10B981"
              strokeLinecap="round"
              strokeWidth="2"
            />
            <path
              d="M0,16 Q10,10 20,18 T40,6 T60,19 T80,11 T100,7 L100,24 L0,24 Z"
              fill="#10B981"
              opacity="0.15"
            />
          </svg>
        </div>
      </div>

      {/* KPI 4: ORDERS RESERVED */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 flex flex-col justify-between hover:border-[#22304D] transition-colors relative overflow-hidden group shadow-md">
        <div className="flex items-center justify-between text-[10px] font-sans font-semibold text-[#849396]">
          <span className="tracking-widest uppercase">ORDERS RESERVED</span>
          <span className="flex items-center text-[#00e5ff] font-mono text-[11px] font-medium">
            99.98% fulfilled
          </span>
        </div>

        <div className="my-1.5 flex items-baseline justify-between">
          <span className="font-mono text-[28px] leading-8 font-semibold text-[#dee1f9]">
            {ordersReserved.toLocaleString()}
          </span>
          <span className="material-symbols-outlined text-[#00e5ff] text-[18px]">
            check_circle
          </span>
        </div>

        {/* Sparkline (Cumulative upward drift) */}
        <div className="h-8 w-full mt-1">
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 24">
            <path
              d="M0,22 Q20,18 40,15 T70,9 T100,3"
              fill="none"
              stroke="#00E5FF"
              strokeLinecap="round"
              strokeWidth="2"
            />
            <path
              d="M0,22 Q20,18 40,15 T70,9 T100,3 L100,24 L0,24 Z"
              fill="#00E5FF"
              opacity="0.15"
            />
          </svg>
        </div>
      </div>
    </section>
  );
};
