import React from 'react';

/**
 * Stitch-styled Card component.
 *
 * @param {Object} props
 * @param {'div'|'section'|'article'} [props.as='div'] - Element tag
 * @param {'none'|'cyan'|'cyan-lg'|'red'|'amber'} [props.glow='none'] - Glow shadow variant
 * @param {boolean} [props.hover=false] - Whether to highlight border on hover
 * @param {string} [props.className=''] - Additional class names
 * @param {React.ReactNode} props.children
 */
export function Card({
  as: Component = 'div',
  glow = 'none',
  hover = false,
  className = '',
  children,
  ...rest
}) {
  const glowClasses = {
    none: '',
    cyan: 'glow-cyan border-accent-ink/40',
    'cyan-lg': 'glow-cyan-lg border-accent-ink/60',
    red: 'glow-red border-destructive/80',
    amber: 'glow-amber border-warning/70',
  }[glow] || '';

  const hoverClass = hover ? 'hover:border-border transition-colors' : '';

  return (
    <Component
      className={`rounded-lg bg-surface border border-border p-4 md:p-5 shadow-sm ${hoverClass} ${glowClasses} ${className}`}
      {...rest}
    >
      {children}
    </Component>
  );
}
