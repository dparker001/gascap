'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
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

/** Mirrors SavingsSummary (lib/savingsBaseline.ts) — only the fields used here. */
interface SavingsResponse {
  summary: {
    fillupsTotal:         number;
    compared:             number;
    netSavings:           number;
    avgPaidPerGallon:     number | null;
    avgBaselinePerGallon: number | null;
  };
}

const MILESTONES: { amount: number; emoji: string }[] = [
  { amount: 25,  emoji: '🌱' },
  { amount: 50,  emoji: '💡' },
  { amount: 100, emoji: '🏅' },
  { amount: 250, emoji: '🎯' },
  { amount: 500, emoji: '🏆' },
];

export default function SavingsDashboard() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [data,       setData]       = useState<FillupResponse | null>(null);
  const [savings,    setSavings]    = useState<SavingsResponse['summary'] | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);

    // Fill-up facts + server-computed savings in parallel. The savings figure
    // is time-matched and grade-matched per fill-up (lib/savingsBaseline.ts);
    // if it can't be computed we show NO savings number, never an estimate.
    Promise.all([
      fetch('/api/fillups', { credentials: 'include' })
        .then((r) => r.ok ? r.json() as Promise<FillupResponse> : Promise.reject()),
      fetch('/api/fillups/savings', { credentials: 'include' })
        .then((r) => r.ok ? r.json() as Promise<SavingsResponse> : Promise.reject())
        .then((d) => d.summary)
        .catch(() => null),
    ])
      .then(([fillupData, savingsData]) => {
        setData(fillupData);
        setSavings(savingsData);
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
          <p className="text-xs font-black text-white uppercase tracking-wider">{t.savingsDashboard.title}</p>
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
          <p className="text-xs font-black text-white uppercase tracking-wider">{t.savingsDashboard.title}</p>
        </div>
        <div className="bg-white p-4 text-center">
          <p className="text-xs text-slate-400">{t.savingsDashboard.loadError}</p>
        </div>
      </div>
    );
  }

  if (!data || data.stats.count < 1) return null;

  const { stats, fillups } = data;

  // Facts about ALL logged fill-ups (what the user actually spent).
  const avgPricePerGal = stats.totalGallons > 0
    ? stats.totalSpent / stats.totalGallons
    : 0;

  // Savings only exist for fill-ups that had a defensible baseline.
  const hasComparison        = !!savings && savings.compared > 0;
  const totalSavedVsNational = hasComparison ? savings.netSavings : 0;
  const isSaving             = hasComparison && totalSavedVsNational > 0;
  const notCompared          = savings ? savings.fillupsTotal - savings.compared : 0;

  // Earliest fill-up date for "since joining" message
  const oldestDate = fillups.length > 0
    ? new Date(fillups[fillups.length - 1].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const comparedSub = hasComparison
    ? t.savingsDashboard.comparedBasis(savings.compared, savings.fillupsTotal)
    : t.savingsDashboard.noComparisonHint;

  const statBoxes = [
    {
      label: t.savingsDashboard.totalSpent,
      value: `$${stats.totalSpent.toFixed(2)}`,
      sub:   t.savingsDashboard.acrossFillups(stats.count),
      accent: false,
    },
    {
      label: t.savingsDashboard.totalGallons,
      value: stats.totalGallons.toFixed(1),
      sub:   t.savingsDashboard.gallonsPumped,
      accent: false,
    },
    {
      label: t.savingsDashboard.avgPricePerGal,
      value: `$${avgPricePerGal.toFixed(3)}`,
      sub:   hasComparison && savings.avgBaselinePerGallon != null
        ? t.savingsDashboard.baselineAvgSub(savings.avgBaselinePerGallon.toFixed(3))
        : t.savingsDashboard.yourAverage,
      accent: isSaving,
    },
    hasComparison
      ? {
          label: isSaving ? t.savingsDashboard.estimatedSavings : t.savingsDashboard.aboveNationalAvg,
          value: `$${Math.abs(totalSavedVsNational).toFixed(2)}`,
          sub:   comparedSub,
          accent: isSaving,
        }
      : {
          label: t.savingsDashboard.noComparisonLabel,
          value: t.savingsDashboard.noComparisonValue,
          sub:   comparedSub,
          accent: false,
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
          <p className="text-xs font-black text-white uppercase tracking-wider">{t.savingsDashboard.title}</p>
          {oldestDate && (
            <p className="text-[10px] text-white/50">{t.savingsDashboard.trackedSince(oldestDate)}</p>
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
                <span className="text-xs font-semibold text-emerald-500 ml-1">{t.savingsDashboard.savedLabel}</span>
              </p>
              <p className="text-[10px] text-emerald-600 leading-relaxed">
                {t.savingsDashboard.vsEiaNationalAverage}
                <span className="text-emerald-400 ml-1">({t.savingsDashboard.comparedBasis(savings!.compared, savings!.fillupsTotal)})</span>
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
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{t.savingsDashboard.savingsMilestones}</p>

            <div className="flex items-center gap-2 flex-wrap">
              {MILESTONES.map((m) => {
                const earned = totalSavedVsNational >= m.amount;
                return (
                  <div
                    key={m.amount}
                    title={t.savingsDashboard.milestoneSaved(m.amount)}
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
                    {t.savingsDashboard.nextLabel} <span className="font-bold text-slate-600">{nextMilestone.emoji} {t.savingsDashboard.milestoneSaved(nextMilestone.amount)}</span>
                  </p>
                  <p className="text-[9px] font-bold text-amber-600">
                    {t.savingsDashboard.amountToGo((nextMilestone.amount - totalSavedVsNational).toFixed(2))}
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
                🏆 {t.savingsDashboard.allMilestonesEarned}
              </p>
            )}
          </div>
        )}

        {notCompared > 0 && hasComparison && (
          <p className="text-[10px] text-slate-400 text-center leading-relaxed">
            {t.savingsDashboard.coverageNote(notCompared)}
          </p>
        )}

        {/* Methodology — always reachable, so the number is never a black box. */}
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer font-bold text-slate-600">{t.savingsDashboard.methodologyTitle}</summary>
          <p className="mt-1 leading-relaxed">{t.savingsDashboard.methodologyBody}</p>
        </details>

        {oldestDate && (
          <p className="text-[10px] text-slate-400 text-center leading-relaxed">
            {t.savingsDashboard.loggedSincePrefix} <span className="font-bold text-slate-600">{t.savingsDashboard.fillupCount(stats.count)}</span> {t.savingsDashboard.loggedSinceSuffix(oldestDate)}
            <span className="text-slate-300"> {t.savingsDashboard.eiaUpdatedWeekly}</span>
          </p>
        )}
      </div>
    </div>
  );
}
