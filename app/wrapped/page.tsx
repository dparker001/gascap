'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession }   from 'next-auth/react';
import { useRouter }    from 'next/navigation';
import Link             from 'next/link';
import type { Fillup }  from '@/lib/fillups';

interface FillupResponse { fillups: Fillup[]; }

interface WrappedStats {
  year:         number;
  totalFillups: number;
  totalGallons: number;
  totalSpent:   number;
  avgPrice:     number;
  bestMonth:    string;
  worstMonth:   string;
  topVehicle:   string;
  biggestFill:  number;
  estMiles:     number | null;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function computeStats(fillups: Fillup[]): WrappedStats | null {
  if (fillups.length === 0) return null;

  // Use most recent year with data
  const years = [...new Set(fillups.map(f => Number(f.date.slice(0, 4))))].sort((a, b) => b - a);
  const year  = years[0];
  const yFills = fillups.filter(f => f.date.startsWith(String(year)));
  if (yFills.length === 0) return null;

  const totalFillups = yFills.length;
  const totalGallons = yFills.reduce((s, f) => s + f.gallonsPumped, 0);
  const totalSpent   = yFills.reduce((s, f) => s + f.totalCost, 0);
  const avgPrice     = totalGallons > 0 ? totalSpent / totalGallons : 0;
  const biggestFill  = Math.max(...yFills.map(f => f.totalCost));

  // Monthly breakdown
  const monthly: Record<string, number> = {};
  for (const f of yFills) {
    const m = f.date.slice(0, 7); // YYYY-MM
    monthly[m] = (monthly[m] ?? 0) + f.totalCost;
  }
  const sortedMonths = Object.entries(monthly).sort((a, b) => a[1] - b[1]);
  const bestMonthKey  = sortedMonths[0]?.[0]  ?? '';
  const worstMonthKey = sortedMonths[sortedMonths.length - 1]?.[0] ?? '';

  function monthLabel(key: string) {
    if (!key) return '—';
    const [, m] = key.split('-');
    return MONTHS[Number(m) - 1] ?? key;
  }

  // Top vehicle
  const vCount: Record<string, number> = {};
  for (const f of yFills) vCount[f.vehicleName] = (vCount[f.vehicleName] ?? 0) + 1;
  const topVehicle = Object.entries(vCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // Estimated miles (only if odometer data exists)
  const withOdo = yFills.filter(f => typeof f.odometerReading === 'number');
  let estMiles: number | null = null;
  if (withOdo.length >= 2) {
    const sorted = [...withOdo].sort((a, b) =>
      (a.odometerReading ?? 0) - (b.odometerReading ?? 0),
    );
    estMiles = (sorted[sorted.length - 1].odometerReading ?? 0) - (sorted[0].odometerReading ?? 0);
  }

  return {
    year, totalFillups, totalGallons: Math.round(totalGallons * 10) / 10,
    totalSpent, avgPrice, bestMonth: monthLabel(bestMonthKey),
    worstMonth: monthLabel(worstMonthKey), topVehicle,
    biggestFill, estMiles,
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center space-y-1 py-6 border-b border-white/10 last:border-0">
      <p className="text-xs font-bold uppercase tracking-widest text-white/40">{label}</p>
      <p className="text-4xl font-black text-white leading-none">{value}</p>
      {sub && <p className="text-sm text-amber-400">{sub}</p>}
    </div>
  );
}

function WrappedContent() {
  const { data: session, status } = useSession();
  const router  = useRouter();
  const [stats,   setStats]   = useState<WrappedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/signin?next=/wrapped');
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups', { credentials: 'include' })
      .then(r => r.json())
      .then((d: FillupResponse) => setStats(computeStats(d.fillups ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  function handleShare() {
    if (!stats) return;
    const text = [
      `⛽ My GasCap™ ${stats.year} Wrapped`,
      ``,
      `🔢 ${stats.totalFillups} fill-ups logged`,
      `🪣 ${stats.totalGallons.toFixed(1)} gallons pumped`,
      `💰 ${fmt(stats.totalSpent)} total spent`,
      `📊 ${fmt(stats.avgPrice)}/gal average price`,
      `🚗 Top vehicle: ${stats.topVehicle}`,
      `😬 Biggest single fill-up: ${fmt(stats.biggestFill)}`,
      `🌿 Best month: ${stats.bestMonth}`,
      `📈 Worst month: ${stats.worstMonth}`,
      stats.estMiles ? `🛣️ ~${stats.estMiles.toLocaleString()} miles driven` : null,
      ``,
      `Track yours free at gascap.app`,
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-navy-700 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-4xl">⛽</p>
          <p className="text-white font-black text-lg">Building your Wrapped…</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-navy-700 flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-5xl">📋</p>
          <p className="text-white font-black text-xl">No data yet</p>
          <p className="text-white/60 text-sm leading-relaxed">
            Log your first fill-up to start building your annual summary.
          </p>
          <Link href="/?tab=log"
            className="inline-block bg-amber-500 hover:bg-amber-400 text-white font-black
                       px-6 py-3 rounded-2xl transition-colors">
            Log a Fill-Up →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-700">
      {/* Header */}
      <div className="px-5 pt-10 pb-6 text-center space-y-1">
        <p className="text-amber-400 text-xs font-black uppercase tracking-widest">
          GasCap™
        </p>
        <h1 className="text-3xl font-black text-white">{stats.year} Wrapped</h1>
        <p className="text-white/50 text-sm">Your year at the pump</p>
      </div>

      {/* Stats */}
      <div className="max-w-sm mx-auto px-5 pb-8 space-y-0 divide-y divide-white/10">
        <Stat label="Fill-Ups Logged"   value={String(stats.totalFillups)}         sub="times you beat the pump" />
        <Stat label="Gallons Pumped"    value={`${stats.totalGallons.toFixed(1)}`} sub="gallons" />
        <Stat label="Total Spent"       value={fmt(stats.totalSpent)}              sub="at the pump" />
        <Stat label="Avg Price / Gal"   value={fmt(stats.avgPrice)}               sub="you paid on average" />
        <Stat label="Best Month"        value={stats.bestMonth}                    sub="cheapest month" />
        <Stat label="Worst Month"       value={stats.worstMonth}                   sub="most expensive month" />
        <Stat label="Top Vehicle"       value={stats.topVehicle}                   sub="most fill-ups" />
        <Stat label="Biggest Fill-Up"   value={fmt(stats.biggestFill)}            sub="ouch 😬" />
        {stats.estMiles !== null && (
          <Stat label="Miles Driven"    value={stats.estMiles.toLocaleString()}   sub="estimated from odometer" />
        )}
      </div>

      {/* Actions */}
      <div className="max-w-sm mx-auto px-5 pb-12 space-y-3">
        <button
          onClick={handleShare}
          className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white
                     font-black text-base transition-colors"
        >
          {copied ? '✓ Copied to clipboard!' : '📤 Share Your Wrapped'}
        </button>
        <Link
          href="/"
          className="block w-full py-3 rounded-2xl border border-white/20 text-white/70
                     hover:text-white hover:border-white/40 font-bold text-sm text-center transition-colors"
        >
          ← Back to Calculator
        </Link>
      </div>
    </div>
  );
}

export default function WrappedPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-navy-700 flex items-center justify-center">
        <p className="text-white font-black text-lg">⛽ Loading…</p>
      </div>
    }>
      <WrappedContent />
    </Suspense>
  );
}
