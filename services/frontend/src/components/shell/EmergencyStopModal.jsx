import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, AlertTriangle, Power, RefreshCw, X } from 'lucide-react';
import { ErrorBanner } from '../common/ErrorBanner.jsx';

/**
 * Accessible Emergency Stop confirmation modal.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Object|null} props.experiment - Currently running experiment
 * @param {() => void} props.onClose - Dismiss handler
 * @param {(experimentId: string) => Promise<void>} props.onConfirmStop - Async stop action
 */
export function EmergencyStopModal({
  isOpen,
  experiment,
  onClose,
  onConfirmStop,
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPending(false);
      setError('');
      // Focus the cancel button first for safety
      setTimeout(() => cancelButtonRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Focus trap & Escape listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!pending) onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pending, onClose]);

  if (!isOpen || !experiment) return null;

  async function handleExecuteStop() {
    if (!experiment.id || pending) return;
    setPending(true);
    setError('');

    try {
      await onConfirmStop(experiment.id);
      // Close only on confirmed success
      onClose();
    } catch (err) {
      setError(err?.message || 'Failed to stop experiment. The controller may be unreachable.');
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="emergency-dialog-title"
        aria-describedby="emergency-dialog-desc"
        className="relative w-full max-w-lg rounded-xl bg-[#121A2F] border-2 border-red-500/80 p-6 shadow-2xl glow-red select-none"
      >
        {/* Close Icon button */}
        <button
          type="button"
          onClick={() => {
            if (!pending) onClose();
          }}
          disabled={pending}
          aria-label="Cancel emergency stop dialog"
          className="absolute top-4 right-4 text-[#849396] hover:text-[#dee1f9] p-1 rounded-lg transition-colors disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5ff]"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Dialog Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-950/80 border border-red-500/60 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-6 w-6 text-red-400 animate-pulse" aria-hidden="true" />
          </div>
          <div className="min-w-0 pr-6">
            <h2 id="emergency-dialog-title" className="text-xl font-bold text-white tracking-tight">
              Execute Emergency Circuit Breaker?
            </h2>
            <p className="text-xs text-[#849396] mt-1 font-mono">
              Target: <span className="text-[#00e5ff] font-semibold">{experiment.target_service || 'inventory_service'}</span>
            </p>
          </div>
        </div>

        {/* Error Feedback Banner */}
        {error && (
          <div className="mt-4">
            <ErrorBanner
              title="Emergency Stop Execution Failed"
              message={error}
            />
          </div>
        )}

        {/* Diagnostic / Impact Details */}
        <div
          id="emergency-dialog-desc"
          className="my-5 space-y-3 text-xs text-[#dee1f9]/90 bg-[#0B1020] p-4 rounded-lg border border-[#1E2942]"
        >
          <div className="flex items-center gap-2 text-amber-300 font-semibold font-mono">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>Immediate Kill-Switch Action:</span>
          </div>

          <ul className="list-disc list-inside space-y-1.5 text-[#849396] pl-1 font-mono text-[11px]">
            <li>
              Active Experiment: <strong className="text-white">{experiment.name}</strong>
            </li>
            <li>
              Fault Type: <strong className="text-red-300">{experiment.fault_type}</strong>
            </li>
            <li>
              Removes active toxics immediately via Toxiproxy proxy client
            </li>
            <li>
              Restores upstream HTTP connections to unhindered bypass mode
            </li>
            <li>
              Transitions experiment record to <strong className="text-white">COMPLETED</strong> state with <strong className="text-amber-300">MANUAL_STOP</strong>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 text-xs font-semibold text-[#849396] hover:text-[#dee1f9] hover:bg-[#1E2942] rounded-lg transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            Cancel (Keep Running)
          </button>

          <button
            type="button"
            onClick={handleExecuteStop}
            disabled={pending}
            className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-lg glow-red transition-all active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {pending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>ABORTING FAULT...</span>
              </>
            ) : (
              <>
                <Power className="h-4 w-4" aria-hidden="true" />
                <span>CONFIRM EMERGENCY STOP</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
