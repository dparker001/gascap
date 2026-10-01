'use client';

/**
 * $20 Gift Campaign per-card funnel for /admin/campaigns
 * (docs/GIFT20_CAMPAIGN_SPEC.md §6). Read-only view of
 * GET /api/admin/campaigns?gift20=1. Renders nothing until a GIFTxx card
 * has any event, so it stays out of the way for the placard dashboard.
 */
import { useEffect, useState } from 'react';
import type { Gift20FunnelRow } from '@/lib/gift20Funnel';

type Funnel = { rows: Gift20FunnelRow[]; total: Gift20FunnelRow };

const COLS: { label: string; get: (r: Gift20FunnelRow) => number }[] = [
  { label: 'Scans',         get: (r) => r.scans },
  { label: 'Sessions',      get: (r) => r.sessions },
  { label: 'Saw choice',    get: (r) => r.reached.choice },
  { label: 'Saw founder',   get: (r) => r.reached.founder },
  { label: 'Saw Lifetime',  get: (r) => r.reached.lifetime },
  { label: 'Saw getaway',   get: (r) => r.reached.getaway },
  { label: 'App Store',     get: (r) => r.clicks.app_store },
  { label: 'Google Play',   get: (r) => r.clicks.google_play },
  { label: 'Web app',       get: (r) => r.clicks.web_app },
  { label: 'Lifetime click', get: (r) => r.clicks.web_lifetime },
  { label: 'Terms click',   get: (r) => r.clicks.getaway_terms },
  { label: 'Leads',         get: (r) => r.leads },
  { label: 'Web signups',   get: (r) => r.signups },
  { label: 'Lifetime',      get: (r) => r.lifetimeBuyers },
  { label: 'Shares',        get: (r) => r.clicks.share },
];

export default function Gift20FunnelPanel({ pw }: { pw: string }) {
  const [data, setData]   = useState<Funnel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pw) return;
    fetch('/api/admin/campaigns?gift20=1', { headers: { 'x-admin-password': pw } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData(((await r.json()) as { gift20: Funnel }).gift20);
      })
      .catch((e) => setError(`Couldn't load the $20 Gift funnel (${e instanceof Error ? e.message : 'error'}).`));
  }, [pw]);

  if (error) return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!data || data.rows.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <h2 className="text-lg font-semibold">$20 Gift Campaign — per card</h2>
      <p className="mt-1 text-xs text-slate-500">
        Raw counts. n is tiny, so read these as stories, not rates. “Web signups” and “Lifetime” only cover people
        who signed up in the browser that scanned; app-store installs aren&apos;t attributable, so reconcile those against the handout log.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-2 pr-3">Card</th>
              {COLS.map((c) => <th key={c.label} className="py-2 pr-3 whitespace-nowrap">{c.label}</th>)}
              <th className="py-2 pr-3">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {[...data.rows, data.total].map((r) => (
              <tr key={r.code} className={r.code === 'TOTAL' ? 'border-t font-bold' : 'border-t'}>
                <td className="py-2 pr-3 font-mono">{r.code}</td>
                {COLS.map((c) => <td key={c.label} className="py-2 pr-3 tabular-nums">{c.get(r)}</td>)}
                <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-500">
                  {r.lastEventAt ? new Date(r.lastEventAt).toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
