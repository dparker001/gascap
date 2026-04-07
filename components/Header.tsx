// GasCap™ hero header
'use client';
import Link        from 'next/link';
import AuthButton  from './AuthButton';
import PlanBadge   from './PlanBadge';
import TipsTicker  from './TipsTicker';

export default function Header() {
  return (
    <header className="relative overflow-hidden bg-brand-dark pt-10 pb-7 px-5">

      {/* ── Decorative background shapes ── */}
      {/* Large arc top-right */}
      <svg className="absolute top-0 right-0 opacity-[0.06] pointer-events-none"
           width="260" height="200" viewBox="0 0 260 200" aria-hidden="true">
        <path d="M 220 195 A 185 185 0 0 0 35 195"
          fill="none" stroke="white" strokeWidth="32" strokeLinecap="round" />
        <path d="M 190 193 A 130 130 0 0 0 65 193"
          fill="none" stroke="white" strokeWidth="20" strokeLinecap="round" />
      </svg>
      {/* Circle bottom-left */}
      <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full border-[24px]
                      border-white opacity-[0.04] pointer-events-none" aria-hidden="true" />
      {/* Orange accent dot */}
      <div className="absolute top-6 right-6 w-3 h-3 rounded-full bg-brand-orange
                      opacity-40 pointer-events-none" aria-hidden="true" />
      {/* Small grid of dots — decorative */}
      <div className="absolute bottom-4 right-8 grid grid-cols-3 gap-1.5 opacity-[0.08] pointer-events-none"
           aria-hidden="true">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="w-1 h-1 rounded-full bg-white" />
        ))}
      </div>

      <div className="relative max-w-lg mx-auto">

        {/* ── Top row: logo + wordmark + auth ── */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            {/* Logo icon — official P pump SVG mark */}
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 rounded-2xl bg-brand-teal opacity-20 blur-sm scale-110"
                   aria-hidden="true" />
              <img
                src="/logo-icon.svg"
                alt="GasCap logo"
                className="relative w-12 h-12 rounded-xl"
                aria-hidden="true"
              />
            </div>

            {/* Wordmark — lowercase "gascap™" matching brand style */}
            <div>
              <h1 className="leading-none">
                <span className="text-[26px] font-black tracking-tight text-brand-teal">gasca</span>
                <span className="text-[26px] font-black tracking-tight text-white">p</span>
                <sup className="text-brand-orange text-[13px] font-bold ml-0.5 align-super">™</sup>
              </h1>
              <p className="text-white/50 text-[9px] font-bold tracking-[0.22em] uppercase mt-0.5">
                Gas Capacity Calculator
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/wrapped"
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20
                         transition-colors rounded-xl px-2.5 py-1.5"
              title="Your Annual Wrapped"
            >
              <span className="text-sm" aria-hidden="true">🎁</span>
              <span className="text-[10px] font-black text-white/80 hidden sm:inline">Wrapped</span>
            </Link>
            <AuthButton />
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="h-px bg-gradient-to-r from-white/0 via-white/10 to-white/0 mb-4" />

        {/* ── Tagline + plan badge row ── */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-white text-[22px] font-black leading-tight tracking-tight">
              Know before<br />you go.
            </p>
            <p className="text-white/50 text-xs leading-relaxed mt-1.5 max-w-[220px]">
              Calculate fuel & cost before you pull up to the pump.
            </p>
          </div>
          {/* Stats pills */}
          <div className="flex flex-col gap-1.5 flex-shrink-0 mt-1">
            <div className="flex items-center gap-1.5 bg-white/8 rounded-xl px-2.5 py-1.5">
              <span className="text-brand-orange text-xs">⛽</span>
              <span className="text-white/70 text-[10px] font-semibold">Real-time prices</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/8 rounded-xl px-2.5 py-1.5">
              <span className="text-brand-teal text-xs">✓</span>
              <span className="text-white/70 text-[10px] font-semibold">Works offline</span>
            </div>
          </div>
        </div>

        {/* ── Plan badge ── */}
        <PlanBadge />

        {/* ── Rotating tips ticker ── */}
        <TipsTicker />

      </div>
    </header>
  );
}
