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

interface NationalAvgResponse {
  price:     number | null;
  noApiKey?: boolean;
}

const FALLBACK_PRICE = 3.45; // reasonable fallback if EIA unavailable

const MILESTONES: { amount: number; emoji: string; label: string }[] = [
  { amount: 25,  emoji: '🌱', label: '$25 saved' },
  { amount: 50,  emoji: '💡', label: '$50 saved' },
  { amount: 100, emoji: '🏅', label: '$100 saved' },
  { amount: 250, emoji: '🎯', label: '$250 saved' },
  { amount: 500, emoji: '🏆', label: '$500 saved' },
];

export default function SavingsDashboard() {
  const { data: session } = useSession();
  const [data,       setData]       = useState<FillupResponse | null>(null);
  const [nationalAvg, setNationalAvg] = useState<number | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);

    // Fetch fill-up data + national avg in parallel
    Promise.all([
      fetch('/api/fillups', { credentials: 'include' })
        .then((r) => r.ok ? r.json() as Promise<FillupResponse> : Promise.reject()),
      fetch('/api/gas-price/national')
        .then((r) => r.ok ? r.json() as Promise<NationalAvgResponse> : Promise.reject())
        .catch(() => ({ price: null } as NationalAvgResponse)),
    ])
      .then(([fillupData, avgData]) => {
        setData(fillupData);
        setNationalAvg(avgData.price);
      })
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
  const compPrice = nationalAvg ?? FALLBACK_PRICE;

  const avgPricePerGal = stats.totalGallons > 0
    ? stats.totalSpent / stats.totalGallons
    : 0;
  const comparisonDiff      = compPrice - avgPricePerGal;
  const totalSavedVsNational = comparisonDiff * stats.totalGallons;
  const isSaving             = totalSavedVsNational > 0;

  // Earliest fill-up date for "since joining" message
  const oldestDate = fillups.length > 0
    ? new Date(fillups[fillups.length - 1].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const avgLabel = nationalAvg
    ? `vs. $${nationalAvg.toFixed(3)} national avg (EIA)`
    : `vs. $${FALLBACK_PRICE.toFixed(2)} est. avg`;

  const statBoxes = [
    {
      label: 'Total Spent',
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
      sub:   nationalAvg ? `national avg $${nationalAvg.toFixed(3)}` : 'your average',
      accent: isSaving,
    },
    {
      label: isSaving ? 'Estimated Savings' : 'Above National Avg',
      value: `$${Math.abs(totalSavedVsNational).toFixed(2)}`,
      sub:   avgLabel,
      accent: isSaving,
    },
  ];

  // Milestones — only count positive savings
  const earnedMilestones = isSaving
    ? MILESTONES.filter((m) => totalSavedVsNational >= m.amount)
    : [];
  const nextMilestone = MILESTONES.find((m) => totalSavedVsNational < m.amount) ?? null;
  const prevMilestoneAmount = nextMilestone
    ? (MILESTONES[MILESTONES.indexOf(nextMilestone) - 1]?.amount ?? 0)
    : 0;
  const progressRange = nextMilestone
    ? nextMilestone.amount - prevMilestoneAmount
    : 1;
  const progressInRange = isSaving && nextMilestone
    ? Math.min(progressRange, totalSavedVsNational - prevMilestoneAmount)
    : 0;
  const progressPctInRange = Math.min(100, (progressInRange / progressRange) * 100);

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

        {/* Hero savings number — only shown when net-positive */}
        {isSaving && totalSavedVsNational >= 5 && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center gap-3">
            <span className="text-2xl flex-shrink-0" aria-hidden="true">💚</span>
            <div>
              <p className="text-xl font-black text-emerald-700 leading-tight">
                ${totalSavedVsNational.toFixed(2)}
                <span className="text-xs font-semibold text-emerald-500 ml-1">saved</span>
              </p>
              <p className="text-[10px] text-emerald-600 leading-relaxed">
                vs. {nationalAvg ? 'EIA national average' : 'estimated national average'}
                {nationalAvg && <span className="text-emerald-400 ml-1">(${nationalAvg.toFixed(3)}/gal)</span>}
              </p>
            </div>
          </div>
        )}

        {/* 4-stat grid */}
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

        {/* Milestone badges */}
        {isSaving && (
          <div className="space-y-2 pt-1">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide">Savings Milestones</p>

            <div className="flex items-center gap-2 flex-wrap">
              {MILESTONES.map((m) => {
                const earned = totalSavedVsNational >= m.amount;
                return (
                  <div
                    key={m.amount}
                    title={m.label}
                    className={[
                      'flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-2 min-w-[52px]',
                      earned
                        ? 'bg-amber-50 border border-amber-200'
                        : 'bg-slate-50 border border-slate-100 opacity-40',
                    ].join(' ')}
                  >
                    <span className="text-lg leading-none" aria-hidden="true">{m.emoji}</span>
                    <p className={[
                      'text-[9px] font-black leading-none whitespace-nowrap',
                      earned ? 'text-amber-600' : 'text-slate-400',
                    ].join(' ')}>
                      ${m.amount}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Progress to next milestone */}
            {nextMilestone && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-slate-400">
                    Next: <span className="font-bold text-slate-600">{nextMilestone.emoji} {nextMilestone.label}</span>
                  </p>
                  <p className="text-[9px] font-bold text-amber-600">
                    ${(nextMilestone.amount - totalSavedVsNational).toFixed(2)} to go
                  </p>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${progressPctInRange}%` }}
                  />
                </div>
              </div>
            )}

            {/* All milestones earned */}
            {!nextMilestone && earnedMilestones.length === MILESTONES.length && (
              <p className="text-[10px] text-center text-amber-600 font-bold">
                🏆 All milestones earned — you&apos;re a GasCap™ champion!
              </p>
            )}
          </div>
        )}

        {oldestDate && (
          <p className="text-[10px] text-slate-400 text-center leading-relaxed">
            You&apos;ve logged <span className="font-bold text-slate-600">{stats.count} fill-up{stats.count !== 1 ? 's' : ''}</span> since {oldestDate}
            {nationalAvg && (
              <span className="text-slate-300"> · EIA data updated weekly</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
