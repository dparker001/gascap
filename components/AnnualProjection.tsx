'use client';

/**
 * AnnualProjection
 *
 * Standalone card surfacing the annual fuel cost projection.
 * Uses the same date-span extrapolation as FillupHistory's inline stat.
 * Requires 3+ fill-ups spanning at least 7 days — returns null otherwise.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import type { Fillup } from '@/lib/fillups';

interface FillupResponse {
  fillups: Fillup[];
  stats: {
    count:        number;
    totalSpent:   number;
    totalGallons: number;
    avgMpg:       number | null;
  };
}

function calcAnnualProjection(fillups: Fillup[], totalSpent: number): number | null {
  if (fillups.length < 3) return null;
  const dates   = fillups.map((f) => new Date(f.date + 'T12:00:00').getTime());
  const oldest  = Math.min(...dates);
  const newest  = Math.max(...dates);
  const daySpan = (newest - oldest) / 86_400_000;
  if (daySpan < 7) return null;
  return (totalSpent / daySpan) * 365;
}

export default function AnnualProjection() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [projection, setProjection] = useState<number | null>(null);
  const [fillupCount, setFillupCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<FillupResponse> : Promise.reject())
      .then((d) => {
        setFillupCount(d.stats.count);
        const proj = calcAnnualProjection(d.fillups, d.stats.totalSpent);
        setProjection(proj);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [session]);

  // Listen for new fill-ups to refresh
  useEffect(() => {
    const handler = () => {
      if (!session) return;
      fetch('/api/fillups', { credentials: 'include' })
        .then((r) => r.ok ? r.json() as Promise<FillupResponse> : Promise.reject())
        .then((d) => {
          setFillupCount(d.stats.count);
          const proj = calcAnnualProjection(d.fillups, d.stats.totalSpent);
          setProjection(proj);
        })
        .catch(() => {});
    };
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [session]);

  if (!session || !loaded) return null;
  if (projection === null) return null;

  // Monthly breakdown
  const monthly = projection / 12;
  const weekly  = projection / 52;

  return (
    <section className="px-4 lg:px-0 pb-3 max-w-lg lg:max-w-none mx-auto w-full">
      <div className="rounded-2xl bg-[#1E2D4A] overflow-hidden shadow-sm">
        <div className="px-4 pt-3.5 pb-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base" aria-hidden="true">📅</span>
          <p className="text-[10px] font-black text-white/70 uppercase tracking-wider">
            {t.annualProjection.heading}
          </p>
        </div>

        {/* Hero number */}
        <div className="flex items-end gap-2 mb-1">
          <p className="text-3xl font-black text-amber-400 leading-none">
            ${Math.round(projection).toLocaleString('en-US')}
          </p>
          <p className="text-sm font-semibold text-white/60 pb-0.5">{t.annualProjection.perYear}</p>
        </div>
        <p className="text-[10px] text-white/55 leading-relaxed">
          {t.annualProjection.basedOnLast(fillupCount)}
        </p>

        {/* Monthly + weekly breakdown pills */}
        <div className="flex gap-2 mt-3">
          <div className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-center">
            <p className="text-sm font-black text-white">${Math.round(monthly).toLocaleString('en-US')}</p>
            <p className="text-[9px] text-white/60 font-semibold uppercase tracking-wide mt-0.5">{t.annualProjection.perMonth}</p>
          </div>
          <div className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-center">
            <p className="text-sm font-black text-white">${Math.round(weekly).toLocaleString('en-US')}</p>
            <p className="text-[9px] text-white/60 font-semibold uppercase tracking-wide mt-0.5">{t.annualProjection.perWeek}</p>
          </div>
        </div>

        <p className="text-[9px] text-white/45 text-center mt-2.5 leading-relaxed">
          {t.annualProjection.disclaimer}
        </p>
      </div>
      </div>
    </section>
  );
}
