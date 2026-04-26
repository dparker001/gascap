'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AnalyticsSummary, DailyStat, TrafficSource, TopEvent, TopPage } from '@/lib/ga4-data';

const SESSION_KEY = 'gascap_admin_session';
function loadPw(): string {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return '';
    const { pw, ts } = JSON.parse(raw) as { pw: string; ts: number };
    if (Date.now() - ts > 15 * 60 * 1000) return '';
    return pw;
  } catch { return ''; }
}

const PERIOD_OPTIONS = [
  { label: '7 days',  value: 7  },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

export default function AnalyticsPage() {
  const [pw,      setPw]      = useState('');
  const [authed,  setAuthed]  = useState(false);
  const [period,  setPeriod]  = useState(30);
  const [data,    setData]    = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Try session password on mount
  useEffect(() => {
    const saved = loadPw();
    if (saved) { setPw(saved); setAuthed(true); }
  }, []);

  const fetchData = useCallback(async (password: string, days: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/analytics?pw=${encodeURIComponent(password)}&days=${days}`);
      if (res.status === 401) { setAuthed(false); setError('Wrong password.'); return; }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? 'Failed to load analytics.');
        return;
      }
      setData(await res.json());
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed && pw) fetchData(pw, period);
  }, [authed, pw, period, fetchData]);

  // ── Login ──────────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold text-slate-800 mb-6">GasCap™ Admin</h1>
          <input
            type="password" placeholder="Admin password"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setAuthed(true)}
          />
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <button
            className="w-full bg-[#005F4A] text-white rounded-xl py-3 text-sm font-bold"
            onClick={() => setAuthed(true)}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-[#005F4A] text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">GasCap™ Analytics</h1>
          <p className="text-[#1EB68F] text-xs">Google Analytics 4 — live data</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live pulse */}
          <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-[#1EB68F] animate-pulse" />
            <span className="text-xs font-semibold">
              {data ? `${data.activeUsers} live` : '—'}
            </span>
          </div>
          <a href="/admin" className="text-xs text-white/70 hover:text-white">← Admin</a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* Period selector */}
        <div className="flex gap-2">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                period === opt.value
                  ? 'border-[#005F4A] bg-[#005F4A] text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-[#005F4A]'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => fetchData(pw, period)}
            className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold border-2 border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-all"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 animate-pulse h-24" />
            ))}
          </div>
        )}

        {data && !loading && (
          <>
            {/* ── KPI row ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <KpiCard label="Sessions"    value={data.totalSessions.toLocaleString()} color="green" />
              <KpiCard label="Users"       value={data.totalUsers.toLocaleString()}    color="teal"  />
              <KpiCard label="New Users"   value={data.newUsers.toLocaleString()}      color="navy"  />
              <KpiCard label="Calculations" value={data.calcEvents.toLocaleString()}   color="amber" />
              <KpiCard label="Sign-Ups"    value={data.signupEvents.toLocaleString()}  color="orange"/>
            </div>

            {/* ── Daily chart ── */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-bold text-slate-700 mb-4">Daily Sessions & Users — last {data.periodDays} days</h2>
              <DailyChart data={data.daily} />
            </div>

            {/* ── Sources + Events side by side ── */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-4">Traffic Sources</h2>
                <SourcesTable rows={data.sources} total={data.totalSessions} />
              </div>
              <div className="bg-white rounded-2xl shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-4">Top Events</h2>
                <EventsTable rows={data.topEvents} />
              </div>
            </div>

            {/* ── Top pages ── */}
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-bold text-slate-700 mb-4">Top Pages</h2>
              <PagesTable rows={data.topPages} />
            </div>
          </>
        )}

        {/* Empty state — GA4 data still pending */}
        {!loading && !error && data && data.totalSessions === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-amber-800 text-sm">
            <p className="font-semibold mb-1">No data yet — GA4 is warming up</p>
            <p>It can take up to 48 hours after setup for data to appear in standard reports. The Realtime counter above works immediately.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  const accent: Record<string, string> = {
    green:  'bg-[#005F4A]',
    teal:   'bg-[#1EB68F]',
    navy:   'bg-[#1E2D4A]',
    amber:  'bg-amber-500',
    orange: 'bg-[#FA7109]',
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <div className={`w-2 h-2 rounded-full ${accent[color] ?? 'bg-slate-400'} mb-3`} />
      <p className="text-2xl font-black text-slate-800">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function DailyChart({ data }: { data: DailyStat[] }) {
  if (!data.length) return <p className="text-slate-400 text-sm">No data yet.</p>;
  const maxSessions = Math.max(...data.map(d => d.sessions), 1);
  // Show last 14 data points max to keep chart readable
  const slice = data.slice(-14);
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1.5 h-32 min-w-0" style={{ minWidth: `${slice.length * 28}px` }}>
        {slice.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10">
              <div className="bg-slate-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">
                {d.date}: {d.sessions} sessions, {d.users} users
              </div>
            </div>
            <div
              className="w-full rounded-t bg-[#1EB68F] opacity-80 hover:opacity-100 transition-all cursor-default"
              style={{ height: `${Math.max(4, (d.sessions / maxSessions) * 100)}%` }}
            />
            <p className="text-[8px] text-slate-400 rotate-45 origin-left whitespace-nowrap mt-1">
              {d.date}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcesTable({ rows, total }: { rows: TrafficSource[]; total: number }) {
  if (!rows.length) return <p className="text-slate-400 text-sm">No data yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const pct = total ? Math.round((r.sessions / total) * 100) : 0;
        const label = [r.source, r.medium].filter(Boolean).join(' / ') || '(direct)';
        return (
          <div key={i}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-700 font-medium truncate max-w-[60%]">{label}</span>
              <span className="text-slate-500">{r.sessions.toLocaleString()} ({pct}%)</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#1EB68F] rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventsTable({ rows }: { rows: TopEvent[] }) {
  if (!rows.length) return <p className="text-slate-400 text-sm">No data yet.</p>;
  const max = Math.max(...rows.map(r => r.count), 1);
  const HIDE = new Set(['session_start', 'first_visit', 'user_engagement', 'scroll']);
  const filtered = rows.filter(r => !HIDE.has(r.name));
  return (
    <div className="space-y-2">
      {filtered.map((r, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-700 font-medium font-mono">{r.name}</span>
            <span className="text-slate-500">{r.count.toLocaleString()}</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PagesTable({ rows }: { rows: TopPage[] }) {
  if (!rows.length) return <p className="text-slate-400 text-sm">No data yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left text-slate-500 font-semibold py-2 pr-4">Page</th>
            <th className="text-right text-slate-500 font-semibold py-2 pr-4">Views</th>
            <th className="text-right text-slate-500 font-semibold py-2">Avg. Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
              <td className="py-2 pr-4 text-slate-700 font-mono truncate max-w-[240px]">{r.path}</td>
              <td className="py-2 pr-4 text-right text-slate-600">{r.views.toLocaleString()}</td>
              <td className="py-2 text-right text-slate-600">
                {r.avgSecs >= 60
                  ? `${Math.floor(r.avgSecs / 60)}m ${r.avgSecs % 60}s`
                  : `${r.avgSecs}s`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
