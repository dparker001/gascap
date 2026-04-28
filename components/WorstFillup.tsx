'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Fillup } from '@/lib/fillups';

interface FillupResponse {
  fillups: Fillup[];
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WorstFillup() {
  const { data: session } = useSession();
  const [worst, setWorst] = useState<Fillup | null>(null);
  const [best,  setBest]  = useState<Fillup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups', { credentials: 'include' })
      .then(r => r.json())
      .then((data: FillupResponse) => {
        const fills = data.fillups ?? [];
        if (fills.length < 2) return;
        const byTotal = [...fills].sort((a, b) => b.totalCost - a.totalCost);
        const byPrice = [...fills].sort((a, b) => a.pricePerGallon - b.pricePerGallon);
        setWorst(byTotal[0]);
        setBest(byPrice[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  if (!session || loading || !worst || !best) return null;

  return (
    <div className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* Navy header strip */}
      <div className="flex items-center gap-2 py-2.5 px-4 bg-navy-700">
        <span className="text-sm" aria-hidden="true">🏆</span>
        <div>
          <p className="text-xs font-black text-white uppercase tracking-wider">Hall of Fame</p>
          <p className="text-[10px] text-white/50">Your best deal &amp; biggest fill-up</p>
        </div>
      </div>

      <div className="bg-white p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Worst */}
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 space-y-1">
          <p className="text-lg text-center">😬</p>
          <p className="text-[10px] font-black uppercase tracking-wide text-red-500 text-center">
            Worst Day
          </p>
          <p className="text-xl font-black text-red-600 text-center">
            {fmt(worst.totalCost)}
          </p>
          <p className="text-[10px] text-slate-500 text-center leading-tight">
            {worst.gallonsPumped.toFixed(2)} gal @ {fmt(worst.pricePerGallon)}/gal
          </p>
          <p className="text-[10px] text-slate-400 text-center">{fmtDate(worst.date)}</p>
          <p className="text-[10px] text-slate-500 text-center truncate">{worst.vehicleName}</p>
        </div>

        {/* Best */}
        <div className="bg-green-50 border border-green-100 rounded-xl p-3 space-y-1">
          <p className="text-lg text-center">🎉</p>
          <p className="text-[10px] font-black uppercase tracking-wide text-green-600 text-center">
            Best Deal
          </p>
          <p className="text-xl font-black text-green-600 text-center">
            {fmt(best.pricePerGallon)}<span className="text-sm font-semibold">/gal</span>
          </p>
          <p className="text-[10px] text-slate-500 text-center leading-tight">
            {best.gallonsPumped.toFixed(2)} gal — {fmt(best.totalCost)} total
          </p>
          <p className="text-[10px] text-slate-400 text-center">{fmtDate(best.date)}</p>
          <p className="text-[10px] text-slate-500 text-center truncate">{best.vehicleName}</p>
        </div>
      </div>

      <p className="text-[10px] text-slate-300 text-center">
        Based on your logged fill-ups
      </p>
      </div>
    </div>
  );
}
