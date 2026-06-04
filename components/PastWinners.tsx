'use client';

import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';

interface Winner {
  name:   string;   // First name + last initial only
  monthDate: Date;  // first day of the win month — formatted per active locale
  prize?: string;   // optional override; falls back to localized default
}

// Add new winners here each month — newest first
const WINNERS: Winner[] = [
  { name: 'Luis L.', monthDate: new Date(2026, 3, 1) },
];

/**
 * Next drawing = the next occurrence of the 5th of a month. The 5th-of-month
 * draw is for the PRIOR month's entries (e.g. June 5 draws May). Auto-advances
 * each month: before the 5th → this month's 5th; on/after the 5th → next month's.
 */
function nextDrawing(locale: 'en' | 'es'): { dateLabel: string; entryMonth: string } {
  const now    = new Date();
  const offset = now.getDate() < 5 ? 0 : 1;
  const draw   = new Date(now.getFullYear(), now.getMonth() + offset, 5);
  const entry  = new Date(draw.getFullYear(), draw.getMonth() - 1, 1);
  const intlLocale = locale === 'es' ? 'es-ES' : 'en-US';
  return {
    dateLabel:  draw.toLocaleDateString(intlLocale, { month: 'long', day: 'numeric', year: 'numeric' }),
    entryMonth: entry.toLocaleDateString(intlLocale, { month: 'long' }),
  };
}

/** Past giveaway winners — displayed on the landing page guest section. */
export default function PastWinners() {
  const { t, locale } = useTranslation();

  if (WINNERS.length === 0) return null;

  const intlLocale = locale === 'es' ? 'es-ES' : 'en-US';
  const nd = nextDrawing(locale);

  return (
    <section className="px-4 pb-5 max-w-lg mx-auto w-full">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4">

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-px bg-amber-200" />
          <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest whitespace-nowrap">
            {t.pastWinners.heading}
          </span>
          <div className="flex-1 h-px bg-amber-200" />
        </div>

        {/* Next drawing announcement — auto-updates to the next 5th-of-month */}
        <div className="mb-3 rounded-xl bg-gradient-to-r from-amber-500 to-[#FA7109] px-3.5 py-2.5 text-center shadow-sm">
          <p className="text-[10px] font-black text-white/90 uppercase tracking-widest">{t.pastWinners.nextDrawing}</p>
          <p className="text-sm font-black text-white mt-0.5">{nd.dateLabel}</p>
          <p className="text-[11px] text-white/85 mt-0.5">{t.pastWinners.forEntries(nd.entryMonth)}</p>
        </div>

        <div className="space-y-2">
          {WINNERS.map((w) => {
            const monthLabel = w.monthDate.toLocaleDateString(intlLocale, { month: 'long', year: 'numeric' });
            return (
            <div
              key={`${w.name}-${monthLabel}`}
              className="flex items-center justify-between gap-3
                         bg-white rounded-xl border border-amber-100 px-3 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-lg flex-shrink-0" aria-hidden="true">🏆</span>
                <div>
                  <p className="text-xs font-black text-slate-800">{w.name}</p>
                  <p className="text-[10px] text-slate-400">{monthLabel}</p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-amber-700 whitespace-nowrap">
                {w.prize ?? t.pastWinners.prize}
              </span>
            </div>
            );
          })}
        </div>

        <p className="mt-3 text-center text-[11px] text-amber-700 leading-relaxed">
          {t.pastWinners.newWinner}{' '}
          <Link href="/signup" className="font-bold underline hover:text-amber-800">
            {t.pastWinners.createAccount}
          </Link>{' '}
          {t.pastWinners.toEnter}
        </p>
      </div>
    </section>
  );
}
