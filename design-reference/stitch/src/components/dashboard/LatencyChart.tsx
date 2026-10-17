import React, { useState } from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const LatencyChart: React.FC = () => {
  const { timeWindow, setTimeWindow, metricHistory, p95Latency, activeToxic } = useChaos();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Map ms to SVG Y coordinate (0ms -> y=240, 600ms -> y=0)
  const msToY = (ms: number): number => {
    const clamped = Math.max(0, Math.min(600, ms));
    return 240 - (clamped / 600) * 240;
  };

  // Convert metric points to SVG path
  const width = 800;
  const height = 240;
  const count = metricHistory.length;
  const stepX = width / Math.max(1, count - 1);

  // Generate SVG paths for P50 and P95
  const p50Points = metricHistory.map((pt, idx) => ({
    x: idx * stepX,
    y: msToY(pt.p50),
  }));

  const p95Points = metricHistory.map((pt, idx) => ({
    x: idx * stepX,
    y: msToY(pt.p95),
  }));

  // Create smooth bezier path string
  const createSmoothPath = (pts: { x: number; y: number }[]): string => {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx.toFixed(1)},${p0.y.toFixed(1)} ${cx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    return d;
  };

  const p50LinePath = createSmoothPath(p50Points);
  const p50FillPath = p50Points.length > 0
    ? `${p50LinePath} L ${width},${height} L 0,${height} Z`
    : '';

  const p95LinePath = createSmoothPath(p95Points);
  const p95FillPath = p95Points.length > 0
    ? `${p95LinePath} L ${width},${height} L 0,${height} Z`
    : '';

  const lastP95Y = p95Points[p95Points.length - 1]?.y ?? 162;
  const lastP50Y = p50Points[p50Points.length - 1]?.y ?? 190;

  const hoveredPoint = hoverIndex !== null && metricHistory[hoverIndex]
    ? metricHistory[hoverIndex]
    : null;

  return (
    <div className="lg:col-span-8 rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 md:p-5 flex flex-col justify-between shadow-md">
      {/* Chart Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 pb-3 border-b border-[#1E2942]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#00e5ff] text-[18px]">
            show_chart
          </span>
          <h2 className="text-[17px] font-semibold text-[#dee1f9]">Latency over time</h2>
          <span className="text-[12px] text-[#849396] font-mono">last {timeWindow} window</span>
        </div>

        {/* Time-range tabs & Legend */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Legend Items */}
          <div className="flex items-center gap-3 font-mono text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-1 bg-[#10B981] rounded-full inline-block"></span>
              <span className="text-[#849396]">P50 (~65ms)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-1 bg-[#00E5FF] rounded-full inline-block"></span>
              <span className="text-[#00E5FF] font-semibold">P95 (~{p95Latency}ms)</span>
            </div>
          </div>

          {/* Time Selector Tabs */}
          <div className="flex rounded bg-[#0B1020] p-0.5 border border-[#1E2942]">
            {(['5m', '15m', '1h', '6h'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setTimeWindow(tab)}
                className={`px-2.5 py-0.5 text-[11px] font-mono rounded cursor-pointer transition-colors ${
                  timeWindow === tab
                    ? 'text-[#00E5FF] bg-[#25293a] font-semibold shadow-sm'
                    : 'text-[#849396] hover:text-[#dee1f9]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Visual Area */}
      <div
        className="relative w-full h-[260px] my-3 select-none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Danger Zone (Above 500ms Threshold) */}
        <div
          className={`absolute inset-x-0 top-0 h-[20%] transition-colors border-b border-dashed border-red-500/70 flex items-center justify-between px-3 pointer-events-none z-10 ${
            p95Latency >= 500 ? 'bg-red-950/40' : 'bg-red-950/20'
          }`}
        >
          <span className="text-[10px] font-mono uppercase tracking-widest text-red-400 font-semibold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[13px] text-red-400 animate-pulse">
              warning
            </span>
            SLO BREACH RISK (&gt;500ms)
          </span>
          <span className="text-[10px] font-mono text-red-300 bg-red-950/90 px-2 py-0.5 rounded border border-red-800/50">
            500ms SLO Threshold
          </span>
        </div>

        {/* Grid Lines */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none text-[10px] font-mono text-[#849396]/60">
          <div className="border-b border-[#1E2942]/40 w-full pt-1 flex justify-end pr-1">600ms</div>
          <div className="border-b border-[#1E2942]/40 w-full pt-1 flex justify-end pr-1">350ms</div>
          <div className="border-b border-[#1E2942]/40 w-full pt-1 flex justify-end pr-1">200ms</div>
          <div className="border-b border-[#1E2942]/40 w-full pt-1 flex justify-end pr-1">100ms</div>
          <div className="w-full flex justify-end pr-1 pb-1">0ms</div>
        </div>

        {/* Primary SVG Plotting Canvas */}
        <svg
          className="absolute inset-0 w-full h-full cursor-crosshair"
          preserveAspectRatio="none"
          viewBox="0 0 800 240"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const index = Math.round(relX * (count - 1));
            setHoverIndex(Math.max(0, Math.min(count - 1, index)));
          }}
        >
          <defs>
            <linearGradient id="p95Glow" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#00E5FF" stopOpacity={activeToxic?.running ? "0.45" : "0.3"} />
              <stop offset="100%" stopColor="#00E5FF" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="p50Glow" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Vertical Time Grid Bars */}
          <line stroke="#1E2942" strokeDasharray="3,3" strokeWidth="1" x1="160" x2="160" y1="0" y2="240" />
          <line stroke="#1E2942" strokeDasharray="3,3" strokeWidth="1" x1="320" x2="320" y1="0" y2="240" />
          <line stroke="#1E2942" strokeDasharray="3,3" strokeWidth="1" x1="480" x2="480" y1="0" y2="240" />
          <line stroke="#1E2942" strokeDasharray="3,3" strokeWidth="1" x1="640" x2="640" y1="0" y2="240" />

          {/* P50 Line & Fill */}
          <path d={p50FillPath} fill="url(#p50Glow)" />
          <path d={p50LinePath} fill="none" stroke="#10B981" strokeLinecap="round" strokeWidth="2" />

          {/* P95 Line & Fill */}
          <path d={p95FillPath} fill="url(#p95Glow)" />
          <path d={p95LinePath} fill="none" stroke="#00E5FF" strokeLinecap="round" strokeWidth={activeToxic?.running ? "3" : "2.5"} />

          {/* Hover indicator vertical bar */}
          {hoverIndex !== null && (
            <line
              x1={hoverIndex * stepX}
              x2={hoverIndex * stepX}
              y1="0"
              y2="240"
              stroke="#00E5FF"
              strokeDasharray="2,2"
              strokeWidth="1.5"
            />
          )}

          {/* Current Probe Marker on Right Edge */}
          <circle cx="800" cy={lastP95Y} r="4.5" fill="#00E5FF" className="glow-cyan" />
          <circle cx="800" cy={lastP50Y} r="3.5" fill="#10B981" />
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && hoverIndex !== null && (
          <div
            className="absolute top-2 pointer-events-none rounded-lg bg-[#0B1020]/95 border border-[#00E5FF]/40 p-2 text-xs font-mono shadow-2xl z-20 backdrop-blur-sm"
            style={{
              left: `${Math.min(75, Math.max(10, (hoverIndex / (count - 1)) * 100))}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="text-[#849396] text-[10px] pb-1 border-b border-[#1E2942] mb-1">
              Time: {hoveredPoint.time} UTC
            </div>
            <div className="flex items-center justify-between gap-3 text-[#00E5FF]">
              <span>P95:</span>
              <span className="font-bold">{hoveredPoint.p95}ms</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[#10B981]">
              <span>P50:</span>
              <span className="font-bold">{hoveredPoint.p50}ms</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Time Scale */}
      <div className="flex justify-between items-center text-[10px] font-mono text-[#849396] border-t border-[#1E2942] pt-2">
        <span>14:45:00 UTC</span>
        <span>14:48:45</span>
        <span>14:52:30</span>
        <span>14:56:15</span>
        <span className="text-[#00E5FF] font-semibold flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] animate-ping"></span>
          15:00:00 (LIVE)
        </span>
      </div>
    </div>
  );
};
