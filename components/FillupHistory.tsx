'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Fillup } from '@/lib/fillups';
import UpgradeNudge from './UpgradeNudge';

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

interface NationalAvgResponse {
  price: number | null;
}

interface FillupHistoryProps {
  refreshKey?: number;  // increment to force a reload
}

type EditFuelGrade = 'regular' | 'midgrade' | 'premium' | 'diesel' | 'e85' | '';

interface EditDraft {
  date:            string;
  gallonsPumped:   string;
  pricePerGallon:  string;
  odometerReading: string;
  stationName:     string;
  notes:           string;
  fuelGrade:       EditFuelGrade;
  receiptThumb:    string;   // base64 data URL or ''
  driverLabel:     string;   // Fleet Phase 1 — empty string = unassigned
}

const EDIT_FUEL_GRADES: { value: EditFuelGrade; label: string; sub: string }[] = [
  { value: 'regular',  label: 'Regular',  sub: '87'     },
  { value: 'midgrade', label: 'Mid-Grade', sub: '89'     },
  { value: 'premium',  label: 'Premium',   sub: '91–93'  },
  { value: 'diesel',   label: 'Diesel',    sub: 'diesel' },
];

/** Compress an image File to a small JPEG thumbnail (max 320px, 0.55q) */
async function compressEditImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 320;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = reject;
    img.src = url;
  });
}

