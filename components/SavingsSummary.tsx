'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
  const [stats, setStats]     = useState<FillupStats | null>(null);
  const [loading, setLoading] = useState(true);

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
              Start tracking your fuel spend
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
              Log your first fill-up to see your running totals, average price paid, and MPG trends.
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
            Log fill-up
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
      label: 'Total tracked spend',
      color: 'text-[#005F4A]',
      bg:    'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800',
    },
    {
      icon:  '⛽',
      value: `${stats.totalGallons.toFixed(1)}`,
      label: 'Gallons logged',
      color: 'text-slate-700 dark:text-slate-200',
      bg:    'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700',
    },
    {
      icon:  '📊',
      value: avgPrice > 0 ? `$${avgPrice.toFixed(3)}` : '—',
      label: 'Avg price / gal',
      color: 'text-slate-700 dark:text-slate-200',
      bg:    'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700',
    },
  ];

  return (
    <section className="px-4 lg:px-0 pb-3 max-w-lg lg:max-w-none mx-auto w-full">

      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-sm" aria-hidden="true">💰</span>
        <h2 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          Fuel Spend Tracker
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        <span className="text-[10px] text-slate-400 font-semibold whitespace-nowrap">
          {stats.count} fill-up{stats.count !== 1 ? 's' : ''} logged
        </span>
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
            <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
              {label}
            </p>
          </div>
        ))}
      </div>

      {stats.avgMpg && (
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Avg MPG across tracked vehicles:{' '}
          <span className="font-bold text-slate-600 dark:text-slate-300">
            {stats.avgMpg} mpg
          </span>
        </p>
      )}
    </section>
  );
}
