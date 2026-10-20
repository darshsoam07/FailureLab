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
  if (['ai', 'violet', 'proposal', 'simulated'].includes(key)) return 'ai';
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
    healthy: 'bg-success/10 text-success border-success/40',
    degraded: 'bg-warning/10 text-warning border-warning/60',
    breached: 'bg-destructive/10 text-destructive border-destructive/60 font-bold',
    info: 'bg-muted text-accent-ink border-accent-ink/30',
    ai: 'bg-simulated/10 text-simulated border-simulated/40',
    neutral: 'bg-muted/60 text-foreground border-border/50',
  }[norm];

  const dotColors = {
    healthy: 'bg-primary glow-dot-emerald',
    degraded: 'bg-warning glow-dot-amber',
    breached: 'bg-destructive glow-dot-red',
    info: 'bg-accent-ink',
    ai: 'bg-simulated',
    neutral: 'bg-muted',
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
