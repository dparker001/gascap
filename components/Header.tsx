// GasCap™ hero header
'use client';
import Link                 from 'next/link';
import { useState, useEffect } from 'react';
import { useSession }       from 'next-auth/react';
import AuthButton           from './AuthButton';
import PlanBadge            from './PlanBadge';
import TipsTicker           from './TipsTicker';
import { useTranslation }   from '@/contexts/LanguageContext';

export default function Header() {
  const { t, locale, toggle } = useTranslation();
  const { data: session }     = useSession();
  const [giftWiggle, setGiftWiggle] = useState(false);

  // Wiggle the gift box every 6 seconds to draw attention
  useEffect(() => {
    if (!session) return;
    const INTERVAL = 6000;
    const DURATION = 750;
    // Small initial delay so it doesn't fire instantly on load
    const first = setTimeout(() => {
      setGiftWiggle(true);
      setTimeout(() => setGiftWiggle(false), DURATION);
    }, 2500);
    const interval = setInterval(() => {
      setGiftWiggle(true);
      setTimeout(() => setGiftWiggle(false), DURATION);
    }, INTERVAL);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [session]);

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

      <div className="relative max-w-lg lg:max-w-6xl mx-auto">

        {/* ── Top row: logo + wordmark + auth ── */}
        <div className="flex items-center justify-between mb-5">

          {/* Logo — transparent icon + text, no background */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <img
              src="/gascap-icon-raw.png"
              alt=""
              className="h-12 w-auto object-contain drop-shadow-sm"
            />
            <span className="text-white font-black text-2xl leading-none tracking-tight">
              GasCap<sup className="text-xs font-bold" style={{ verticalAlign: '0.6em' }}>™</sup>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <button
              onClick={toggle}
              aria-label={locale === 'en' ? 'Switch to Spanish' : 'Cambiar a inglés'}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20
                         transition-colors rounded-xl px-2.5 py-1.5"
            >
              <span className="text-sm" aria-hidden="true">🌐</span>
              <span className="text-[10px] font-black text-white/80">
                {locale === 'en' ? 'ES' : 'EN'}
              </span>
            </button>
            {session && (
              <Link
                href="/giveaway"
                className="flex items-center gap-1 bg-white/10 hover:bg-white/20
                           transition-colors rounded-xl px-2.5 py-1.5"
                title="Monthly Gas Card Giveaway"
              >
                <span
                  className={`text-sm inline-block ${giftWiggle ? 'animate-gift-wiggle' : ''}`}
                  aria-hidden="true"
                >🎁</span>
                <span className="text-[10px] font-black text-white/80 hidden sm:inline">Gas Card</span>
              </Link>
            )}
            <AuthButton />
          </div>
        </div>


        {/* ── Divider ── */}
        <div className="h-px bg-gradient-to-r from-white/0 via-white/10 to-white/0 mb-4 mt-1" />

        {/* ── Tagline + plan badge row ── */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-white text-[22px] font-black leading-tight tracking-tight">
              {t.header.tagline.split('\n').map((line, i, arr) => (
                <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
              ))}
            </p>
            <p className="text-white/50 text-xs leading-relaxed mt-1.5 max-w-[220px]">
              {t.header.sub}
            </p>
          </div>
          {/* Stats pills */}
          <div className="flex flex-col gap-1.5 flex-shrink-0 mt-1">
            <div className="flex items-center gap-1.5 bg-white/8 rounded-xl px-2.5 py-1.5">
              <span className="text-brand-orange text-xs">⛽</span>
              <span className="text-white/70 text-[10px] font-semibold">{t.header.realTimePrices}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/8 rounded-xl px-2.5 py-1.5">
              <span className="text-brand-teal text-xs">✓</span>
              <span className="text-white/70 text-[10px] font-semibold">{t.header.worksOffline}</span>
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
