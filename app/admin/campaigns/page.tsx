'use client';

/**
 * Admin → Campaigns dashboard
 *
 * Tracks the "Know Before You Fill Up" QR pilot:
 *   - Per-placement scan/funnel/conversion stats
 *   - Grouped views (by station, placement, headline variant, city)
 *   - Daily time-series for the last 30 days
 *   - Create / delete placements (each gets a unique QR URL)
 *
 * Auth: same admin password as /admin (stored in sessionStorage for 15min).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

// ── Types mirrored from lib/campaigns.ts ─────────────────────────────────

interface PlacementStats {
  code:           string;
  scans:          number;
  uniqueScans:    number;
  pageViews:      number;
  calcStarts:     number;
  calcCompletes:  number;
  saveToPhone:    number;
  leadCaptures:   number;
  signups:        number;
  returnVisits:   number;
  scanToVisit:    number;
  visitToCalc:    number;
  calcToComplete: number;
  visitToSignup:  number;
  lastEventAt?:   string;
}

interface Placement {
  id:              string;
  code:            string;
  campaign:        string;
  station:         string;
  address?:        string;
  city?:           string;
  contactName?:    string;
  contactEmail?:   string;
  contactPhone?:   string;
  placement:       string;
  headlineVariant: string;
  landingPath:     string;
  notes?:          string;
  createdAt:       string;
  active:          boolean;
  qrUrl:           string;
  stats?:          PlacementStats;
}

interface Overview {
  totalPlacements:  number;
  activePlacements: number;
  totals:           PlacementStats;
  topPlacements:    { code: string; station: string; scans: number; signups: number }[];
}

interface GroupedStats {
  key:            string;
  label:          string;
  stats:          PlacementStats;
  placementCount: number;
}

interface DailyBucket {
  date: string;
  scans: number;
  pageViews: number;
  signups: number;
}

// ── Session storage helpers (match /admin pattern) ───────────────────────

const SESSION_KEY = 'gascap_admin_session';
const SESSION_TTL = 15 * 60 * 1000;

function loadPw(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { pw, ts } = JSON.parse(raw) as { pw: string; ts: number };
    if (Date.now() - ts > SESSION_TTL) return null;
    return pw;
  } catch { return null; }
}

function savePw(pw: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ pw, ts: Date.now() }));
}

// ── Format helpers ───────────────────────────────────────────────────────

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString();
const date = (s?: string) => (s ? new Date(s).toLocaleString() : '—');

// ── Page ─────────────────────────────────────────────────────────────────

const HEADLINES = [
  { value: 'A-KnowBefore',   label: 'A · Know Before You Fill Up™' },
  { value: 'B-DontGuess',    label: 'B · Don\u2019t Guess at the Pump' },
  { value: 'C-StretchBudget',label: 'C · Stretch Your Fuel Budget Smarter' },
];

const PLACEMENT_TYPES = ['counter', 'window', 'register', 'pump', 'flyer'];

export default function CampaignsAdminPage() {
  const [pw, setPw]               = useState('');
  const [authed, setAuthed]       = useState(false);
  const [authErr, setAuthErr]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [overview, setOverview]   = useState<Overview | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [grouped, setGrouped]     = useState<Record<string, GroupedStats[]>>({});
  const [daily, setDaily]         = useState<DailyBucket[]>([]);
  const [msg, setMsg]             = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const headers = useMemo(() => ({ 'x-admin-password': pw, 'Content-Type': 'application/json' }), [pw]);

  const fetchAll = useCallback(async (currentPw: string) => {
    setLoading(true);
    setMsg('');
    try {
      const h = { 'x-admin-password': currentPw };
      const [main, gStation, gPlacement, gHeadline, gCity, time] = await Promise.all([
        fetch('/api/admin/campaigns', { headers: h }),
        fetch('/api/admin/campaigns?group=station', { headers: h }),
        fetch('/api/admin/campaigns?group=placement', { headers: h }),
        fetch('/api/admin/campaigns?group=headlineVariant', { headers: h }),
        fetch('/api/admin/campaigns?group=city', { headers: h }),
        fetch('/api/admin/campaigns?days=30', { headers: h }),
      ]);

      if (main.status === 401) {
        setAuthed(false);
        setAuthErr('Wrong password.');
        return;
      }
      if (!main.ok) {
        setMsg('Failed to load campaign data.');
        return;
      }

      const mainData = await main.json() as { overview: Overview; placements: Placement[] };
      setOverview(mainData.overview);
      setPlacements(mainData.placements);

      const groupedData: Record<string, GroupedStats[]> = {};
      groupedData.station         = (await gStation.json()).grouped         ?? [];
      groupedData.placement       = (await gPlacement.json()).grouped       ?? [];
      groupedData.headlineVariant = (await gHeadline.json()).grouped        ?? [];
      groupedData.city            = (await gCity.json()).grouped            ?? [];
      setGrouped(groupedData);

      const timeData = await time.json() as { daily: DailyBucket[] };
      setDaily(timeData.daily);
    } catch (err) {
      console.error(err);
      setMsg('Failed to load campaign data.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-auth if session valid
  useEffect(() => {
    const saved = loadPw();
    if (saved) {
      setPw(saved);
      setAuthed(true);
      void fetchAll(saved);
    }
  }, [fetchAll]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr('');
    const res = await fetch('/api/admin/campaigns', { headers: { 'x-admin-password': pw } });
    if (res.ok) {
      savePw(pw);
      setAuthed(true);
      void fetchAll(pw);
    } else {
      setAuthErr('Wrong password.');
    }
  };

  const handleCreate = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const body: Record<string, string> = {};
    fd.forEach((v, k) => { if (typeof v === 'string' && v.trim()) body[k] = v.trim(); });

    const res = await fetch('/api/admin/campaigns', {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error ?? 'Failed to create placement');
      return;
    }
    setMsg(`Created ${data.placement.code} → ${data.qrUrl}`);
    setShowCreate(false);
    form.reset();
    void fetchAll(pw);
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Delete placement ${code}? Events stay in the log but won't be grouped.`)) return;
    const res = await fetch(`/api/admin/campaigns?id=${id}`, { method: 'DELETE', headers });
    if (res.ok) {
      setMsg(`Deleted ${code}`);
      void fetchAll(pw);
    } else {
      setMsg('Failed to delete');
    }
  };

  const copyQr = (url: string) => {
    navigator.clipboard.writeText(url);
    setMsg(`Copied ${url}`);
    setTimeout(() => setMsg(''), 2500);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow p-6 w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Campaign Analytics</h1>
          <p className="text-sm text-slate-500">Enter the admin password to continue.</p>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Admin password"
            autoFocus
          />
          {authErr && <p className="text-sm text-red-600">{authErr}</p>}
          <button className="w-full bg-emerald-600 text-white rounded-lg py-2 font-medium hover:bg-emerald-700">
            Sign in
          </button>
        </form>
      </div>
    );
  }

  const totals = overview?.totals;
  const maxDaily = Math.max(1, ...daily.map((d) => Math.max(d.scans, d.pageViews, d.signups)));

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Campaign Analytics</h1>
            <p className="text-sm text-slate-500">
              Know Before You Fill Up&trade; — QR placard pilot
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fetchAll(pw)}
              disabled={loading}
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? 'Refreshing\u2026' : 'Refresh'}
            </button>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              + New placement
            </button>
            <a href="/admin" className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50">
              ← Admin home
            </a>
          </div>
        </header>

        {msg && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-3 py-2">
            {msg}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="text-lg font-semibold mb-3">New placement</h2>
            <form
              onSubmit={(e) => { e.preventDefault(); void handleCreate(e.currentTarget); }}
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              <input name="station" placeholder="Station name *" required className="border rounded-lg px-3 py-2" />
              <input name="city" placeholder="City (e.g. Orlando)" className="border rounded-lg px-3 py-2" />
              <input name="address" placeholder="Address" className="border rounded-lg px-3 py-2 md:col-span-2" />
              <input name="contactName" placeholder="Owner / contact name" className="border rounded-lg px-3 py-2" />
              <input name="contactEmail" placeholder="Owner email" className="border rounded-lg px-3 py-2" />
              <input name="contactPhone" placeholder="Owner phone" className="border rounded-lg px-3 py-2" />
              <select name="placement" defaultValue="counter" className="border rounded-lg px-3 py-2">
                {PLACEMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select name="headlineVariant" defaultValue="A-KnowBefore" className="border rounded-lg px-3 py-2 md:col-span-2">
                {HEADLINES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
              <textarea name="notes" placeholder="Notes" className="border rounded-lg px-3 py-2 md:col-span-2" rows={2} />
              <div className="md:col-span-2 flex gap-2">
                <button className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Create</button>
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Overview cards */}
        {totals && overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard label="Placements" value={`${overview.activePlacements}/${overview.totalPlacements}`} sub="active / total" />
            <StatCard label="Scans"      value={fmt(totals.scans)}        sub={`${fmt(totals.uniqueScans)} unique`} />
            <StatCard label="Page views" value={fmt(totals.pageViews)}    sub={pct(totals.scanToVisit) + ' of scans'} />
            <StatCard label="Calc starts" value={fmt(totals.calcStarts)}  sub={pct(totals.visitToCalc) + ' of visits'} />
            <StatCard label="Signups"    value={fmt(totals.signups)}      sub={pct(totals.visitToSignup) + ' of visits'} />
            <StatCard label="Saved to phone" value={fmt(totals.saveToPhone)} sub={fmt(totals.leadCaptures) + ' leads'} />
          </div>
        )}

        {/* Time-series */}
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Last 30 days</h2>
            <div className="flex gap-3 text-xs text-slate-500">
              <span><span className="inline-block w-3 h-3 bg-emerald-500 rounded-sm mr-1" />scans</span>
              <span><span className="inline-block w-3 h-3 bg-sky-500 rounded-sm mr-1" />views</span>
              <span><span className="inline-block w-3 h-3 bg-amber-500 rounded-sm mr-1" />signups</span>
            </div>
          </div>
          <div className="flex items-end gap-1 h-32">
            {daily.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col-reverse gap-px" title={`${d.date}\nscans: ${d.scans}\nviews: ${d.pageViews}\nsignups: ${d.signups}`}>
                <div className="bg-emerald-500" style={{ height: `${(d.scans     / maxDaily) * 100}%` }} />
                <div className="bg-sky-500"     style={{ height: `${(d.pageViews / maxDaily) * 100}%` }} />
                <div className="bg-amber-500"   style={{ height: `${(d.signups   / maxDaily) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{daily[0]?.date}</span>
            <span>{daily[daily.length - 1]?.date}</span>
          </div>
        </div>

        {/* Grouped views */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GroupTable title="By station"        rows={grouped.station ?? []} />
          <GroupTable title="By placement type" rows={grouped.placement ?? []} />
          <GroupTable title="By headline variant" rows={grouped.headlineVariant ?? []} />
          <GroupTable title="By city"           rows={grouped.city ?? []} />
        </div>

        {/* Placements table */}
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          <div className="px-5 py-3 border-b">
            <h2 className="text-lg font-semibold">Placements ({placements.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Station</th>
                  <th className="px-3 py-2">Placement</th>
                  <th className="px-3 py-2">Headline</th>
                  <th className="px-3 py-2 text-right">Scans</th>
                  <th className="px-3 py-2 text-right">Views</th>
                  <th className="px-3 py-2 text-right">Calcs</th>
                  <th className="px-3 py-2 text-right">Signups</th>
                  <th className="px-3 py-2 text-right">Visit→Signup</th>
                  <th className="px-3 py-2">Last event</th>
                  <th className="px-3 py-2">QR</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {placements.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-slate-400">
                    No placements yet. Click <strong>+ New placement</strong> to create your first one.
                  </td></tr>
                )}
                {placements.map((p) => {
                  const s = p.stats;
                  return (
                    <tr key={p.id} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.station}</div>
                        {p.city && <div className="text-xs text-slate-500">{p.city}</div>}
                      </td>
                      <td className="px-3 py-2">{p.placement}</td>
                      <td className="px-3 py-2 text-xs">{p.headlineVariant}</td>
                      <td className="px-3 py-2 text-right">{fmt(s?.scans ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s?.pageViews ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s?.calcStarts ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s?.signups ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{s ? pct(s.visitToSignup) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{date(s?.lastEventAt)}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => copyQr(p.qrUrl)}
                          className="text-xs underline text-emerald-700 hover:text-emerald-900"
                          title={p.qrUrl}
                        >
                          copy URL
                        </button>
                        {' · '}
                        <a
                          href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(p.qrUrl)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline text-emerald-700 hover:text-emerald-900"
                        >
                          PNG
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleDelete(p.id, p.code)}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-slate-400 text-center pt-4">
          QR redirect: <code>/q/&lt;code&gt;</code> · Tracking: <code>/api/campaign/track</code> · Lead capture: <code>/api/campaign/lead</code>
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl shadow px-4 py-3">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupedStats[] }) {
  return (
    <div className="bg-white rounded-2xl shadow overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-left">
          <tr>
            <th className="px-3 py-2">Group</th>
            <th className="px-3 py-2 text-right">Placards</th>
            <th className="px-3 py-2 text-right">Scans</th>
            <th className="px-3 py-2 text-right">Signups</th>
            <th className="px-3 py-2 text-right">Conv.</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400 text-xs">No data yet</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-3 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right">{r.placementCount}</td>
              <td className="px-3 py-2 text-right">{fmt(r.stats.scans)}</td>
              <td className="px-3 py-2 text-right">{fmt(r.stats.signups)}</td>
              <td className="px-3 py-2 text-right">{pct(r.stats.visitToSignup)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
