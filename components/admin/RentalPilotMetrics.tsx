'use client';

/**
 * Admin dashboard for the Rental Return Assistant pilot — aggregate metrics
 * plus a session drill-down list (most valuable for actually reviewing a
 * fuel-fee dispute) with a filter for disputes only. Self-contained —
 * fetches its own data so it doesn't add to admin/page.tsx's already-large
 * state surface.
 */

import { useEffect, useState, useCallback } from 'react';
import RentalSessionDetail from './RentalSessionDetail';

interface SessionRow {
  id: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  rentalCompany: string;
  vehicle: string;
  returnLocation: string | null;
  fuelFeeCharged: boolean | null;
  fuelFeeAmount: number | null;
  feedbackRating: number | null;
  createdAt: string;
  completedAt: string | null;
  hasPhotos: boolean;
}

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
  sessions:                   SessionRow[];
}

export default function RentalPilotMetrics({ savedPw }: { savedPw: string }) {
  const [stats, setStats] = useState<RentalPilotStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disputesOnly, setDisputesOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!savedPw) return;
    fetch('/api/admin/rental-pilot', { headers: { 'x-admin-password': savedPw } })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => setStats(d))
      .catch(() => setError('Failed to load rental pilot metrics.'))
      .finally(() => setLoading(false));
  }, [savedPw]);

  useEffect(() => { load(); }, [load]);

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
  const visibleSessions = disputesOnly ? stats.sessions.filter((s) => s.fuelFeeCharged === true) : stats.sessions;

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

      {/* Session drill-down */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
            Sessions {disputesOnly ? '(disputes only)' : `(${stats.sessions.length})`}
          </p>
          <button
            onClick={() => setDisputesOnly((v) => !v)}
            className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
              disputesOnly ? 'bg-red-500 text-white border-red-500' : 'bg-white text-slate-500 border-slate-200'
            }`}
          >
            {disputesOnly ? '⚠️ Disputes only' : 'Show disputes only'}
          </button>
        </div>

        {visibleSessions.length === 0 ? (
          <p className="text-xs text-slate-400 py-3 text-center">
            {disputesOnly ? 'No fuel-fee disputes reported.' : 'No rental sessions yet.'}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {visibleSessions.map((s) => (
              <div key={s.id} className="border border-slate-100 rounded-xl">
                <button
                  onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 truncate">
                      {s.rentalCompany} · {s.vehicle || '—'}
                      {s.fuelFeeCharged && <span className="ml-1.5 text-red-500">⚠️</span>}
                      {s.hasPhotos && <span className="ml-1 text-slate-400">📷</span>}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{s.userEmail} · {new Date(s.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    s.status === 'active' ? 'bg-blue-100 text-blue-700' : s.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {s.status}
                  </span>
                </button>
                {expandedId === s.id && (
                  <div className="px-3 pb-3">
                    <RentalSessionDetail sessionId={s.id} savedPw={savedPw} onChanged={load} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
