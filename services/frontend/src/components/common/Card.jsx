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
    cyan: 'glow-cyan border-[#00e5ff]/40',
    'cyan-lg': 'glow-cyan-lg border-[#00e5ff]/60',
    red: 'glow-red border-red-500/80',
    amber: 'glow-amber border-amber-500/70',
  }[glow] || '';

  const hoverClass = hover ? 'hover:border-[#22304D] transition-colors' : '';

  return (
    <Component
      className={`rounded-xl bg-[#121A2F] border border-[#1E2942] p-4 md:p-5 shadow-md ${hoverClass} ${glowClasses} ${className}`}
      {...rest}
    >
      {children}
    </Component>
  );
}
