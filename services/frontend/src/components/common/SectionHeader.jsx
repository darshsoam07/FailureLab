import React from 'react';

/**
 * Stitch-styled SectionHeader primitive.
 *
 * @param {Object} props
 * @param {string} props.title - Primary title text
 * @param {React.ReactNode} [props.icon] - Icon element (e.g. Lucide icon)
 * @param {string|React.ReactNode} [props.subtitle] - Subtitle or context pill
 * @param {React.ReactNode} [props.actions] - Right-aligned actions, controls, or tabs
 * @param {boolean} [props.divider=true] - Whether to show bottom border divider
 * @param {string} [props.className='']
 */
export function SectionHeader({
  title,
  icon,
  subtitle,
  actions,
  divider = true,
  className = '',
}) {
  const borderClass = divider ? 'pb-3 border-b border-[#1E2942]' : '';

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${borderClass} ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="text-[#00e5ff] shrink-0">{icon}</span>}
        <h3 className="text-[17px] font-semibold text-[#dee1f9] tracking-tight">
          {title}
        </h3>
        {subtitle && (
          <span className="text-[12px] text-[#849396] font-mono ml-1">
            {subtitle}
          </span>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
