'use client';

/**
 * FirstCalcNudge — activation nudge shown to users who haven't run a calculation
 * yet. Funnel data showed ~72% of signups return but only ~30% ever calculate,
 * so this demonstrates the value in 2 seconds (an example result) and gives a
 * one-tap "Calculate mine" CTA. Self-hides the moment they run a calc.
 *
 * Listens for the window `gascap:calculated` event the calculators dispatch.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';

const DONE_KEY = 'gc_has_calculated';

export default function FirstCalcNudge() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DONE_KEY) === '1') return;
    setShow(true);

    const onCalc = () => {
      try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
      setShow(false);
    };
    window.addEventListener('gascap:calculated', onCalc);
    return () => window.removeEventListener('gascap:calculated', onCalc);
  }, []);

  if (!show) return null;

  const goToCalc = () => {
    document.getElementById('gascap-calculator')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="px-4 lg:px-0 pt-3 max-w-lg lg:max-w-none mx-auto w-full">
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-sm p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">
          {t.calc.firstCalcEyebrow}
        </p>
        <p className="text-navy-700 font-black text-base leading-snug mt-0.5">
          {t.calc.firstCalcHeadline}
        </p>

        {/* Instant example result */}
        <div className="mt-2.5 flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-3 py-2.5">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">⛽</span>
          <p className="text-xs text-slate-600 leading-snug">
            {t.calc.firstCalcExample}{' '}
            <span className="font-black text-emerald-600 text-sm">$39</span>{' '}
            <span className="text-slate-400">{t.calc.firstCalcExampleD}</span>
          </p>
        </div>

        <button
          onClick={goToCalc}
          className="mt-3 w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400
                     text-white font-black text-sm transition-colors"
        >
          {t.calc.firstCalcCta}
        </button>

        {session?.user && (
          <p className="text-[11px] text-slate-400 mt-2 text-center">
            🎟️ {t.calc.firstCalcGiveaway}
          </p>
        )}
      </div>
    </div>
  );
}
