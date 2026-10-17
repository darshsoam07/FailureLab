import React from 'react';
import { useChaos } from '../../context/ChaosContext.tsx';

export const EmergencyStopModal: React.FC = () => {
  const {
    isEmergencyModalOpen,
    setIsEmergencyModalOpen,
    emergencyStop,
    activeToxic,
  } = useChaos();

  if (!isEmergencyModalOpen) return null;

  const handleConfirm = () => {
    emergencyStop();
    setIsEmergencyModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg rounded-xl bg-[#121A2F] border-2 border-red-500/80 p-6 shadow-2xl glow-red">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-950/80 border border-red-500/60 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-red-400 text-[28px] animate-pulse">
              warning
            </span>
          </div>
          <div>
            <h3 className="text-xl font-bold text-white tracking-tight">
              Execute Emergency Circuit Breaker?
            </h3>
            <p className="text-sm text-[#849396] mt-1">
              Cluster: <span className="font-mono text-[#dee1f9]">cluster/prod-east-order-cluster</span>
            </p>
          </div>
        </div>

        {/* Body content */}
        <div className="my-5 space-y-3 text-xs text-[#dee1f9]/90 bg-[#0B1020] p-4 rounded-lg border border-[#1E2942]">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <span className="material-symbols-outlined text-[16px]">bolt</span>
            <span>Immediate Kill-Switch Action:</span>
          </div>
          <ul className="list-disc list-inside space-y-1.5 text-[#849396] pl-1">
            <li>
              Instant bypass of <strong className="text-white">Toxiproxy Engine</strong> on Port :8474
            </li>
            <li>
              {activeToxic?.running ? (
                <span className="text-red-400">
                  Abort currently active toxic: <strong>{activeToxic.type}</strong> (+{activeToxic.latencyMs}ms)
                </span>
              ) : (
                <span>No active toxic running; baseline safeguard state will be enforced.</span>
              )}
            </li>
            <li>Restore all downstream gRPC connections to bypass mode</li>
            <li>Reset P95 latency and error rate tripwires to nominal state</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={() => setIsEmergencyModalOpen(false)}
            className="px-4 py-2 text-xs font-semibold text-[#849396] hover:text-[#dee1f9] hover:bg-[#1E2942] rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-lg glow-red transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">power_settings_new</span>
            <span>EXECUTE EMERGENCY STOP</span>
          </button>
        </div>
      </div>
    </div>
  );
};
