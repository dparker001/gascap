'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Fillup } from '@/lib/fillups';

interface FillupResponse {
  fillups: Fillup[];
}

interface MonthStats {
  fills:       number;
  gallons:     number;
  spent:       number;
  avgPrice:    number;
}

function getMonthStats(fillups: Fillup[], year: number, month: number): MonthStats {
  const filtered = fillups.filter((f) => {
    const d = new Date(f.date + 'T12:00:00');
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const fills   = filtered.length;
  const gallons = filtered.reduce((s, f) => s + f.gallonsPumped, 0);
  const spent   = filtered.reduce((s, f) => s + f.totalCost, 0);
  const avgPrice = gallons > 0
    ? filtered.reduce((s, f) => s + f.pricePerGallon * f.gallonsPumped, 0) / gallons
    : 0;

  return { fills, gallons, spent, avgPrice };
}

function Arrow({ current, prev, higherIsBad }: { current: number; prev: number; higherIsBad: boolean }) {
  if (prev === 0) return null;
  const improved = higherIsBad ? current < prev : current > prev;
  const same     = Math.abs(current - prev) / (prev || 1) < 0.01;
  if (same) return <span className="text-slate-400 text-xs">→</span>;
  return (
    <span className={improved ? 'text-green-500 text-xs' : 'text-red-500 text-xs'}>
      {improved ? '↓' : '↑'}
    </span>
  );
}

export default function MonthlyReportCard() {
  const { data: session } = useSession();
  const [fillups, setFillups] = useState<Fillup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch('/api/fillups', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<FillupResponse> : Promise.reject())
      .then((d) => setFillups(d.fillups))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [session]);

  if (!session) return null;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
        <div className="h-4 w-40 bg-slate-100 rounded animate-pulse" />
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 text-center">
        <p className="text-xs text-slate-400">Could not load report data.</p>
      </div>
    );
  }

  if (!fillups) return null;

  const now    = new Date();
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth();
  const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
  const prevYear  = curMonth === 0 ? curYear - 1 : curYear;

  const cur  = getMonthStats(fillups, curYear, curMonth);
  const prev = getMonthStats(fillups, prevYear, prevMonth);

  // Only render if there's data in current or previous month
  if (cur.fills === 0 && prev.fills === 0) return null;

  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const rows: { label: string; curVal: string; rawCur: number; rawPrev: number; higherIsBad: boolean }[] = [
    {
      label:      'Fill-ups',
      curVal:     String(cur.fills),
      rawCur:     cur.fills,
      rawPrev:    prev.fills,
      higherIsBad: false,
    },
    {
      label:      'Gallons',
      curVal:     cur.gallons.toFixed(1),
      rawCur:     cur.gallons,
      rawPrev:    prev.gallons,
      higherIsBad: false,
    },
    {
      label:      'Total Spent',
      curVal:     cur.spent > 0 ? `$${cur.spent.toFixed(2)}` : '$0.00',
      rawCur:     cur.spent,
      rawPrev:    prev.spent,
      higherIsBad: true,
    },
    {
      label:      'Avg $/gal',
      curVal:     cur.avgPrice > 0 ? `$${cur.avgPrice.toFixed(3)}` : '—',
      rawCur:     cur.avgPrice,
      rawPrev:    prev.avgPrice,
      higherIsBad: true,
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base" aria-hidden="true">📅</span>
        <div>
          <h3 className="text-sm font-black text-slate-700 leading-tight">Monthly Report Card</h3>
          <p className="text-[10px] text-slate-400">{monthName}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {rows.map(({ label, curVal, rawCur, rawPrev, higherIsBad }) => (
          <div key={label} className="bg-slate-50 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <p className="text-base font-black text-slate-700 leading-tight">{curVal}</p>
              {prev.fills > 0 && (
                <Arrow current={rawCur} prev={rawPrev} higherIsBad={higherIsBad} />
              )}
            </div>
            <p className="text-[10px] font-bold text-slate-500 mt-0.5 leading-tight">{label}</p>
            {prev.fills > 0 && (
              <p className="text-[9px] text-slate-400 mt-0.5">
                vs {rawPrev > 0 ? (
                  label === 'Total Spent' || label === 'Avg $/gal'
                    ? `$${rawPrev.toFixed(label === 'Avg $/gal' ? 3 : 2)}`
                    : rawPrev.toFixed(label === 'Gallons' ? 1 : 0)
                ) : '—'} last mo
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
