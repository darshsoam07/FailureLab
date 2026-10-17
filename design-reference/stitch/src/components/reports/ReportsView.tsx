import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const ReportsView: React.FC = () => {
  const { currentCluster } = useChaos();

  const handleExport = () => {
    const reportData = {
      cluster: currentCluster,
      exportedAt: new Date().toISOString(),
      overallScore: '94.2%',
      mttrSeconds: 3.8,
      sloInvariantsSatisfied: '99.98%',
      summary: 'FailureLab resilience evaluation complete: Circuit breakers tripped within 1.2s; zero data loss observed on transactional outbox.',
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failurelab-resilience-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Scorecard Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
            Resilience Score
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[28px] font-semibold text-emerald-400">94.2%</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
              GRADE A
            </span>
          </div>
          <p className="text-[11px] text-[#849396]">Fault tolerance across 6 microservices</p>
        </div>

        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
            Mean Time To Recovery
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[28px] font-semibold text-[#00e5ff]">3.8 <span className="text-[18px] text-[#849396]">s</span></span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/30">
              OPTIMAL
            </span>
          </div>
          <p className="text-[11px] text-[#849396]">Median auto-healing window</p>
        </div>

        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
            Circuit Breaker Accuracy
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[28px] font-semibold text-[#dee1f9]">100%</span>
            <span className="material-symbols-outlined text-emerald-400 text-[18px]">
              verified
            </span>
          </div>
          <p className="text-[11px] text-[#849396]">12 of 12 trips triggered on time</p>
        </div>

        <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-4">
          <div className="text-[10px] font-sans font-semibold text-[#849396] uppercase tracking-wider">
            Data Loss Invariant
          </div>
          <div className="my-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[28px] font-semibold text-emerald-400">0</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
              ZERO DROP
            </span>
          </div>
          <p className="text-[11px] text-[#849396]">Transactional outbox idempotency verified</p>
        </div>
      </div>

      {/* Main Audit Report Table */}
      <div className="rounded-xl bg-[#121A2F] border border-[#1E2942] p-5 shadow-md">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-[#1E2942] gap-2">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-[#00e5ff] text-[20px]">
                assessment
              </span>
              Chaos Drill Execution Logs & Audit Trail
            </h3>
            <p className="text-xs text-[#849396] mt-0.5">
              Detailed post-test telemetry records for regulatory and SOC2 resilience verification.
            </p>
          </div>

          <button
            onClick={handleExport}
            className="px-3.5 py-1.5 rounded-lg bg-[#00e5ff]/10 border border-[#00e5ff]/30 text-[#00e5ff] hover:bg-[#00e5ff] hover:text-[#0e1323] transition-all text-xs font-mono font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export Audit JSON</span>
          </button>
        </div>

        {/* Audit Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0B1020] text-[#849396] border-b border-[#1E2942] uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-3">Test Run ID</th>
                <th className="py-2.5 px-3">Target Microservice</th>
                <th className="py-2.5 px-3">Fault Injected</th>
                <th className="py-2.5 px-3">Duration</th>
                <th className="py-2.5 px-3">Max P95</th>
                <th className="py-2.5 px-3">SLO Status</th>
                <th className="py-2.5 px-3">MTTR</th>
                <th className="py-2.5 px-3 text-right">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2942]/60 text-[#dee1f9]">
              <tr className="hover:bg-[#0B1020]/50 transition-colors">
                <td className="py-3 px-3 text-[#00e5ff]">RUN-84920</td>
                <td className="py-3 px-3">Inventory Service (gRPC :50051)</td>
                <td className="py-3 px-3 text-amber-300">Latency +350ms (Toxiproxy)</td>
                <td className="py-3 px-3">60s</td>
                <td className="py-3 px-3">486ms</td>
                <td className="py-3 px-3 text-emerald-400 font-semibold">Passed (&lt;500ms)</td>
                <td className="py-3 px-3">3.8s</td>
                <td className="py-3 px-3 text-right">
                  <span className="px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/40 text-[10px]">
                    RESILIENT
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-[#0B1020]/50 transition-colors">
                <td className="py-3 px-3 text-[#00e5ff]">RUN-84919</td>
                <td className="py-3 px-3">PostgreSQL Outbox (:5432)</td>
                <td className="py-3 px-3 text-amber-300">Connection Starvation (40 conn)</td>
                <td className="py-3 px-3">45s</td>
                <td className="py-3 px-3">312ms</td>
                <td className="py-3 px-3 text-emerald-400 font-semibold">Passed</td>
                <td className="py-3 px-3">2.4s</td>
                <td className="py-3 px-3 text-right">
                  <span className="px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/40 text-[10px]">
                    RESILIENT
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-[#0B1020]/50 transition-colors">
                <td className="py-3 px-3 text-[#00e5ff]">RUN-84918</td>
                <td className="py-3 px-3">Inventory Service (gRPC :50051)</td>
                <td className="py-3 px-3 text-red-400">gRPC Timeout & Slicer (1200ms)</td>
                <td className="py-3 px-3">45s</td>
                <td className="py-3 px-3 text-red-400 font-bold">580ms</td>
                <td className="py-3 px-3 text-red-400 font-semibold">SLO Breached</td>
                <td className="py-3 px-3">6.2s</td>
                <td className="py-3 px-3 text-right">
                  <span className="px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 text-[10px]">
                    DEGRADED
                  </span>
                </td>
              </tr>
              <tr className="hover:bg-[#0B1020]/50 transition-colors">
                <td className="py-3 px-3 text-[#00e5ff]">RUN-84917</td>
                <td className="py-3 px-3">RabbitMQ Broker (:5672)</td>
                <td className="py-3 px-3 text-amber-300">Bandwidth Throttle (128 KB/s)</td>
                <td className="py-3 px-3">90s</td>
                <td className="py-3 px-3">188ms</td>
                <td className="py-3 px-3 text-emerald-400 font-semibold">Passed</td>
                <td className="py-3 px-3">4.1s</td>
                <td className="py-3 px-3 text-right">
                  <span className="px-2 py-0.5 rounded bg-emerald-950/50 text-emerald-300 border border-emerald-800/40 text-[10px]">
                    RESILIENT
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
