'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Fillup } from '@/lib/fillups';

interface FillupStats {
  count:        number;
  totalSpent:   number;
  totalGallons: number;
  avgMpg:       number | null;
}

interface FillupResponse {
  fillups: Fillup[];
  stats:   FillupStats;
}

const COMPARISON_PRICE = 4.50; // $/gal comparison baseline

export default function SavingsDashboard() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<FillupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch('/api/fillups', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<FillupResponse> : Promise.reject())
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [session]);

  if (!session) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 py-2.5 px-4 bg-navy-700">
          <span className="text-sm" aria-hidden="true">💰</span>
          <p className="text-xs font-black text-white uppercase tracking-wider">Savings Dashboard</p>
        </div>
        <div className="bg-white p-4 space-y-2">
          <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 py-2.5 px-4 bg-navy-700">
          <span className="text-sm" aria-hidden="true">💰</span>
          <p className="text-xs font-black text-white uppercase tracking-wider">Savings Dashboard</p>
        </div>
        <div className="bg-white p-4 text-center">
          <p className="text-xs text-slate-400">Could not load savings data.</p>
        </div>
      </div>
    );
  }

  if (!data || data.stats.count < 1) return null;

  const { stats, fillups } = data;
  const avgPricePerGal = stats.totalGallons > 0
    ? stats.totalSpent / stats.totalGallons
    : 0;
  const comparisonDiff = COMPARISON_PRICE - avgPricePerGal;
  const totalSavedVsBaseline = comparisonDiff * stats.totalGallons;

  const statBoxes = [
    {
      label: 'Total Spent Tracked',
      value: `$${stats.totalSpent.toFixed(2)}`,
      sub:   `across ${stats.count} fill-up${stats.count !== 1 ? 's' : ''}`,
      accent: false,
    },
    {
      label: 'Total Gallons',
      value: stats.totalGallons.toFixed(1),
      sub:   'gallons pumped',
      accent: false,
    },
    {
      label: 'Avg Price / Gal',
      value: `$${avgPricePerGal.toFixed(3)}`,
      sub:   `vs $${COMPARISON_PRICE.toFixed(2)} avg`,
      accent: comparisonDiff > 0,
    },
    {
      label: comparisonDiff > 0 ? 'Est. Savings' : 'Above Baseline',
      value: `$${Math.abs(totalSavedVsBaseline).toFixed(2)}`,
      sub:   comparisonDiff > 0 ? 'vs $4.50/gal baseline' : 'vs $4.50/gal baseline',
      accent: comparisonDiff > 0,
    },
  ];

  // Earliest fill-up date for "since joining" message
  const oldestDate = fillups.length > 0
    ? new Date(fillups[fillups.length - 1].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Navy header strip */}
      <div className="flex items-center gap-2 py-2.5 px-4 bg-navy-700">
        <span className="text-sm" aria-hidden="true">💰</span>
        <div>
          <p className="text-xs font-black text-white uppercase tracking-wider">Savings Dashboard</p>
          {oldestDate && (
            <p className="text-[10px] text-white/50">Tracked since {oldestDate}</p>
          )}
        </div>
      </div>

      <div className="bg-white p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {statBoxes.map(({ label, value, sub, accent }) => (
            <div
              key={label}
              className={[
                'rounded-xl px-3 py-2.5',
                accent ? 'bg-amber-50 border border-amber-100' : 'bg-slate-50',
              ].join(' ')}
            >
              <p className={[
                'text-base font-black leading-tight',
                accent ? 'text-amber-600' : 'text-slate-700',
              ].join(' ')}>
                {value}
              </p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5 leading-tight">{label}</p>
              <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">{sub}</p>
            </div>
          ))}
        </div>

        {oldestDate && (
          <p className="text-[10px] text-slate-400 text-center leading-relaxed">
            You&apos;ve logged <span className="font-bold text-slate-600">{stats.count} fill-up{stats.count !== 1 ? 's' : ''}</span> since {oldestDate}
          </p>
        )}
      </div>
    </div>
  );
}
