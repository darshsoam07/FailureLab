import React from 'react';
import { generateSparklinePaths } from '../../lib/sparkline.js';
import { StatusBadge } from './StatusBadge.jsx';

/**
 * Stitch-styled KPI metric card with optional sparkline and status badge.
 *
 * @param {Object} props
 * @param {string} props.title - Metric title (uppercase eyebrow)
 * @param {string|number} props.value - Primary numeric display value
 * @param {string} [props.unit] - Optional unit string (e.g., 'ms', '%', 'req/s')
 * @param {string} [props.subtitle] - Contextual detail / delta (e.g., '+14 req/s', 'since page load')
 * @param {'healthy'|'degraded'|'breached'|'warning'|'info'|'neutral'} [props.status='neutral']
 * @param {string} [props.badgeLabel] - Explicit label for status badge
 * @param {number[]} [props.sparklineData] - Rolling numeric series for sparkline
 * @param {string} [props.sparklineColor] - Stroke color for sparkline SVG
 * @param {string} [props.className='']
 */
export function KpiCard({
  title,
  value,
  unit,
  subtitle,
  status = 'neutral',
  badgeLabel,
  sparklineData,
  sparklineColor,
  className = '',
}) {
  const isBreached = status === 'breached';
  const isDegraded = status === 'degraded';

  const cardBorderClasses = isBreached
    ? 'border-red-500/80 glow-red'
    : isDegraded
    ? 'border-amber-500/70 glow-amber'
    : 'border-[#1E2942]';

  const valueColor = isBreached
    ? 'text-red-400'
    : isDegraded
    ? 'text-amber-300'
    : 'text-[#dee1f9]';

  // Determine stroke color for sparkline
  const defaultStroke = isBreached
    ? '#ef4444'
    : isDegraded
    ? '#f59e0b'
    : sparklineColor || '#00daf3';

  const hasSparkline = Array.isArray(sparklineData) && sparklineData.length > 0;
  const { linePath, areaPath } = hasSparkline
    ? generateSparklinePaths(sparklineData, { width: 100, height: 24 })
    : { linePath: '', areaPath: '' };

  const gradientId = `kpi-grad-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  return (
    <div
      className={`rounded-xl bg-[#121A2F] border ${cardBorderClasses} p-4 flex flex-col justify-between hover:border-[#22304D] transition-all relative overflow-hidden group shadow-md ${className}`}
    >
      {/* Top Eyebrow Row */}
      <div className="flex items-center justify-between text-[10px] font-sans font-semibold text-[#849396]">
        <span className="tracking-widest uppercase">{title}</span>
        {subtitle && (
          <span
            className={`font-mono text-[11px] font-medium ${
              isBreached ? 'text-red-400' : isDegraded ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {subtitle}
          </span>
        )}
      </div>

      {/* Primary Value & Badge Row */}
      <div className="my-1.5 flex items-baseline justify-between gap-2">
        <span className={`font-mono text-[28px] leading-8 font-semibold ${valueColor}`}>
          {value}
          {unit && <span className="ml-1 text-[18px] font-normal text-[#849396]">{unit}</span>}
        </span>
        {(badgeLabel || status !== 'neutral') && (
          <StatusBadge
            variant={status}
            label={badgeLabel}
            pulse={isBreached}
          />
        )}
      </div>

      {/* Sparkline Row (only rendered when real series is provided) */}
      {hasSparkline && linePath ? (
        <div className="h-8 w-full mt-1">
          <svg
            className="w-full h-full overflow-visible"
            preserveAspectRatio="none"
            viewBox="0 0 100 24"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={defaultStroke} stopOpacity="0.3" />
                <stop offset="100%" stopColor={defaultStroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={linePath}
              fill="none"
              stroke={defaultStroke}
              strokeLinecap="round"
              strokeWidth="2"
            />
            {areaPath && (
              <path
                d={areaPath}
                fill={`url(#${gradientId})`}
              />
            )}
          </svg>
        </div>
      ) : (
        <div className="h-2 w-full" />
      )}
    </div>
  );
}
