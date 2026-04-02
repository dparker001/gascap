'use client';

import { useEffect, useState } from 'react';
import type { Fillup } from '@/lib/fillups';

interface HistoryResponse {
  fillups: Fillup[];
  mpgMap:  Record<string, number | null>;
  stats: {
    count:        number;
    totalSpent:   number;
    totalGallons: number;
    avgMpg:       number | null;
  };
}

function fmt(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function FillupExportPage() {
  const [data,    setData]    = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetch('/api/fillups')
      .then((r) => {
        if (!r.ok) throw new Error('Not signed in');
        return r.json() as Promise<HistoryResponse>;
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setLoading(false);
      });
  }, []);

  // Auto-trigger print once data loaded
  useEffect(() => {
    if (data && data.fillups.length > 0) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [data]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-slate-500">Loading fill-up history…</p>
    </div>
  );

  if (error) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p className="text-red-500 font-semibold mb-2">{error}</p>
        <a href="/" className="text-amber-600 hover:underline text-sm">← Back to app</a>
      </div>
    </div>
  );

  const fillups = data?.fillups ?? [];
  const stats   = data?.stats;
  const mpgMap  = data?.mpgMap ?? {};

  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        body { font-family: system-ui, sans-serif; background: white; color: #1e293b; }
      `}</style>

      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Back nav — hidden when printing */}
        <div className="no-print mb-4">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-amber-600 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Back to app
          </a>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-8 pb-4 border-b-2 border-slate-900">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              GasCap™ <span className="text-amber-500">Fill-Up Report</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">Generated {now}</p>
          </div>
          <button
            onClick={() => window.print()}
            className="no-print px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-400"
          >
            🖨️ Print / Save PDF
          </button>
        </div>

        {/* Summary stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Fill-Ups', value: String(stats.count) },
              { label: 'Total Spent',   value: `$${stats.totalSpent.toFixed(2)}` },
              { label: 'Total Gallons', value: `${stats.totalGallons} gal` },
              { label: 'Avg MPG',       value: stats.avgMpg ? `${stats.avgMpg} mpg` : '—' },
            ].map((s) => (
              <div key={s.label} className="border border-slate-200 rounded-lg p-3 text-center">
                <p className="text-xl font-black text-slate-800">{s.value}</p>
                <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Fillup table */}
        {fillups.length === 0 ? (
          <p className="text-center text-slate-400 py-12">No fill-ups logged yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                {['Date', 'Vehicle', 'Gallons', '$/Gal', 'Total', 'Odometer', 'MPG', 'Notes'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fillups.map((f, i) => {
                const mpg = mpgMap[f.id];
                return (
                  <tr key={f.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmt(f.date)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800 max-w-[140px] truncate">{f.vehicleName}</td>
                    <td className="px-3 py-2 text-slate-600">{f.gallonsPumped}</td>
                    <td className="px-3 py-2 text-slate-600">${f.pricePerGallon}</td>
                    <td className="px-3 py-2 font-bold text-amber-700">${f.totalCost.toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {f.odometerReading != null ? f.odometerReading.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 font-semibold text-green-700">{mpg != null ? `${mpg}` : '—'}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs max-w-[120px] truncate">{f.notes ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-amber-50 font-bold">
                <td colSpan={4} className="px-3 py-2.5 text-sm font-black text-slate-700">Totals</td>
                <td className="px-3 py-2.5 text-amber-700">${stats?.totalSpent.toFixed(2)}</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-green-700">{stats?.avgMpg ? `${stats.avgMpg} avg` : '—'}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <p className="text-[10px] text-slate-300 text-center mt-8">
          GasCap™ · Gas Capacity — Know before you go · gascap.app
        </p>
      </div>
    </>
  );
}
