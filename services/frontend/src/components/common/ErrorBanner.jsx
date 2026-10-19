import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Stitch-styled ErrorBanner primitive for prominent error feedback.
 *
 * @param {Object} props
 * @param {string} [props.title='Error'] - Error heading
 * @param {string|React.ReactNode} props.message - Error details or message
 * @param {React.ReactNode} [props.action] - Optional retry or dismiss action
 * @param {string} [props.className='']
 */
export function ErrorBanner({
  title = 'Error',
  message,
  action,
  className = '',
}) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={`rounded-xl bg-red-950/40 border border-red-500/60 p-4 text-red-200 glow-red flex items-start gap-3 shadow-lg ${className}`}
    >
      <div className="shrink-0 mt-0.5 text-red-400">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        {title && (
          <p className="text-xs font-bold text-red-300 font-mono uppercase tracking-wider">
            {title}
          </p>
        )}
        <div className="text-xs text-red-200 mt-0.5 leading-relaxed break-words font-mono">
          {message}
        </div>
      </div>
      {action && (
        <div className="shrink-0 self-center">
          {action}
        </div>
      )}
    </div>
  );
}
