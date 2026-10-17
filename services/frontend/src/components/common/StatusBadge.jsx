import React from 'react';
import { formatExperimentStatus } from '../../lib/experimentLogic.js';

/**
 * Normalizes status strings into known badge variants.
 */
function normalizeVariant(variant, status) {
  const key = (variant || status || 'neutral').toLowerCase();
  if (['healthy', 'ready', 'optimal', 'success', 'passed', 'resolved'].includes(key)) return 'healthy';
  if (['degraded', 'warning', 'paused', 'recovering'].includes(key)) return 'degraded';
  if (['breached', 'slo breach', 'unhealthy', 'error', 'failed', 'aborted', 'danger'].includes(key)) return 'breached';
  if (['info', 'cyan', 'running', 'active', 'steady'].includes(key)) return 'info';
  if (['ai', 'violet', 'proposal'].includes(key)) return 'ai';
  return 'neutral';
}

/**
 * Stitch-styled StatusBadge primitive.
 *
 * @param {Object} props
 * @param {'healthy'|'degraded'|'breached'|'info'|'ai'|'neutral'} [props.variant]
 * @param {string} [props.status] - Alternative to variant (case-insensitive)
 * @param {boolean} [props.dot=false] - Show glowing status indicator dot
 * @param {boolean} [props.pulse=false] - Pulsing animation for active or breach states
 * @param {'sm'|'md'} [props.size='sm'] - Badge size
 * @param {string} [props.className='']
 * @param {React.ReactNode} [props.children]
 * @param {string} [props.label]
 */
export function StatusBadge({
  variant,
  status,
  dot = false,
  pulse = false,
  size = 'sm',
  className = '',
  children,
  label,
  ...rest
}) {
  const norm = normalizeVariant(variant, status);

  const variantStyles = {
    healthy: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/40',
    degraded: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
    breached: 'bg-red-950/60 text-red-300 border-red-800/60 font-bold',
    info: 'bg-[#0c2238] text-[#00e5ff] border-[#00e5ff]/30',
    ai: 'bg-purple-950/50 text-purple-300 border-purple-800/40',
    neutral: 'bg-slate-800/60 text-slate-300 border-slate-700/50',
  }[norm];

  const dotColors = {
    healthy: 'bg-emerald-400 glow-dot-emerald',
    degraded: 'bg-amber-400 glow-dot-amber',
    breached: 'bg-red-400 glow-dot-red',
    info: 'bg-[#00e5ff] shadow-[0_0_8px_#00e5ff]',
    ai: 'bg-purple-400',
    neutral: 'bg-slate-400',
  }[norm];

  const sizeClasses = size === 'md'
    ? 'text-xs px-2.5 py-1 gap-1.5'
    : 'text-[10px] px-1.5 py-0.5 gap-1';

  const pulseClass = pulse ? 'animate-pulse' : '';
  const content = children || label || status || norm.toUpperCase();

  return (
    <span
      className={`inline-flex items-center rounded font-mono border uppercase tracking-wider ${sizeClasses} ${variantStyles} ${pulseClass} ${className}`}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColors}`}
        />
      )}
      <span>{content}</span>
    </span>
  );
}

/**
 * Dedicated StatusBadge for experiments, strictly honoring backend models and fallback rules.
 */
export function ExperimentStatusBadge({ experiment, status, abortReason, className = '' }) {
  const info = formatExperimentStatus(experiment || status, abortReason);
  return (
    <StatusBadge
      variant={info.variant}
      label={info.label}
      dot={info.dot}
      pulse={info.pulse}
      className={className}
    />
  );
}
