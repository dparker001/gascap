'use client';

/**
 * Admin: Engagement & conversion baseline (Phase 0.5A). Read-only view of
 * /api/admin/engagement-baseline. Self-contained (fetches its own data) so it
 * adds nothing to admin/page.tsx's state. Definitions and data-quality caveats
 * are shown with the numbers — a baseline you can't interpret isn't one.
 */

import { useEffect, useState, useCallback } from 'react';
import type { BaselineReport } from '@/lib/engagementBaseline';

const fmt = (n: number | null | undefined, suffix = '') => (n === null || n === undefined ? '—' : `${n}${suffix}`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 text-center">
      <p className="text-xl font-black text-navy-700">{value}</p>
      <p className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function EngagementBaselinePanel({ savedPw }: { savedPw: string }) {
  const [r, setR] = useState<BaselineReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!savedPw) return;
    setLoading(true);
    fetch('/api/admin/engagement-baseline', { headers: { 'x-admin-password': savedPw } })
      .then((res) => res.ok ? res.json() : Promise.reject(res.status))
      .then((d: BaselineReport) => { setR(d); setError(''); })
      .catch(() => setError('Failed to load the engagement baseline.'))
      .finally(() => setLoading(false));
  }, [savedPw]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="bg-white rounded-2xl shadow-sm p-5"><div className="h-16 bg-slate-100 rounded-xl animate-pulse" /></div>;
  }
  if (error || !r) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <p className="text-sm font-black text-navy-700">📊 Engagement Baseline</p>
        <p className="text-xs text-red-500 mt-1">{error || 'No data.'}</p>
      </div>
    );
  }

  const p = r.population;
  const fa = r.fuelActions;
  const c = r.conversion;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-navy-700">📊 Engagement Baseline</p>
          <p className="text-[10px] text-slate-400">
            Generated {new Date(r.generatedAt).toLocaleString()} · “today” = {r.todayET} (ET)
          </p>
        </div>
        <button onClick={load} className="text-[11px] font-bold text-navy-700 border border-slate-200 rounded-lg px-2.5 py-1 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {r.truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          A row cap was hit — counts below are lower bounds.
        </p>
      )}

      {/* Population + activity */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Signups" value={String(p.signups)} />
        <Stat label="Trials ever" value={String(p.trialsEver)} sub={`started ${p.trialDefinition.byTrialStarted} · expired ${p.trialDefinition.byTrialExpired} · columns ${p.trialDefinition.byTrialColumns}`} />
        <Stat label="Active trials now" value={String(p.activeTrialNow)} />
        <Stat label="Paid now" value={String(p.paidNow)} />
        <Stat label="DAU today" value={String(r.activity.dauToday)} sub={`yesterday ${r.activity.dauYesterday}`} />
        <Stat label="WAU (7d)" value={String(r.activity.wau7d)} />
        <Stat label="MAU (30d)" value={String(r.activity.mau30d)} />
        <Stat label="Trials currently paid" value={fmt(c.trialsCurrentlyPaid.rate, '%')} sub={`${c.trialsCurrentlyPaid.paidNow} of ${c.trialsCurrentlyPaid.trials} · paid entitlement now, not lifetime conversion`} />
      </div>

      {/* Retention */}
      <div>
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">Retention (matured cohorts only)</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-400">
              <th className="py-1">Day</th><th>Eligible</th><th>Active on day</th><th>Active on/after</th>
            </tr>
          </thead>
          <tbody>
            {r.retention.map((row) => (
              <tr key={row.day} className="border-t border-slate-100">
                <td className="py-1 font-bold text-slate-700">D{row.day}</td>
                <td>{row.eligible}</td>
                <td>{row.exactActive} <span className="text-slate-400">({fmt(row.exactRate, '%')})</span></td>
                <td>{row.onOrAfterActive} <span className="text-slate-400">({fmt(row.onOrAfterRate, '%')})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Funnel */}
      <div>
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">Funnel (all signups)</p>
        <div className="space-y-1">
          {r.funnel.map((s) => (
            <div key={s.step} className="flex items-center gap-2 text-xs">
              <div className="w-44 shrink-0 text-slate-600">{s.step}</div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${s.pctOfSignups ?? 0}%` }} />
              </div>
              <div className="w-24 text-right font-bold text-slate-700">
                {s.users === null ? 'n/a' : `${s.users} (${fmt(s.pctOfSignups, '%')})`}
              </div>
              {s.note && <span className="sr-only">{s.note}</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-1">“Viewed savings” is not tracked — no event exists for it.</p>
      </div>

      {/* Fuel actions */}
      <div>
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">Fuel actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="First fill-up" value={`${fa.usersWithFirstFillup}`} sub={fmt(fa.firstFillupRate, '% of signups')} />
          <Stat label="Second fill-up" value={`${fa.usersWithSecondFillup}`} sub={fmt(fa.secondFillupRate, '% of signups')} />
          <Stat label="Fill-ups / signup" value={fmt(fa.fillupsPerSignup)} sub={`${fmt(fa.fillupsPerActiveFuelUser)} per fuel user`} />
          <Stat label="Median to 1st fill-up" value={fa.medianHoursToFirstFillup === null ? '—' : `${fa.medianHoursToFirstFillup}h`} />
          <Stat label="Saved a station" value={`${fa.usersWithSavedStation}`} sub={fmt(fa.savedStationRate, '%')} />
          <Stat label="Added a vehicle" value={`${fa.usersWithVehicle}`} sub={fmt(fa.vehicleRate, '%')} />
        </div>
      </div>

      {/* Paywall / upgrade */}
      <div>
        <p className="text-xs font-black text-slate-600 uppercase tracking-wide mb-1.5">Paywall & upgrade events</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-slate-400"><th className="py-1">Event</th><th>Users</th><th>Total</th><th>Source</th><th>Since</th></tr>
          </thead>
          <tbody>
            {Object.entries(r.paywall).map(([name, e]) => (
              <tr key={name} className="border-t border-slate-100">
                <td className="py-1 font-mono text-[11px] text-slate-700">{name}</td>
                <td>{e.users}</td><td>{e.total}</td>
                <td className={e.trust === 'client' ? 'text-amber-600' : 'text-emerald-600'}>{e.trust}</td>
                <td className="text-slate-400">{e.firstAt ? e.firstAt.slice(0, 10) : 'no data'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Conversion + cancellation */}
      <div className="grid sm:grid-cols-2 gap-3 text-xs text-slate-600">
        <div className="bg-slate-50 rounded-xl p-3 space-y-1">
          <p className="font-black text-slate-700">Conversion</p>
          <p>Purchase events: <b>{c.purchaseEventUsers}</b> users (since {c.trialToPurchaseEvent.eventsBeganAt?.slice(0, 10) ?? 'no data'})</p>
          <p>Trial → purchase event: <b>{fmt(c.trialToPurchaseEvent.rate, '%')}</b> ({c.trialToPurchaseEvent.users}/{c.trialToPurchaseEvent.trials}) <span className="text-amber-600 font-bold">directional</span></p>
          <p>Trials expired (events): <b>{c.trialExpiredEvents}</b></p>
          <p>Median days signup → first purchase: <b>{fmt(c.medianDaysSignupToFirstPurchase)}</b></p>
          {Object.entries(c.purchasesByProviderBilling).map(([k, n]) => <p key={k} className="text-slate-500">{k}: {n}</p>)}
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1">
            Treat purchase-event conversion as directional, not definitive: RevenueCat purchase events are
            production-only, Stripe purchase events are not test-mode filtered, and test accounts are excluded.
            “Trials currently paid” counts only users who hold a paid entitlement now — someone who converted
            and later cancelled is not counted.
          </p>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 space-y-1">
          <p className="font-black text-slate-700">Cancellation (where recorded)</p>
          <p>RevenueCat — cancellation: <b>{r.cancellation.revenueCat.CANCELLATION}</b> · expiration: <b>{r.cancellation.revenueCat.EXPIRATION}</b> · refund: <b>{r.cancellation.revenueCat.REFUND}</b></p>
          <p>Stripe: <b>not recorded</b></p>
          <p className="text-[10px] text-slate-400">{r.cancellation.note}</p>
        </div>
      </div>

      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer font-bold text-slate-600">Definitions & data quality</summary>
        <ul className="list-disc pl-4 mt-1 space-y-0.5">
          {[...r.definitions, ...r.dataQuality].map((d) => <li key={d}>{d}</li>)}
        </ul>
      </details>
    </div>
  );
}
