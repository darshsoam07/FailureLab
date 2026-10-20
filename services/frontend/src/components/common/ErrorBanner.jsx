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
      className={`rounded-xl bg-destructive/10 border border-destructive/60 p-4 text-destructive glow-red flex items-start gap-3 shadow-lg ${className}`}
    >
      <div className="shrink-0 mt-0.5 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        {title && (
          <p className="text-xs font-bold text-destructive font-mono uppercase tracking-wider">
            {title}
          </p>
        )}
        <div className="text-xs text-destructive mt-0.5 leading-relaxed break-words font-mono">
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
