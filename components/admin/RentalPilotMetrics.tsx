'use client';

/**
 * Admin summary card for the Rental Return Assistant pilot (section 26/38
 * of the pilot spec). Self-contained — fetches its own data from
 * /api/admin/rental-pilot so it doesn't add to the already-large state
 * surface of app/admin/page.tsx. Deliberately minimal: no per-user
 * drill-down, no receipt images, just enough to judge whether the pilot is
 * working.
 */

import { useEffect, useState } from 'react';

interface RentalPilotStats {
  totalSessions:              number;
  active:                     number;
  completed:                  number;
  rentalCompanies:            Record<string, number>;
  returnLocationsRepresented: number;
  sessionsWithRefuelLogged:   number;
  averageEstimatedSavings:    number | null;
  fuelFeeReports:             number;
  fuelFeesCharged:            number;
  averageFeeAmount:           number | null;
  averageFeedbackRating:      number | null;
  feedbackCount:              number;
}

export default function RentalPilotMetrics({ savedPw }: { savedPw: string }) {
  const [stats, setStats] = useState<RentalPilotStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!savedPw) return;
    fetch('/api/admin/rental-pilot', { headers: { 'x-admin-password': savedPw } })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => setStats(d))
      .catch(() => setError('Failed to load rental pilot metrics.'))
      .finally(() => setLoading(false));
  }, [savedPw]);

  if (loading) {
    return <div className="bg-white rounded-2xl shadow-sm p-5"><div className="h-16 bg-slate-100 rounded-xl animate-pulse" /></div>;
  }
  if (error || !stats) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <p className="text-sm font-black text-navy-700">🚗 Rental Return Assistant — Pilot</p>
        <p className="text-xs text-red-500 mt-2">{error || 'No data.'}</p>
      </div>
    );
  }

  const topCompanies = Object.entries(stats.rentalCompanies).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
      <p className="text-sm font-black text-navy-700">🚗 Rental Return Assistant — Pilot</p>

      <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
        {[
          { label: 'Sessions',       value: stats.totalSessions, color: 'text-navy-700' },
          { label: 'Active',         value: stats.active,        color: 'text-blue-600' },
          { label: 'Completed',      value: stats.completed,     color: 'text-green-600' },
          { label: 'Return Sites',   value: stats.returnLocationsRepresented, color: 'text-slate-600' },
          { label: 'Refueled',       value: stats.sessionsWithRefuelLogged,   color: 'text-amber-700' },
          { label: 'Fee Reports',    value: stats.fuelFeeReports, color: 'text-slate-600' },
        ].map((s) => (
          <div key={s.label} className="bg-slate-50 rounded-xl p-3 text-center">
            <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
        <div className="bg-emerald-50 rounded-xl p-3">
          <p className="text-lg font-black text-emerald-700">
            {stats.averageEstimatedSavings != null ? `$${stats.averageEstimatedSavings.toFixed(2)}` : '—'}
          </p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Avg. Est. Savings</p>
        </div>
        <div className={`rounded-xl p-3 ${stats.fuelFeesCharged > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
          <p className={`text-lg font-black ${stats.fuelFeesCharged > 0 ? 'text-red-600' : 'text-slate-600'}`}>
            {stats.fuelFeeReports > 0 ? `${stats.fuelFeesCharged}/${stats.fuelFeeReports}` : '—'}
          </p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Charged a Fee</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-3">
          <p className="text-lg font-black text-amber-700">
            {stats.averageFeedbackRating != null ? `★ ${stats.averageFeedbackRating.toFixed(1)}` : '—'}
          </p>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">
            Feedback{stats.feedbackCount > 0 ? ` (${stats.feedbackCount})` : ''}
          </p>
        </div>
      </div>

      {topCompanies.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Rental Companies Represented</p>
          <div className="flex flex-wrap gap-1.5">
            {topCompanies.map(([company, count]) => (
              <span key={company} className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                {company} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.averageFeeAmount != null && (
        <p className="text-[11px] text-slate-500">
          Avg. fee amount when charged: <span className="font-bold text-slate-700">${stats.averageFeeAmount.toFixed(2)}</span>
        </p>
      )}
    </div>
  );
}
