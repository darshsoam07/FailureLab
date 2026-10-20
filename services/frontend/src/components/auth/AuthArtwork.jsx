import { useId } from 'react';
import { AUTH_SCREENS } from '../../lib/auth.js';

/** Original vector portrait, purpose-built for the five authentication themes. */
export function AuthArtwork({ screen }) {
  const instance = useId().replace(/:/g, '');
  return <div className="auth-art" aria-hidden="true">
    {AUTH_SCREENS.map((name, index) => {
      const id = `${instance}-${index}`;
      return <svg key={name} viewBox="0 0 520 720" preserveAspectRatio="xMidYMid slice"
        className={`auth-portrait auth-art-${name.toLowerCase()} ${screen === name ? 'is-active' : ''}`}>
        <defs>
          <linearGradient id={`${id}-back`} x2="0.2" y2="1"><stop stopColor="var(--art-dark)" /><stop offset="1" stopColor="var(--art-back)" /></linearGradient>
          <linearGradient id={`${id}-skin`}><stop stopColor="var(--art-dark)" /><stop offset=".55" stopColor="var(--art-warm)" /><stop offset="1" stopColor="var(--art-cool)" /></linearGradient>
          <linearGradient id={`${id}-shirt`} x2=".8" y2="1"><stop stopColor="var(--art-cool)" /><stop offset=".38" stopColor="var(--art-shirt)" /><stop offset="1" stopColor="var(--art-dark)" /></linearGradient>
          <linearGradient id={`${id}-visor`} x1="0" x2="1" y2=".5"><stop stopColor="var(--art-cool)" /><stop offset=".35" stopColor="var(--art-visor)" /><stop offset="1" stopColor="var(--art-warm)" /></linearGradient>
          <radialGradient id={`${id}-halo`}><stop stopColor="var(--art-warm)" stopOpacity=".7" /><stop offset="1" stopColor="var(--art-back)" stopOpacity="0" /></radialGradient>
          <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <path fill={`url(#${id}-back)`} d="M0 0h520v720H0z" />
        <ellipse cx="270" cy="420" rx="300" ry="340" fill={`url(#${id}-halo)`} />
        <path d="M78 720c8-151 26-214 113-247l37-11 96 1c113 19 153 117 179 253Z" fill={`url(#${id}-shirt)`} />
        <path d="m207 422-10 71 72 63 68-63-33-108Z" fill={`url(#${id}-skin)`} />
        <path d="M175 244c-15-64 119-116 171-19 20 36 12 114-14 161-9 17-25 42-47 53-32 15-66-8-83-38l-25-51-24-12 17-35Z" fill={`url(#${id}-skin)`} />
        <path d="M169 295c-43-77-4-149 71-154 67-6 112 30 115 100l-39 31-1-40-44-14-89 54-6 53Z" fill="var(--art-dark)" />
        <path d="m214 370 46 4-13 8-30-4Z" fill="var(--art-dark)" opacity=".75" />
        <path d="M315 309c28-31 42 6 20 24l-18 7" fill={`url(#${id}-skin)`} />
        <g transform={`rotate(${index === 1 ? -14 : -8} 250 280)`}>
          <path d="m126 243 192-31 47 18-1 80-35 20-190-4-31-24Z" fill="var(--art-dark)" stroke="var(--art-warm)" strokeWidth="5" />
          <path d="m127 243 179-25c19-3 29 11 26 29l-7 55c-2 13-11 21-25 22l-160-3c-17-1-24-9-24-25l-1-34c0-10 4-16 12-19Z" fill={`url(#${id}-visor)`} stroke="var(--art-cool)" strokeWidth="8" />
          <path d="m143 253 149-20M139 263l117-17" stroke="var(--art-shine)" strokeWidth="4" opacity=".75" strokeLinecap="round" />
          <path d="m340 246 30 10-5 31-27-5" fill="var(--art-visor)" />
        </g>
        <path d="m126 520 79 32 57 151M355 515l-56 56 18 149" fill="none" stroke="var(--art-cool)" strokeWidth="3" opacity=".6" />
        <path d="m194 473 75 63 70-56-5 46-62 47-77-47Z" fill="var(--art-shirt)" opacity=".9" />
        {(index === 0 || index === 4) && <g fill="none" strokeLinecap="round">
          <ellipse cx="257" cy="279" rx="225" ry="68" transform="rotate(-23 257 279)" stroke="var(--art-cool)" strokeWidth="15" filter={`url(#${id}-glow)`} />
          <ellipse cx="257" cy="279" rx="225" ry="68" transform="rotate(-23 257 279)" stroke="var(--art-shine)" strokeWidth="2" opacity=".8" />
          <ellipse cx="257" cy="279" rx="235" ry="74" transform="rotate(-20 257 279)" stroke="var(--art-warm)" strokeWidth="3" opacity=".8" />
          <path d="M124 549 210 720M318 489l103 231" stroke="var(--art-warm)" strokeWidth="9" filter={`url(#${id}-glow)`} />
        </g>}
      </svg>;
    })}
    <svg className="auth-mark" viewBox="0 0 56 44" fill="none" stroke="white" strokeWidth="2.2">
      <path d="M28 8C13-3-5 1 10 18c-16 12-6 29 14 16C35 22 37 13 28 8Zm0 0C43-3 61 1 46 18c16 12 6 29-14 16C21 22 19 13 28 8Z" />
    </svg>
  </div>;
}
