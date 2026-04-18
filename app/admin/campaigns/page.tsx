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
  scansEn:        number;
  scansEs:        number;
  signupsEn:      number;
  signupsEs:      number;
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
  featured?:       boolean;  // shown in-app as a Partner Station near the user
  qrUrl:           string;   // English QR target
  qrUrlEs:         string;   // Spanish QR target (/q/<code>?lang=es)
  stats?:          PlacementStats;
}

// ── Milestone tier helper (mirrors lib/campaigns.ts) ─────────────────────

interface MilestoneTier {
  tier:   'none' | 'partner' | 'gold' | 'premium';
  label:  string;
  emoji:  string;
  nextAt: number | null;
}

function getMilestoneTier(signups: number): MilestoneTier {
  if (signups >= 250) return { tier: 'premium', label: 'Premium Partner', emoji: '🏆', nextAt: null  };
  if (signups >= 100) return { tier: 'gold',    label: 'Gold Partner',    emoji: '⭐', nextAt: 250   };
  if (signups >= 25)  return { tier: 'partner', label: 'Partner',         emoji: '🤝', nextAt: 100   };
  return               { tier: 'none',    label: 'Candidate',        emoji: '📋', nextAt: 25    };
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
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editDraft,  setEditDraft]  = useState<Partial<Placement>>({});

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

  const handleEditOpen = (p: Placement) => {
    setShowCreate(false);
    setEditingId(p.id);
    setEditDraft({
      station:         p.station,
      address:         p.address         ?? '',
      city:            p.city            ?? '',
      contactName:     p.contactName     ?? '',
      contactEmail:    p.contactEmail    ?? '',
      contactPhone:    p.contactPhone    ?? '',
      placement:       p.placement,
      headlineVariant: p.headlineVariant,
      notes:           p.notes           ?? '',
      active:          p.active,
    });
  };

  const handleEditSave = async () => {
    if (!editingId) return;
    // Strip empty strings so we don't overwrite real values with ''
    const patch: Record<string, unknown> = {};
    (Object.keys(editDraft) as (keyof typeof editDraft)[]).forEach((k) => {
      const v = editDraft[k];
      if (v !== undefined) patch[k] = v === '' ? null : v;
    });
    const res = await fetch(`/api/admin/campaigns?id=${editingId}`, {
      method:  'PATCH',
      headers,
      body:    JSON.stringify(patch),
    });
    if (res.ok) {
      setMsg('Saved changes.');
      setEditingId(null);
      setEditDraft({});
      setTimeout(() => setMsg(''), 3000);
      void fetchAll(pw);
    } else {
      const data = await res.json();
      setMsg(data.error ?? 'Failed to save.');
    }
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

  const handleToggleFeatured = async (id: string, current: boolean) => {
    const res = await fetch(`/api/admin/campaigns?id=${id}`, {
      method:  'PATCH',
      headers,
      body:    JSON.stringify({ featured: !current }),
    });
    if (res.ok) {
      const next = !current;
      setMsg(next ? '⭐ Station is now featured in-app' : 'Station removed from featured');
      setTimeout(() => setMsg(''), 3000);
      void fetchAll(pw);
    } else {
      setMsg('Failed to update featured status');
    }
  };

  const copyQr = (url: string) => {
    navigator.clipboard.writeText(url);
    setMsg(`Copied ${url}`);
    setTimeout(() => setMsg(''), 2500);
  };

  const handleResetEvents = async () => {
    if (!confirm(
      'Reset ALL campaign events?\n\n' +
      'This wipes every scan, page view, calc, and signup event from the log. ' +
      'Placements and their QR URLs are preserved. Use this to clear test/' +
      'smoke-test data before the real pilot launches.\n\n' +
      'This cannot be undone.',
    )) return;

    const res = await fetch('/api/admin/campaigns?clear=events', { method: 'DELETE', headers });
    const data = await res.json();
    if (res.ok) {
      setMsg(`Cleared ${data.removed} events`);
      void fetchAll(pw);
    } else {
      setMsg(data.error ?? 'Failed to reset events');
    }
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
              onClick={() => { setShowCreate(!showCreate); setEditingId(null); setEditDraft({}); }}
              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              + New placement
            </button>
            <button
              onClick={handleResetEvents}
              className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 bg-white hover:bg-red-50"
              title="Wipe all scan/view/calc/signup events. Placements are preserved."
            >
              Reset events
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

        {/* Edit placement panel */}
        {editingId && (
          <div className="bg-white rounded-2xl shadow p-5 border-l-4 border-emerald-500">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                Edit placement —{' '}
                <span className="font-mono text-sm text-slate-500">
                  {placements.find((p) => p.id === editingId)?.code}
                </span>
              </h2>
              <button
                onClick={() => { setEditingId(null); setEditDraft({}); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                placeholder="Station name *"
                required
                value={editDraft.station ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, station: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              />
              <input
                placeholder="City (e.g. Orlando)"
                value={editDraft.city ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, city: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              />
              <input
                placeholder="Address"
                value={editDraft.address ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, address: e.target.value }))}
                className="border rounded-lg px-3 py-2 md:col-span-2"
              />
              <input
                placeholder="Owner / contact name"
                value={editDraft.contactName ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, contactName: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              />
              <input
                placeholder="Owner email"
                value={editDraft.contactEmail ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, contactEmail: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              />
              <input
                placeholder="Owner phone"
                value={editDraft.contactPhone ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, contactPhone: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              />
              <select
                value={editDraft.placement ?? 'counter'}
                onChange={(e) => setEditDraft((d) => ({ ...d, placement: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              >
                {PLACEMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select
                value={editDraft.headlineVariant ?? 'A-KnowBefore'}
                onChange={(e) => setEditDraft((d) => ({ ...d, headlineVariant: e.target.value }))}
                className="border rounded-lg px-3 py-2"
              >
                {HEADLINES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
              <textarea
                placeholder="Notes"
                value={editDraft.notes ?? ''}
                onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                className="border rounded-lg px-3 py-2 md:col-span-2"
                rows={2}
              />
              {/* Active toggle */}
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editDraft.active ?? true}
                  onChange={(e) => setEditDraft((d) => ({ ...d, active: e.target.checked }))}
                  className="w-4 h-4 rounded accent-emerald-600"
                />
                Placement active
              </label>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => void handleEditSave()}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
              >
                Save changes
              </button>
              <button
                onClick={() => { setEditingId(null); setEditDraft({}); }}
                className="px-4 py-2 rounded-lg border text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
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
                  <th className="px-3 py-2">Partner Tier</th>
                  <th className="px-3 py-2 text-center" title="Show this station as a featured partner in the app for nearby users">Featured</th>
                  <th className="px-3 py-2">Placement</th>
                  <th className="px-3 py-2">Headline</th>
                  <th className="px-3 py-2 text-right">Scans</th>
                  <th className="px-3 py-2 text-right" title="Scan split — English vs Spanish QR">EN / ES</th>
                  <th className="px-3 py-2 text-right">Views</th>
                  <th className="px-3 py-2 text-right">Calcs</th>
                  <th className="px-3 py-2 text-right">Signups</th>
                  <th className="px-3 py-2 text-right">Visit→Signup</th>
                  <th className="px-3 py-2">Last event</th>
                  <th className="px-3 py-2">QR (EN)</th>
                  <th className="px-3 py-2">QR (ES)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {placements.length === 0 && (
                  <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-400">
                    No placements yet. Click <strong>+ New placement</strong> to create your first one.
                  </td></tr>
                )}
                {placements.map((p) => {
                  const s = p.stats;
                  const signups = s?.signups ?? 0;
                  const tier = getMilestoneTier(signups);
                  // Progress toward next milestone (0-100)
                  const prevAt = tier.tier === 'none' ? 0 : tier.tier === 'partner' ? 25 : tier.tier === 'gold' ? 100 : 250;
                  const progressPct = tier.nextAt
                    ? Math.min(100, Math.round(((signups - prevAt) / (tier.nextAt - prevAt)) * 100))
                    : 100;
                  return (
                    <tr key={p.id} className="border-t hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs">{p.code}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.station}</div>
                        {p.city && <div className="text-xs text-slate-500">{p.city}</div>}
                      </td>

                      {/* Partner Tier */}
                      <td className="px-3 py-2 min-w-[130px]">
                        <div className="flex items-center gap-1">
                          <span className="text-base leading-none">{tier.emoji}</span>
                          <span className={`text-xs font-semibold ${
                            tier.tier === 'premium' ? 'text-amber-600' :
                            tier.tier === 'gold'    ? 'text-yellow-600' :
                            tier.tier === 'partner' ? 'text-emerald-700' :
                            'text-slate-500'
                          }`}>{tier.label}</span>
                        </div>
                        <div className="mt-1 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full ${
                              tier.tier === 'premium' ? 'bg-amber-500' :
                              tier.tier === 'gold'    ? 'bg-yellow-400' :
                              tier.tier === 'partner' ? 'bg-emerald-500' :
                              'bg-slate-300'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        {tier.nextAt && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {signups}/{tier.nextAt} signups
                          </div>
                        )}
                      </td>

                      {/* Featured toggle */}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => handleToggleFeatured(p.id, p.featured ?? false)}
                          title={p.featured ? 'Remove from in-app featured banner' : 'Show in app as a featured partner station'}
                          className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            p.featured
                              ? 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
                              : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {p.featured ? '⭐ Featured' : '☆ Feature'}
                        </button>
                      </td>

                      <td className="px-3 py-2">{p.placement}</td>
                      <td className="px-3 py-2 text-xs">{p.headlineVariant}</td>
                      <td className="px-3 py-2 text-right">{fmt(s?.scans ?? 0)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">
                        {s && s.scans > 0
                          ? <>{fmt(s.scansEn)} <span className="text-slate-300">/</span> {fmt(s.scansEs)}</>
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(s?.pageViews ?? 0)}</td>
                      <td className="px-3 py-2 text-right">{fmt(s?.calcStarts ?? 0)}</td>
                      <td className="px-3 py-2 text-right">
                        {fmt(s?.signups ?? 0)}
                        {s && s.signups > 0 && (
                          <div className="text-[10px] text-slate-400 tabular-nums">
                            {fmt(s.signupsEn)} EN · {fmt(s.signupsEs)} ES
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{s ? pct(s.visitToSignup) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{date(s?.lastEventAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
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
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => copyQr(p.qrUrlEs)}
                          className="text-xs underline text-amber-700 hover:text-amber-900"
                          title={p.qrUrlEs}
                        >
                          copy URL
                        </button>
                        {' · '}
                        <a
                          href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(p.qrUrlEs)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline text-amber-700 hover:text-amber-900"
                        >
                          PNG
                        </a>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => handleEditOpen(p)}
                          className={`text-xs font-medium hover:text-emerald-800 mr-2 ${
                            editingId === p.id ? 'text-emerald-700 underline' : 'text-emerald-600'
                          }`}
                        >
                          {editingId === p.id ? 'editing…' : 'edit'}
                        </button>
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
          QR redirect: <code>/q/&lt;code&gt;</code> (English) · <code>/q/&lt;code&gt;?lang=es</code> (Spanish)
          · Tracking: <code>/api/campaign/track</code> · Lead capture: <code>/api/campaign/lead</code>
        </p>
        <p className="text-[11px] text-slate-400 text-center pt-1">
          Print both QR codes side-by-side on each placard so scanners land in their own language without tapping a toggle.
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
