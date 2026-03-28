// GasCap™ hero header
'use client';
import AuthButton  from './AuthButton';
import PlanBadge   from './PlanBadge';
import TipsTicker  from './TipsTicker';

export default function Header() {
  return (
    <header className="relative overflow-hidden bg-navy-700 pt-10 pb-7 px-5">

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
      {/* Amber accent dot */}
      <div className="absolute top-6 right-6 w-3 h-3 rounded-full bg-amber-400
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
            {/* Logo icon with glow ring */}
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 rounded-2xl bg-amber-400 opacity-30 blur-sm scale-110"
                   aria-hidden="true" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600
                              flex items-center justify-center shadow-lg">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
                  <rect x="2" y="6" width="11" height="16" rx="1.5" />
                  <rect x="4" y="9" width="7" height="4" rx="0.75" />
                  <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
                  <circle cx="18.5" cy="18.5" r="1.5" />
                </svg>
              </div>
            </div>

            <div>
              <h1 className="text-[28px] font-black tracking-tight leading-none text-white flex items-end gap-0">
                <span>Gas</span>
                <span className="relative inline-block">
                  {/* Graduation cap above the C */}
                  <svg
                    viewBox="0 0 22 15"
                    className="absolute text-amber-400 pointer-events-none"
                    style={{ width: 16, height: 11, top: -13, left: -1 }}
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    {/* Mortarboard flat top (diamond) */}
                    <polygon points="11,1 21,5 11,9 1,5" />
                    {/* Cap body */}
                    <rect x="6" y="7.5" width="10" height="5.5" rx="1.2" opacity="0.85" />
                    {/* Tassel string */}
                    <line x1="20" y1="6" x2="20" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    {/* Tassel end dot */}
                    <circle cx="20" cy="13.5" r="1.5" />
                  </svg>
                  Cap
                </span>
                <sup className="text-amber-400 text-[13px] font-bold ml-0.5 align-super">™</sup>
              </h1>
              <p className="text-amber-300/60 text-[9px] font-bold tracking-[0.22em] uppercase mt-0.5">
                Gas Capacity Calculator
              </p>
            </div>
          </div>

          <AuthButton />
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
              <span className="text-amber-400 text-xs">⛽</span>
              <span className="text-white/70 text-[10px] font-semibold">Real-time prices</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/8 rounded-xl px-2.5 py-1.5">
              <span className="text-green-400 text-xs">✓</span>
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
