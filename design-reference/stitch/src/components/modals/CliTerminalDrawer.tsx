import React, { useState, useRef, useEffect } from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const CliTerminalDrawer: React.FC = () => {
  const { isTerminalOpen, setIsTerminalOpen, terminalLogs, clearTerminalLogs } = useChaos();
  const [filter, setFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs, autoScroll]);

  if (!isTerminalOpen) return null;

  const filteredLogs = terminalLogs.filter((log) => {
    if (filter === 'all') return true;
    return log.service.toLowerCase().includes(filter.toLowerCase()) || log.level === filter;
  });

  return (
    <div className="fixed bottom-0 right-0 left-16 md:left-64 z-40 bg-[#080d1d]/95 border-t border-[#1E2942] shadow-2xl backdrop-blur-md max-h-[380px] flex flex-col font-mono text-xs animate-slide-up">
      {/* Terminal Title Bar */}
      <div className="h-9 px-4 bg-[#121A2F] border-b border-[#1E2942] flex items-center justify-between text-[#849396] select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
          </div>
          <span className="text-[11px] font-semibold text-[#dee1f9]">
            FailureLab Realtime CLI Stream · k8s/cluster/prod-east-order-cluster
          </span>
        </div>

        {/* Filter controls & Action buttons */}
        <div className="flex items-center gap-2">
          {/* Service Filters */}
          <div className="flex rounded bg-[#0B1020] p-0.5 border border-[#1E2942] text-[10px]">
            {['all', 'order-api', 'rabbitmq', 'toxiproxy', 'guardrails'].map((svc) => (
              <button
                key={svc}
                onClick={() => setFilter(svc)}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  filter === svc ? 'bg-[#00e5ff]/20 text-[#00e5ff] font-semibold' : 'text-[#849396] hover:text-[#dee1f9]'
                }`}
              >
                {svc}
              </button>
            ))}
          </div>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 py-1 rounded text-[10px] border border-[#1E2942] cursor-pointer ${
              autoScroll ? 'text-[#00e5ff] bg-[#00e5ff]/10' : 'text-[#849396]'
            }`}
            title="Auto-scroll to bottom"
          >
            Scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={clearTerminalLogs}
            className="text-[10px] px-2 py-1 rounded hover:bg-[#1E2942] text-[#849396] hover:text-[#dee1f9] cursor-pointer"
            title="Clear Terminal Output"
          >
            Clear
          </button>

          <button
            onClick={() => setIsTerminalOpen(false)}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#1E2942] text-[#849396] hover:text-white cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>

      {/* Terminal Output Window */}
      <div className="p-3 overflow-y-auto space-y-1 h-[280px] bg-[#0B1020] text-[#dee1f9]/90 font-mono text-[11px] leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="text-[#849396] italic py-8 text-center">No log events matching filter...</div>
        ) : (
          filteredLogs.map((log) => {
            const levelColor =
              log.level === 'chaos'
                ? 'text-amber-400 bg-amber-950/40 px-1 rounded border border-amber-500/30'
                : log.level === 'error'
                ? 'text-red-400 bg-red-950/40 px-1 rounded border border-red-500/30 font-bold'
                : log.level === 'warn'
                ? 'text-amber-300'
                : 'text-emerald-400';

            return (
              <div key={log.id} className="flex items-start gap-2 hover:bg-[#121A2F]/50 px-1.5 py-0.5 rounded">
                <span className="text-[#849396]/80 shrink-0">[{log.timestamp}]</span>
                <span className="text-[#00e5ff] shrink-0 font-semibold">{log.service}:</span>
                <span className={`text-[10px] shrink-0 font-bold uppercase ${levelColor}`}>
                  {log.level}
                </span>
                <span className="text-[#dee1f9] break-all">{log.message}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
