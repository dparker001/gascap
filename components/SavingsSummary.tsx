'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/contexts/LanguageContext';
import { nativeShare } from '@/lib/share';
import { hapticSuccess } from '@/lib/haptics';

interface FillupStats {
  count:        number;
  totalSpent:   number;
  totalGallons: number;
  avgMpg:       number | null;
}

interface FillupResponse {
  stats: FillupStats;
}

/**
 * Savings & spend summary card — shown to logged-in users on the main page.
 * Fetches /api/fillups and displays running totals so users can see their
 * fuel spend at a glance. Hidden until the first fill-up is logged.
 */
export default function SavingsSummary() {
  const { t } = useTranslation();
  const [stats, setStats]       = useState<FillupStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [shareCopied, setShareCopied] = useState(false);

  async function handleShare() {
    if (!stats) return;
    const avgPrice = stats.totalGallons > 0 ? stats.totalSpent / stats.totalGallons : 0;
    const text = [
      `⛽ I've logged ${stats.count} fill-up${stats.count !== 1 ? 's' : ''} with GasCap™`,
      `💰 Total spent: $${stats.totalSpent.toFixed(2)}`,
      avgPrice > 0 ? `📊 Avg price: $${avgPrice.toFixed(3)}/gal` : null,
      stats.avgMpg ? `🚗 Avg fuel economy: ${stats.avgMpg} mpg` : null,
      `Track your fuel spend at gascap.app`,
    ].filter(Boolean).join('\n');

    const result = await nativeShare({ title: 'My GasCap™ Fuel Stats', text });
    if (result === 'shared' || result === 'copied') {
      hapticSuccess();
      if (result === 'copied') {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      }
    }
  }

  useEffect(() => {
    fetch('/api/fillups')
      .then((r) => r.json())
      .then((d: FillupResponse) => {
        if (d.stats) setStats(d.stats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Don't show until we have data
  if (loading || !stats) return null;

  // Empty state — no fill-ups yet
  if (stats.count === 0) {
    return (
      <section className="px-4 lg:px-0 pb-3 max-w-lg lg:max-w-none mx-auto w-full">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100
                        dark:border-slate-700 shadow-sm px-4 py-4
                        flex items-center gap-3">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">💰</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black text-slate-700 dark:text-slate-200">
              {t.savings.emptyTitle}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.savings.emptySub}
            </p>
          </div>
          <Link
            href="#log"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(
                new CustomEvent('gascap:switch-tools-tab', { detail: { tab: 'log' } })
              );
              document.getElementById('gascap-tools')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex-shrink-0 px-3 py-1.5 bg-[#1EB68F] text-white text-xs font-bold
                       rounded-xl hover:bg-[#189b7a] transition-colors whitespace-nowrap"
          >
            {t.savings.logFillUp}
          </Link>
        </div>
      </section>
    );
  }

  const avgPrice = stats.totalGallons > 0
    ? stats.totalSpent / stats.totalGallons
    : 0;

  const tiles = [
    {
      icon:  '💰',
      value: `$${stats.totalSpent.toFixed(2)}`,
      label: t.savingsSummary.totalSpend,
      color: 'text-[#005F4A]',
      bg:    'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800',
    },
    {
      icon:  '⛽',
      value: `${stats.totalGallons.toFixed(1)}`,
      label: t.savingsSummary.gallonsLogged,
      color: 'text-slate-700 dark:text-slate-200',
      bg:    'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700',
    },
    {
      icon:  '📊',
      value: avgPrice > 0 ? `$${avgPrice.toFixed(3)}` : '—',
      label: t.savingsSummary.avgPrice,
      color: 'text-slate-700 dark:text-slate-200',
      bg:    'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700',
    },
  ];

  return (
    <section className="px-4 lg:px-0 pb-3 max-w-lg lg:max-w-none mx-auto w-full">

      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-sm" aria-hidden="true">💰</span>
        <h2 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          {t.savingsSummary.title}
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">
          {t.savingsSummary.fillUpsLogged(stats.count)}
        </span>
        <button
          type="button"
          onClick={handleShare}
          aria-label="Share my fuel stats"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700
                     hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95
                     transition-all text-[10px] font-bold text-slate-600 dark:text-slate-300
                     whitespace-nowrap"
        >
          {shareCopied ? '✓ Copied' : '↑ Share'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {tiles.map(({ icon, value, label, color, bg }) => (
          <div
            key={label}
            className={`rounded-2xl border px-3 py-3 text-center ${bg}`}
          >
            <span className="text-base" aria-hidden="true">{icon}</span>
            <p className={`text-sm font-black leading-none mt-1 ${color}`}>
              {value}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
              {label}
            </p>
          </div>
        ))}
      </div>

      {stats.avgMpg && (
        <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
          {t.savingsSummary.avgMpgLabel}{' '}
          <span className="font-bold text-slate-600 dark:text-slate-300">
            {stats.avgMpg} mpg
          </span>
        </p>
      )}
    </section>
  );
}
