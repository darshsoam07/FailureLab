import React from 'react';

/**
 * Stitch-styled EmptyState primitive for empty lists, history, or telemetry.
 *
 * @param {Object} props
 * @param {string} props.title - Primary heading
 * @param {string} [props.description] - Explanatory message
 * @param {React.ReactNode} [props.icon] - Centered icon element
 * @param {React.ReactNode} [props.action] - Optional call to action button/link
 * @param {string} [props.className='']
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className = '',
}) {
  return (
    <div
      className={`rounded-xl border border-dashed border-[#1E2942] bg-[#121A2F]/40 p-8 text-center ${className}`}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="w-12 h-12 rounded-full bg-[#1E2942]/70 text-[#9aa9ac] flex items-center justify-center mx-auto mb-3"
        >
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-[#dee1f9]">
        {title}
      </h3>
      {description && (
        <p className="text-xs text-[#9aa9ac] mt-1 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4 flex justify-center">
          {action}
        </div>
      )}
    </div>
  );
}