type FilterMode = 'all' | 'this-month' | 'last-3' | 'this-year' | 'custom';

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`;
}

interface MonthGroup {
  month:   string;
  label:   string;
  fillups: Fillup[];
}

function groupByMonth(fillups: Fillup[]): MonthGroup[] {
  const groups = new Map<string, Fillup[]>();
  for (const f of fillups) {
    const m = f.date.slice(0, 7);
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(f);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, mf]) => ({
      month,
      label:   fmtMonth(month),
      fillups: [...mf].sort((a, b) => b.date.localeCompare(a.date)),
    }));
}

function applyFilter(
  groups: MonthGroup[],
  mode: FilterMode,
  customMonth: string,
): MonthGroup[] {
  const now      = currentMonthStr();
  const thisYear = now.slice(0, 4);
  switch (mode) {
    case 'this-month': return groups.filter(g => g.month === now);
    case 'last-3': {
      const d = new Date();
      d.setMonth(d.getMonth() - 2);
      const cutoff = d.toISOString().slice(0, 7);
      return groups.filter(g => g.month >= cutoff);
    }
    case 'this-year': return groups.filter(g => g.month.startsWith(thisYear));
    case 'custom':    return groups.filter(g => g.month === customMonth);
    default:          return groups; // 'all'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FillupHistory({ refreshKey }: FillupHistoryProps) {
  const { data: session, status } = useSession();
  const [data,        setData]       = useState<HistoryResponse | null>(null);
  const [nationalAvg, setNationalAvg] = useState<number | null>(null);
  const [loading,    setLoading]   = useState(false);
  const [open,       setOpen]      = useState(false);
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [editDraft,       setEditDraft]       = useState<EditDraft | null>(null);
  const [editSaving,      setEditSaving]      = useState(false);
  const [editError,       setEditError]       = useState('');
  const [editImgLoading,  setEditImgLoading]  = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [drivers,         setDrivers]         = useState<string[]>([]);
  const editCameraRef  = useRef<HTMLInputElement>(null);
  const editGalleryRef = useRef<HTMLInputElement>(null);

  // ── Filter + month expansion state ─────────────────────────────────────────
  const [filterMode,     setFilterMode]     = useState<FilterMode>('all');
  const [customMonth,    setCustomMonth]    = useState(currentMonthStr);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set([currentMonthStr()]),
  );

  // ── Derived stats ──────────────────────────────────────────────────────────

  function calcAnnualProjection(
    fillups: Fillup[],
    totalSpent: number,
  ): number | null {
    if (fillups.length < 3) return null;
    const dates   = fillups.map((f) => new Date(f.date + 'T12:00:00').getTime());
    const oldest  = Math.min(...dates);
    const newest  = Math.max(...dates);
    const daySpan = (newest - oldest) / 86_400_000;
    if (daySpan < 7) return null;
    return (totalSpent / daySpan) * 365;
  }

  // Cost per mile, computed the same tank-to-tank way as MPG (see computeMpg):
  // group by vehicle, walk consecutive odometer readings, and attribute each
  // fill-up's cost to the miles it covered (the fuel added at fill-up N is what
  // propelled the miles driven since fill-up N-1). The old version divided the
  // cost of ALL fill-ups (including those with no odometer) by the miles spanned
  // by only the odometer fill-ups, and ignored vehicle grouping — so it was
  // inflated, and nonsensical for anyone with more than one vehicle.
  function calcCostPerMile(fillups: Fillup[]): number | null {
    const byVehicle: Record<string, Fillup[]> = {};
    for (const f of fillups) {
      const key = f.vehicleId ?? f.vehicleName;
      (byVehicle[key] ??= []).push(f);
    }

    let totalMiles = 0;
    let totalCost  = 0;
    for (const group of Object.values(byVehicle)) {
      const sorted = [...group]
        .filter((f) => f.odometerReading != null)
        .sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < sorted.length; i++) {
        const miles = sorted[i].odometerReading! - sorted[i - 1].odometerReading!;
        if (miles > 0) {
          totalMiles += miles;
          totalCost  += sorted[i].totalCost;
        }
      }
    }

    if (totalMiles < 1) return null;
    return totalCost / totalMiles;
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fillupRes, avgRes] = await Promise.all([
        fetch('/api/fillups'),
        fetch('/api/gas-price/national').catch(() => null),
      ]);
      if (fillupRes.ok) setData(await fillupRes.json() as HistoryResponse);
      if (avgRes?.ok) {
        const avgData = await avgRes.json() as NationalAvgResponse;
        if (avgData.price !== null) setNationalAvg(avgData.price);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Load stats eagerly so the header shows correct count before panel is opened
  useEffect(() => {
    if (session) load();
  }, [session, load, refreshKey]);

  // Fetch driver roster for fleet accounts so the edit form can show the picker
  useEffect(() => {
    const plan = (session?.user as { plan?: string } | undefined)?.plan ?? 'free';
    if (!session || plan !== 'fleet') return;
    fetch('/api/fleet/drivers')
      .then((r) => r.json())
      .then((d: { drivers?: string[] }) => setDrivers(d.drivers ?? []))
      .catch(() => {});
  }, [session]);

  // Auto-open when refreshKey changes (new fillup logged)
  useEffect(() => {
    if (refreshKey && refreshKey > 0) setOpen(true);
  }, [refreshKey]);

  // Listen for fillup-saved events dispatched by FillupLogger / ManualFillupLogger
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      // Auto-expand current month so the new entry is immediately visible
      setExpandedMonths((prev) => new Set([...prev, currentMonthStr()]));
      load();
    };
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [load]);

  if (status === 'loading' || !session) return null;

  const fillups  = data?.fillups ?? [];
  const stats    = data?.stats;
  const mpgMap   = data?.mpgMap ?? {};
  const userPlan = session?.user?.plan ?? 'free';
  const isFleet  = userPlan === 'fleet';

  // Driver filter — only meaningful for fleet accounts
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const allDriverLabels = isFleet
    ? [...new Set(fillups.map((f) => f.driverLabel).filter((d): d is string => !!d))]
    : [];

  // ── Grouped + filtered data ────────────────────────────────────────────────
  const visibleFillups = driverFilter === 'all'
    ? fillups
    : driverFilter === '__unassigned__'
      ? fillups.filter((f) => !f.driverLabel)
      : fillups.filter((f) => f.driverLabel === driverFilter);

  const allGroups      = groupByMonth(visibleFillups);
  const filteredGroups = applyFilter(allGroups, filterMode, customMonth);

  // ── Edit / Delete handlers ─────────────────────────────────────────────────

  async function handleDelete(id: string) {
    await fetch(`/api/fillups?id=${id}`, { method: 'DELETE' });
    setPendingDeleteId(null);
    load();
  }

  function handleEditStart(f: Fillup) {
    setEditingId(f.id);
    setEditError('');
    setEditDraft({
      date:            f.date,
      gallonsPumped:   String(f.gallonsPumped),
      pricePerGallon:  String(f.pricePerGallon),
      odometerReading: f.odometerReading != null ? String(f.odometerReading) : '',
      stationName:     f.stationName ?? '',
      notes:           f.notes ?? '',
      fuelGrade:       (f.fuelGrade ?? '') as EditFuelGrade,
      receiptThumb:    f.receiptThumb ?? '',
      driverLabel:     f.driverLabel ?? '',
    });
  }

  function handleEditCancel() {
    setEditingId(null);
    setEditDraft(null);
    setEditError('');
  }

  async function handleEditSave(id: string) {
    if (!editDraft) return;
    setEditSaving(true);
    setEditError('');
    const body: Record<string, unknown> = {
      id,
      date:           editDraft.date,
      gallonsPumped:  parseFloat(editDraft.gallonsPumped),
      pricePerGallon: parseFloat(editDraft.pricePerGallon),
    };
    if (editDraft.odometerReading !== '')
      body.odometerReading = parseInt(editDraft.odometerReading, 10);
    // Send stationName: include even when empty so the user can clear it
    body.stationName  = editDraft.stationName.trim() || undefined;
    if (editDraft.notes !== '')
      body.notes = editDraft.notes;
    body.fuelGrade    = editDraft.fuelGrade    || undefined;
    body.receiptThumb = editDraft.receiptThumb || undefined;
    body.driverLabel  = editDraft.driverLabel  || undefined;
    try {
      const res = await fetch('/api/fillups', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setEditError(err.error ?? 'Could not save changes.');
        return;
      }
      setEditingId(null);
      setEditDraft(null);
      load();
    } finally {
      setEditSaving(false);
    }
  }

  function handleCsvExport() {
    if (!data || fillups.length === 0) return;
    const header = ['Date', 'Vehicle', 'Station', 'Gallons', 'Price/Gal', 'Total Cost', 'Odometer', 'MPG', 'Notes'];
    const rows = fillups.map((f) => {
      const mpg = mpgMap[f.id];
      return [
        f.date,
        `"${f.vehicleName}"`,
        f.stationName ? `"${f.stationName}"` : '',
        f.gallonsPumped,
        f.pricePerGallon,
        f.totalCost.toFixed(2),
        f.odometerReading ?? '',
        mpg != null ? mpg : '',
        f.notes ? `"${f.notes}"` : '',
      ].join(',');
    });
    const csv  = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `gascap-fillups-${new Date().toISOString().slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleMonth(month: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  const FILTER_PILLS: { id: FilterMode; label: string }[] = [
    { id: 'all',        label: 'All' },
    { id: 'this-month', label: 'This Month' },
    { id: 'last-3',     label: 'Last 3 Mo' },
    { id: 'this-year',  label: 'This Year' },
  ];

  return (
    <div className="mt-6">
      {/* ── Header toggle ──────────────────────────────────────────────────── */}
      <button
        onClick={() => { setOpen((v) => !v); if (!open && !data) load(); }}
        className="w-full flex items-center justify-between py-3 px-4 bg-white rounded-2xl
                   border border-slate-100 shadow-sm hover:border-amber-200 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">📋</span>
          <div className="text-left">
            <p className="text-sm font-black text-slate-700">Fill-Up History</p>
            {stats && stats.count > 0 && (
              <p className="text-[10px] text-slate-400">
                {stats.count} fill-up{stats.count !== 1 ? 's' : ''} · ${stats.totalSpent.toFixed(2)} total spent
              </p>
            )}
            {/* Only show "none" after data has loaded and count is truly 0 */}
            {stats && stats.count === 0 && (
              <p className="text-[10px] text-slate-400">No fill-ups logged yet</p>
            )}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 space-y-3">

          {/* ── All-time stats bar ───────────────────────────────────────── */}
          {stats && stats.count > 0 && (() => {
            const annualProjection = calcAnnualProjection(fillups, stats.totalSpent);
            const costPerMile      = calcCostPerMile(fillups);
            return (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <StatPill label="Total spent" value={`$${stats.totalSpent.toFixed(2)}`} color="text-amber-600" />
                  <StatPill label="Gallons"     value={`${stats.totalGallons} gal`}        color="text-navy-700" />
                  <StatPill label="Avg MPG"
                    value={stats.avgMpg ? `${stats.avgMpg} mpg` : '—'}
                    color={stats.avgMpg ? 'text-green-600' : 'text-slate-400'}
                  />
                </div>

                {/* Annual projection — shown once we have 3+ fillups */}
                {annualProjection !== null && (
                  <div className="bg-navy-700 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-xl flex-shrink-0" aria-hidden="true">📅</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-white/50 uppercase tracking-wide">Annual Fuel Cost Projection</p>
                      <p className="text-xl font-black text-amber-400 leading-tight">
                        ${annualProjection.toFixed(0)}
                        <span className="text-xs font-semibold text-white/40 ml-1">/year</span>
                      </p>
                      <p className="text-[10px] text-white/40 mt-0.5">Based on your last {stats.count} fill-ups</p>
                    </div>
                  </div>
                )}

                {/* Cost per mile — shown when odometer data available */}
                {costPerMile !== null && (
                  <div className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base" aria-hidden="true">🛣️</span>
                      <div>
                        <p className="text-xs font-bold text-slate-700">Cost per mile</p>
                        <p className="text-[10px] text-slate-400">Based on odometer readings</p>
                      </div>
                    </div>
                    <p className="text-lg font-black text-navy-700 flex-shrink-0">
                      ${costPerMile.toFixed(3)}
                      <span className="text-[10px] font-semibold text-slate-400 ml-0.5">/mi</span>
                    </p>
                  </div>
                )}
              </>
            );
          })()}

          {stats && stats.count === 3 && userPlan === 'free' && (
            <UpgradeNudge
              emoji="⚡"
              headline="You're tracking like a pro!"
              body="Unlock MPG Trend charts, spending analytics, and monthly reports. See exactly where your money goes."
              ctaText="Upgrade to Pro →"
            />
          )}

          {loading && (
            <p className="text-xs text-slate-400 text-center py-4">Loading…</p>
          )}

          {!loading && fillups.length === 0 && (
            <div className="text-center py-6 bg-white rounded-2xl border border-slate-100">
              <p className="text-2xl mb-2">⛽</p>
              <p className="text-sm font-semibold text-slate-500">No fill-ups logged yet</p>
              <p className="text-xs text-slate-400 mt-1">After calculating, tap "Log This Fill-Up" to start tracking.</p>
            </div>
          )}

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          {!loading && fillups.length > 0 && (
            <div className="space-y-2">
              {/* Date range pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {FILTER_PILLS.map((pill) => (
                  <button
                    key={pill.id}
                    onClick={() => setFilterMode(pill.id)}
                    className={[
                      'px-3 py-1 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap',
                      filterMode === pill.id
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                    ].join(' ')}
                  >
                    {pill.label}
                  </button>
                ))}
                {/* Custom month picker — selecting a date auto-activates 'custom' */}
                <input
                  type="month"
                  value={customMonth}
                  onChange={(e) => { setCustomMonth(e.target.value); setFilterMode('custom'); }}
                  className={[
                    'px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer',
                    filterMode === 'custom'
                      ? 'border-amber-400 text-amber-700 bg-amber-50'
                      : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300',
                  ].join(' ')}
                  title="Filter by specific month"
                  aria-label="Filter by specific month"
                />
              </div>

              {/* Fleet driver filter — only shown when driver labels exist */}
              {isFleet && allDriverLabels.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wide mr-0.5">Driver:</span>
                  <button
                    onClick={() => setDriverFilter('all')}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap ${
                      driverFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    All
                  </button>
                  {allDriverLabels.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDriverFilter(d)}
                      className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap ${
                        driverFilter === d ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    onClick={() => setDriverFilter('__unassigned__')}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap ${
                      driverFilter === '__unassigned__' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    Unassigned
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── No results for selected filter ───────────────────────────── */}
          {!loading && filteredGroups.length === 0 && fillups.length > 0 && (
            <div className="text-center py-5 bg-white rounded-2xl border border-slate-100">
              <p className="text-sm text-slate-400">No fill-ups in this period</p>
              <button
                onClick={() => setFilterMode('all')}
                className="text-xs text-amber-600 font-semibold mt-1 hover:underline"
              >
                Show all →
              </button>
            </div>
          )}

          {/* ── Month-grouped list ────────────────────────────────────────── */}
          {!loading && filteredGroups.map((group) => {
            const isExpanded = expandedMonths.has(group.month);
            const isCurrent  = group.month === currentMonthStr();
            const groupSpent = group.fillups.reduce((s, f) => s + f.totalCost, 0);

            return (
              <div key={group.month} className="space-y-1.5">

                {/* Month section header */}
                <button
                  onClick={() => toggleMonth(group.month)}
                  className={[
                    'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-colors text-left',
                    isCurrent
                      ? 'bg-amber-50 border border-amber-200 hover:bg-amber-100'
                      : 'bg-slate-50 border border-slate-100 hover:bg-slate-100',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-700">{group.label}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                        NOW
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-xs font-black text-amber-600">${groupSpent.toFixed(2)}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">
                        {group.fillups.length} fill-up{group.fillups.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <svg
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </div>
                </button>

                {/* Expanded fill-up rows */}
                {isExpanded && (
                  <div className="space-y-1.5 pl-1">
                    {group.fillups.map((f) => {
                      const mpg       = mpgMap[f.id];
                      const isEditing = editingId === f.id;

                      if (isEditing && editDraft) {
                        return (
                          <div key={f.id} className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm px-4 py-4 space-y-3">
                            <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Edit Fill-Up</p>

                            {/* Row 1: date + gallons */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Date</label>
                                <input
                                  type="date"
                                  value={editDraft.date}
                                  max={new Date().toISOString().split('T')[0]}
                                  onChange={(e) => setEditDraft((d) => d ? { ...d, date: e.target.value } : d)}
                                  className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                             focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">Gallons</label>
                                <input
                                  type="number" inputMode="decimal" min="0.1" step="0.001"
                                  value={editDraft.gallonsPumped}
                                  onChange={(e) => setEditDraft((d) => d ? { ...d, gallonsPumped: e.target.value } : d)}
                                  className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                             focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                />
                              </div>
                            </div>

                            {/* Row 2: price + odometer */}
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">$/gal</label>
                                <input
                                  type="number" inputMode="decimal" min="0.01" step="0.001"
                                  value={editDraft.pricePerGallon}
                                  onChange={(e) => setEditDraft((d) => d ? { ...d, pricePerGallon: e.target.value } : d)}
                                  className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                             focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  Odometer <span className="font-normal text-slate-300">(opt)</span>
                                </label>
                                <input
                                  type="number" inputMode="numeric" min="0" step="1"
                                  value={editDraft.odometerReading}
                                  placeholder="—"
                                  onChange={(e) => setEditDraft((d) => d ? { ...d, odometerReading: e.target.value } : d)}
                                  className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                             focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                />
                              </div>
                            </div>

                            {/* Gas Station */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                ⛽ Gas Station <span className="font-normal text-slate-300">(opt)</span>
                              </label>
                              <input
                                type="text" maxLength={60}
                                value={editDraft.stationName}
                                placeholder="e.g. Shell, Chevron, BP…"
                                onChange={(e) => setEditDraft((d) => d ? { ...d, stationName: e.target.value } : d)}
                                className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                           focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                              />
                            </div>

                            {/* Driver — fleet accounts with a roster only */}
                            {isFleet && drivers.length > 0 && (
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                  Driver
                                  <span className="ml-1 text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">FLEET</span>
                                </label>
                                <select
                                  value={editDraft.driverLabel}
                                  onChange={(e) => setEditDraft((d) => d ? { ...d, driverLabel: e.target.value } : d)}
                                  className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                             focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                >
                                  <option value="">— Unassigned —</option>
                                  {drivers.map((driver) => (
                                    <option key={driver} value={driver}>{driver}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Notes */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                Notes <span className="font-normal text-slate-300">(opt)</span>
                              </label>
                              <input
                                type="text" maxLength={160}
                                value={editDraft.notes}
                                placeholder="Address, notes, anything else…"
                                onChange={(e) => setEditDraft((d) => d ? { ...d, notes: e.target.value } : d)}
                                className="w-full text-xs px-2.5 py-2 border border-slate-200 rounded-xl
                                           focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                              />
                            </div>

                            {/* Fuel Grade */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                                Fuel Grade <span className="font-normal text-slate-300">(opt)</span>
                              </label>
                              <div className="grid grid-cols-4 gap-1.5">
                                {EDIT_FUEL_GRADES.map((g) => (
                                  <button
                                    key={g.value}
                                    type="button"
                                    onClick={() => setEditDraft((d) => d ? { ...d, fuelGrade: d.fuelGrade === g.value ? '' : g.value } : d)}
                                    className={[
                                      'flex flex-col items-center justify-center rounded-xl border-2 py-1.5 transition-all',
                                      editDraft.fuelGrade === g.value
                                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                                        : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
                                    ].join(' ')}
                                  >
                                    <span className="text-[10px] font-black leading-tight">{g.label}</span>
                                    <span className="text-[9px] text-slate-400 leading-tight">{g.sub}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Receipt Photo */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">
                                Receipt Photo <span className="font-normal text-slate-300">(opt)</span>
                              </label>

                              {/* Hidden file inputs */}
                              <input
                                type="file" accept="image/*" capture="environment"
                                ref={editCameraRef} className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  e.target.value = '';
                                  setEditImgLoading(true);
                                  try {
                                    const thumb = await compressEditImage(file);
                                    setEditDraft((d) => d ? { ...d, receiptThumb: thumb } : d);
                                  } catch { /* ignore */ }
                                  finally { setEditImgLoading(false); }
                                }}
                              />
                              <input
                                type="file" accept="image/*"
                                ref={editGalleryRef} className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  e.target.value = '';
                                  setEditImgLoading(true);
                                  try {
                                    const thumb = await compressEditImage(file);
                                    setEditDraft((d) => d ? { ...d, receiptThumb: thumb } : d);
                                  } catch { /* ignore */ }
                                  finally { setEditImgLoading(false); }
                                }}
                              />

                              {editDraft.receiptThumb ? (
                                /* Existing or newly-added thumbnail */
                                <div className="flex items-start gap-3">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={editDraft.receiptThumb}
                                    alt="Receipt"
                                    className="w-14 h-20 object-cover rounded-lg border border-slate-200 shadow-sm flex-shrink-0"
                                  />
                                  <div className="flex flex-col gap-1.5 pt-0.5">
                                    <button
                                      type="button"
                                      onClick={() => editCameraRef.current?.click()}
                                      disabled={editImgLoading}
                                      className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                                    >
                                      📷 {editImgLoading ? 'Loading…' : 'Replace (Camera)'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => editGalleryRef.current?.click()}
                                      disabled={editImgLoading}
                                      className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                                    >
                                      🖼️ Replace (Photos)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditDraft((d) => d ? { ...d, receiptThumb: '' } : d)}
                                      className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 hover:bg-red-100 transition-colors"
                                    >
                                      🗑️ Remove
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* No receipt yet */
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => editCameraRef.current?.click()}
                                    disabled={editImgLoading}
                                    className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                                  >
                                    <span>{editImgLoading ? '🔄' : '📷'}</span>
                                    <span>{editImgLoading ? 'Loading…' : 'Use Camera'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => editGalleryRef.current?.click()}
                                    disabled={editImgLoading}
                                    className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
                                  >
                                    <span>🖼️</span>
                                    <span>Upload from Photos</span>
                                  </button>
                                </div>
                              )}
                            </div>

                            {editError && (
                              <p className="text-[10px] text-red-500 leading-relaxed">{editError}</p>
                            )}

                            {/* Save / Cancel */}
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => handleEditSave(f.id)}
                                disabled={editSaving}
                                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50
                                           text-white text-xs font-bold rounded-xl transition-colors"
                              >
                                {editSaving ? '…' : 'Save'}
                              </button>
                              <button
                                onClick={handleEditCancel}
                                className="flex-1 py-2 bg-white border border-slate-200 hover:border-slate-300
                                           text-slate-600 text-xs font-bold rounded-xl transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={f.id}
                          className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 flex items-start gap-3"
                        >
                          {/* Date column */}
                          <div className="flex-shrink-0 text-center min-w-[40px]">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">
                              {new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}
                            </p>
                            <p className="text-xl font-black text-navy-700 leading-none">
                              {new Date(f.date + 'T12:00:00').getDate()}
                            </p>
                          </div>

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-700 leading-tight truncate">
                                  {f.vehicleName}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5 truncate">
                                  {f.gallonsPumped} gal · ${f.pricePerGallon}/gal
                                  {f.odometerReading != null && ` · ${f.odometerReading.toLocaleString()} mi`}
                                </p>
                                {/* Price vs. national avg badge */}
                                {nationalAvg !== null && (() => {
                                  const delta = nationalAvg - f.pricePerGallon;
                                  if (Math.abs(delta) < 0.005) return null;
                                  const saved = delta > 0;
                                  return (
                                    <span className={[
                                      'inline-flex items-center gap-0.5 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                                      saved
                                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                        : 'bg-amber-50 text-amber-600 border border-amber-100',
                                    ].join(' ')}>
                                      {saved ? '↓' : '↑'} ${Math.abs(delta).toFixed(3)}/gal {saved ? 'below avg' : 'above avg'}
                                    </span>
                                  );
                                })()}
                                {f.stationName && (
                                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">⛽ {f.stationName}</p>
                                )}
                                {f.notes && (
                                  <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">{f.notes}</p>
                                )}
                                {f.driverLabel && (
                                  <span className="inline-block mt-0.5 text-[9px] font-bold bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">
                                    👤 {f.driverLabel}
                                  </span>
                                )}
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-sm font-black text-amber-600">${f.totalCost.toFixed(2)}</p>
                                {mpg != null && (
                                  <p className="text-[10px] font-bold text-green-600 mt-0.5">{mpg} mpg</p>
                                )}
                              </div>
                            </div>
                          </div>

                          {pendingDeleteId === f.id ? (
                            /* ── Delete confirmation — replaces edit + delete icons ── */
                            <>
                              <button
                                onClick={() => setPendingDeleteId(null)}
                                className="flex-shrink-0 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors mt-0.5 whitespace-nowrap"
                                aria-label="Cancel delete"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDelete(f.id)}
                                className="flex-shrink-0 text-[10px] font-bold text-red-500 hover:text-red-700 transition-colors mt-0.5 whitespace-nowrap"
                                aria-label="Confirm delete fill-up"
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            /* ── Normal edit + delete icons ── */
                            <>
                              {/* Edit */}
                              <button
                                onClick={() => handleEditStart(f)}
                                className="flex-shrink-0 text-slate-200 hover:text-amber-400 transition-colors mt-0.5"
                                aria-label="Edit fillup"
                              >
                                <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                                     stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"/>
                                </svg>
                              </button>

                              {/* Delete — requires confirmation tap */}
                              <button
                                onClick={() => setPendingDeleteId(f.id)}
                                className="flex-shrink-0 text-slate-200 hover:text-red-400 transition-colors mt-0.5"
                                aria-label="Delete fillup"
                              >
                                <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                                     stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                  <path d="M1 1l10 10M11 1L1 11"/>
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Export row ────────────────────────────────────────────────── */}
          {fillups.length > 0 && (
            <>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleCsvExport}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                             border border-slate-200 bg-white text-xs font-semibold text-slate-600
                             hover:border-amber-300 hover:text-amber-700 transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                       strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M8 2v9M4 7l4 4 4-4M2 14h12"/>
                  </svg>
                  Export CSV
                </button>
                <a
                  href="/fillups/export"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                             border border-slate-200 bg-white text-xs font-semibold text-slate-600
                             hover:border-amber-300 hover:text-amber-700 transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor"
                       strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <rect x="2" y="1" width="12" height="14" rx="1.5"/>
                    <path d="M5 5h6M5 8h6M5 11h4"/>
                  </svg>
                  Print / PDF
                </a>
              </div>
              <p className="text-center text-[10px] text-slate-300 pb-2">
                {fillups.length} fill-up{fillups.length !== 1 ? 's' : ''} logged
                {stats?.avgMpg ? ` · Avg ${stats.avgMpg} MPG` : ' · Add odometer readings to track MPG'}
              </p>
            </>
          )}

        </div>
      )}
    </div>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-3 py-2.5 text-center">
      <p className={`text-sm font-black ${color}`}>{value}</p>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}
