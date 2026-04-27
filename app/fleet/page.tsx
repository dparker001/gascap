'use client';

import { useSession }      from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import Link                from 'next/link';
import type { Fillup }     from '@/lib/fillups';
import ManualFillupLogger  from '@/components/ManualFillupLogger';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FillupData {
  fillups: Fillup[];
  stats: {
    count:        number;
    totalSpent:   number;
    totalGallons: number;
    avgMpg:       number | null;
  };
}

interface Vehicle {
  id:    string;
  name:  string;
  make?: string;
  model?: string;
  year?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonthStr() { return new Date().toISOString().slice(0, 7); }

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`;
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FleetPage() {
  const { data: session, status } = useSession();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [fillupData,  setFillupData]  = useState<FillupData | null>(null);
  const [vehicles,    setVehicles]    = useState<Vehicle[]>([]);
  const [drivers,     setDrivers]     = useState<string[]>([]);
  const [driverLimit, setDriverLimit] = useState(10);
  const [loading,     setLoading]     = useState(true);

  // ── Driver management state ──────────────────────────────────────────────────
  const [newDriverName, setNewDriverName] = useState('');
  const [addingDriver,  setAddingDriver]  = useState(false);
  const [addError,      setAddError]      = useState('');

  // ── Filter state ────────────────────────────────────────────────────────────
  const [driverFilter,     setDriverFilter]     = useState('all');
  const [monthFilter,      setMonthFilter]      = useState('all');
  const [taxYear,          setTaxYear]          = useState(String(new Date().getFullYear()));
  const [taxReportLoading, setTaxReportLoading] = useState(false);
  const [taxReportError,   setTaxReportError]   = useState('');

  // ── Bulk import state ───────────────────────────────────────────────────────
  type ImportRow = { row: number; name: string; status: 'created' | 'skipped'; error?: string };
  const [importFile,     setImportFile]     = useState<File | null>(null);
  const [importLoading,  setImportLoading]  = useState(false);
  const [importResults,  setImportResults]  = useState<{ created: number; skipped: number; rows: ImportRow[] } | null>(null);
  const [importError,    setImportError]    = useState('');

  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';

  // ── Load all fleet data ──────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fillupRes, vehicleRes, driverRes] = await Promise.all([
        fetch('/api/fillups'),
        fetch('/api/vehicles'),
        fetch('/api/fleet/drivers'),
      ]);
      if (fillupRes.ok)  setFillupData(await fillupRes.json() as FillupData);
      if (vehicleRes.ok) setVehicles((await vehicleRes.json() as { vehicles?: Vehicle[] }).vehicles ?? []);
      if (driverRes.ok) {
        const dr = await driverRes.json() as { drivers: string[]; limit: number };
        setDrivers(dr.drivers);
        setDriverLimit(dr.limit);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) loadAll();
  }, [session, loadAll]);

  // Refresh fleet data whenever a fill-up is saved from ManualFillupLogger
  useEffect(() => {
    const handler = () => loadAll();
    window.addEventListener('fillup-saved', handler);
    return () => window.removeEventListener('fillup-saved', handler);
  }, [loadAll]);

  // ── Guard: must be signed in and fleet plan ──────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-slate-600 font-semibold">Sign in to access Fleet Dashboard</p>
        <Link href="/signin" className="px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl">Sign In</Link>
      </div>
    );
  }

  if (userPlan !== 'fleet') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-3xl">🚛</p>
        <p className="text-slate-700 font-black text-lg">Fleet Dashboard</p>
        <p className="text-slate-500 text-sm max-w-xs">This area is for GasCap™ Fleet subscribers.</p>
        <Link href="/upgrade" className="px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl text-sm">
          Upgrade to Fleet →
        </Link>
        <Link href="/" className="text-xs text-slate-400 hover:text-slate-600">← Back to app</Link>
      </div>
    );
  }

  // ── Derived data ─────────────────────────────────────────────────────────────
  const allFillups   = fillupData?.fillups ?? [];
  const thisMonth    = currentMonthStr();

  // Apply filters
  const filteredFillups = allFillups
    .filter((f) =>
      driverFilter === 'all'              ? true :
      driverFilter === '__unassigned__'   ? !f.driverLabel :
      f.driverLabel === driverFilter
    )
    .filter((f) =>
      monthFilter === 'all' ? true : f.date.startsWith(monthFilter)
    );

  // This month stats
  const thisMonthFillups = allFillups.filter((f) => f.date.startsWith(thisMonth));
  const thisMonthSpent   = thisMonthFillups.reduce((s, f) => s + f.totalCost, 0);

  // All months present in data (for filter dropdown)
  const allMonths = [...new Set(allFillups.map((f) => f.date.slice(0, 7)))]
    .sort()
    .reverse();

  // Years that have at least one fill-up (for tax report year selector)
  const availableYears = [...new Set(allFillups.map((f) => f.date.slice(0, 4)))]
    .sort()
    .reverse();

  // Per-driver breakdown
  interface DriverStat {
    name:         string;
    fillupCount:  number;
    totalSpent:   number;
    totalGallons: number;
    lastDate:     string | null;
    vehicles:     string[];
  }

  const driverStats: DriverStat[] = drivers.map((name) => {
    const df = allFillups.filter((f) => f.driverLabel === name);
    return {
      name,
      fillupCount:  df.length,
      totalSpent:   df.reduce((s, f) => s + f.totalCost, 0),
      totalGallons: df.reduce((s, f) => s + f.gallonsPumped, 0),
      lastDate:     df[0]?.date ?? null,
      vehicles:     [...new Set(df.map((f) => f.vehicleName))],
    };
  });

  const unattributed = allFillups.filter((f) => !f.driverLabel);

  // ── Add driver ───────────────────────────────────────────────────────────────
  async function handleAddDriver(e: React.FormEvent) {
    e.preventDefault();
    const name = newDriverName.trim();
    if (!name) return;
    setAddingDriver(true);
    setAddError('');
    try {
      const res = await fetch('/api/fleet/drivers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      const data = await res.json() as { drivers?: string[]; error?: string };
      if (!res.ok) { setAddError(data.error ?? 'Could not add driver.'); return; }
      setDrivers(data.drivers ?? []);
      setNewDriverName('');
    } finally {
      setAddingDriver(false);
    }
  }

  // ── Remove driver ─────────────────────────────────────────────────────────────
  async function handleRemoveDriver(name: string) {
    if (!confirm(`Remove "${name}" from the driver roster? Their fill-up history is kept.`)) return;
    const res  = await fetch(`/api/fleet/drivers?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json() as { drivers?: string[] };
    if (res.ok) setDrivers(data.drivers ?? []);
  }

  // ── CSV export ────────────────────────────────────────────────────────────────
  function handleExport() {
    const header = ['Date','Vehicle','Driver','Gallons','Price/Gal','Total Cost','Odometer','Notes'];
    const rows   = filteredFillups.map((f) => [
      f.date,
      `"${f.vehicleName}"`,
      f.driverLabel ? `"${f.driverLabel}"` : '',
      f.gallonsPumped,
      f.pricePerGallon,
      f.totalCost.toFixed(2),
      f.odometerReading ?? '',
      f.notes ? `"${f.notes}"` : '',
    ].join(','));
    const csv  = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `gascap-fleet-${thisMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Tax report download ───────────────────────────────────────────────────────
  async function handleTaxReport() {
    setTaxReportLoading(true);
    setTaxReportError('');
    try {
      const res = await fetch(`/api/fleet/tax-report?year=${taxYear}`);
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setTaxReportError(data.error ?? 'Could not generate report.');
        return;
      }
      const blob     = await res.blob();
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `gascap-fleet-tax-report-${taxYear}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setTaxReportError('Network error — please try again.');
    } finally {
      setTaxReportLoading(false);
    }
  }

  // ── Bulk vehicle import ───────────────────────────────────────────────────────
  async function handleImport() {
    if (!importFile) return;
    setImportLoading(true);
    setImportError('');
    setImportResults(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const res  = await fetch('/api/vehicles/import', { method: 'POST', body: fd });
      const data = await res.json() as { created?: number; skipped?: number; rows?: ImportRow[]; error?: string };
      if (!res.ok) { setImportError(data.error ?? 'Import failed.'); return; }
      setImportResults({ created: data.created ?? 0, skipped: data.skipped ?? 0, rows: data.rows ?? [] });
      setImportFile(null);
      if ((data.created ?? 0) > 0) loadAll(); // refresh fleet data
    } catch {
      setImportError('Network error — please try again.');
    } finally {
      setImportLoading(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      'Name,Tank Size (gal),Year,Make,Model,Trim,VIN,Odometer',
      '"2022 Toyota Camry SE",15.8,2022,Toyota,Camry,SE,,52000',
      '"2019 Ford F-150 XLT",36.0,2019,Ford,F-150,XLT,,88000',
      '"2023 Honda CR-V",14.8,2023,Honda,CR-V,EX-L,,12500',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'gascap-vehicle-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ──────────────────────────────────────────────────────────────────��─
  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-[#1E2D4A] pt-12 pb-8 px-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/" className="text-white/60 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </Link>
          <div className="flex-1">
            <h1 className="text-white font-black text-xl leading-tight">Fleet Dashboard</h1>
            <p className="text-white/50 text-xs mt-0.5">GasCap™ Fleet</p>
          </div>
          <span className="text-[10px] font-black bg-blue-500 text-white px-2.5 py-1 rounded-full">FLEET</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <>

            {/* ── Overview stats row ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
              <StatPill emoji="👤" label="Drivers" value={String(drivers.length)} sub={`of ${driverLimit} max`} color="text-blue-600" />
              <StatPill emoji="🚗" label="Vehicles" value={String(vehicles.length)} sub="saved" color="text-[#1E2D4A]" />
              <StatPill emoji="💰" label="This Month" value={`$${thisMonthSpent.toFixed(2)}`} sub={`${thisMonthFillups.length} fill-up${thisMonthFillups.length !== 1 ? 's' : ''}`} color="text-amber-600" />
              <StatPill emoji="⛽" label="All Time" value={`$${(fillupData?.stats.totalSpent ?? 0).toFixed(2)}`} sub={`${fillupData?.stats.count ?? 0} fill-ups`} color="text-green-600" />
            </div>

            {/* ── Log Fill-Up ─────────────────────────────────────────────── */}
            <ManualFillupLogger />

            {/* ── Reports ─────────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-sm font-black text-slate-700">📄 Reports</p>
              </div>
              <div className="px-4 py-4 space-y-3">
                {/* Annual Tax Report */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-700">Annual Fleet Fuel Tax Report</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">PDF summary of all fuel costs by vehicle &amp; month</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {availableYears.length > 0 ? (
                      <select
                        value={taxYear}
                        onChange={(e) => { setTaxYear(e.target.value); setTaxReportError(''); }}
                        className="text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200
                                   rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {availableYears.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[10px] text-slate-400">{new Date().getFullYear()}</span>
                    )}
                    <button
                      onClick={handleTaxReport}
                      disabled={taxReportLoading || allFillups.length === 0}
                      className="flex items-center gap-1.5 text-[11px] font-black text-white
                                 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-colors
                                 rounded-xl px-3 py-1.5 whitespace-nowrap"
                    >
                      {taxReportLoading ? (
                        <>
                          <div className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor"
                               strokeWidth="1.8" strokeLinecap="round">
                            <path d="M8 2v9M4 7l4 4 4-4M2 14h12"/>
                          </svg>
                          Download PDF
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {taxReportError && (
                  <p className="text-[11px] text-red-500">{taxReportError}</p>
                )}
                {allFillups.length === 0 && (
                  <p className="text-[11px] text-slate-400">Log your first fill-up to generate a tax report.</p>
                )}
              </div>
            </div>

            {/* ── Bulk Vehicle Import ─────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-black text-slate-700">🚗 Bulk Vehicle Import</p>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1 text-[10px] font-bold text-slate-400
                             hover:text-teal-600 transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor"
                       strokeWidth="1.8" strokeLinecap="round">
                    <path d="M8 2v9M4 7l4 4 4-4M2 14h12"/>
                  </svg>
                  Download Template
                </button>
              </div>
              <div className="px-4 py-4 space-y-3">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Upload a CSV to add multiple vehicles at once. Required columns: <strong>Name</strong> and <strong>Tank Size (gal)</strong>.
                  Optional: Year, Make, Model, Trim, VIN, Odometer.
                </p>

                {/* File picker */}
                <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                  importFile ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-400 flex-shrink-0"
                       fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    {importFile ? (
                      <>
                        <p className="text-xs font-bold text-teal-700 truncate">{importFile.name}</p>
                        <p className="text-[10px] text-teal-500">{(importFile.size / 1024).toFixed(1)} KB</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">Choose a .csv file…</p>
                    )}
                  </div>
                  <input
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setImportFile(f);
                      setImportResults(null);
                      setImportError('');
                      e.target.value = '';
                    }}
                  />
                </label>

                {/* Import button */}
                <button
                  onClick={handleImport}
                  disabled={!importFile || importLoading}
                  className="w-full py-2.5 rounded-xl bg-[#1E2D4A] hover:bg-[#2a3d60] text-white
                             font-black text-sm disabled:opacity-40 transition-colors"
                >
                  {importLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Importing…
                    </span>
                  ) : 'Import Vehicles'}
                </button>

                {/* Error */}
                {importError && (
                  <p className="text-[11px] text-red-500">{importError}</p>
                )}

                {/* Results */}
                {importResults && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <span className="text-[11px] font-black text-green-600 bg-green-50 rounded-full px-2.5 py-1">
                        ✓ {importResults.created} imported
                      </span>
                      {importResults.skipped > 0 && (
                        <span className="text-[11px] font-black text-amber-600 bg-amber-50 rounded-full px-2.5 py-1">
                          ⚠ {importResults.skipped} skipped
                        </span>
                      )}
                    </div>
                    {importResults.rows.filter((r) => r.status === 'skipped').map((r) => (
                      <div key={r.row} className="text-[10px] text-slate-500 bg-slate-50 rounded-lg px-3 py-1.5">
                        <span className="font-bold">Row {r.row} — {r.name}:</span> {r.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Driver Roster ────────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-black text-slate-700">👤 Driver Roster</p>
                <span className="text-[10px] text-slate-400">{drivers.length} / {driverLimit}</span>
              </div>

              {/* Add driver form */}
              <form onSubmit={handleAddDriver} className="px-4 py-3 flex gap-2 border-b border-slate-50">
                <input
                  type="text"
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  placeholder='e.g. "John S."'
                  maxLength={40}
                  className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-xl
                             focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                />
                <button
                  type="submit"
                  disabled={addingDriver || !newDriverName.trim() || drivers.length >= driverLimit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                             text-white text-xs font-bold rounded-xl transition-colors"
                >
                  {addingDriver ? '…' : 'Add'}
                </button>
              </form>
              {addError && <p className="px-4 py-1 text-[11px] text-red-500">{addError}</p>}

              {/* Driver list */}
              {drivers.length === 0 ? (
                <p className="px-4 py-5 text-sm text-slate-400 text-center">
                  No drivers yet — add your first driver above.
                </p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {driverStats.map((ds) => (
                    <div key={ds.name} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-black text-blue-700">
                          {ds.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">{ds.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {ds.fillupCount > 0
                            ? `${ds.fillupCount} fill-up${ds.fillupCount !== 1 ? 's' : ''} · $${ds.totalSpent.toFixed(2)} · last ${fmtDate(ds.lastDate!)}`
                            : 'No fill-ups yet'}
                        </p>
                        {ds.vehicles.length > 0 && (
                          <p className="text-[9px] text-slate-300 truncate mt-0.5">
                            {ds.vehicles.join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0 mr-1">
                        <p className="text-sm font-black text-amber-600">{ds.fillupCount > 0 ? `$${ds.totalSpent.toFixed(0)}` : '—'}</p>
                        <p className="text-[10px] text-slate-400">{ds.totalGallons > 0 ? `${ds.totalGallons.toFixed(1)} gal` : ''}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveDriver(ds.name)}
                        className="text-slate-200 hover:text-red-400 transition-colors flex-shrink-0"
                        aria-label={`Remove ${ds.name}`}
                      >
                        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M1 1l10 10M11 1L1 11"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Unattributed summary — shown when there are unassigned fill-ups */}
              {unattributed.length > 0 && (
                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <p className="text-[11px] text-slate-500">
                    ⚠️ {unattributed.length} fill-up{unattributed.length !== 1 ? 's' : ''} not assigned to a driver
                  </p>
                  <button
                    onClick={() => setDriverFilter('__unassigned__')}
                    className="text-[11px] text-blue-600 font-semibold hover:underline"
                  >
                    View →
                  </button>
                </div>
              )}
            </div>

            {/* ── Fill-up Activity ─────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-black text-slate-700">⛽ Fill-Up Activity</p>
                <button
                  onClick={handleExport}
                  disabled={filteredFillups.length === 0}
                  className="flex items-center gap-1 text-[10px] font-bold text-slate-500
                             hover:text-amber-600 disabled:opacity-30 transition-colors"
                >
                  <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor"
                       strokeWidth="1.8" strokeLinecap="round">
                    <path d="M8 2v9M4 7l4 4 4-4M2 14h12"/>
                  </svg>
                  Export CSV
                </button>
              </div>

              {/* Filters */}
              <div className="px-4 py-2.5 border-b border-slate-50 space-y-2">
                {/* Driver filter */}
                {drivers.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wide">Driver:</span>
                    {[{ id: 'all', label: 'All' }, ...drivers.map((d) => ({ id: d, label: d })), { id: '__unassigned__', label: 'Unassigned' }].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setDriverFilter(opt.id)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap ${
                          driverFilter === opt.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                {/* Month filter */}
                {allMonths.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Month:</span>
                    <button
                      onClick={() => setMonthFilter('all')}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                        monthFilter === 'all' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      All
                    </button>
                    {allMonths.map((m) => (
                      <button
                        key={m}
                        onClick={() => setMonthFilter(m)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap ${
                          monthFilter === m ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {fmtMonth(m).replace(' 20', ' \'').slice(0, 8)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fill-up table */}
              {filteredFillups.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-2xl mb-2">⛽</p>
                  <p className="text-sm text-slate-400">No fill-ups match the current filters</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {filteredFillups.map((f) => (
                    <div key={f.id} className="flex items-start gap-3 px-4 py-3">
                      {/* Date */}
                      <div className="flex-shrink-0 text-center min-w-[38px]">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">
                          {new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}
                        </p>
                        <p className="text-lg font-black text-[#1E2D4A] leading-none">
                          {new Date(f.date + 'T12:00:00').getDate()}
                        </p>
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-700 truncate">{f.vehicleName}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {f.gallonsPumped} gal · ${f.pricePerGallon}/gal
                          {f.odometerReading != null && ` · ${f.odometerReading.toLocaleString()} mi`}
                        </p>
                        {f.driverLabel && (
                          <span className="inline-block mt-0.5 text-[9px] font-bold bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">
                            👤 {f.driverLabel}
                          </span>
                        )}
                        {f.notes && (
                          <p className="text-[10px] text-slate-400 italic mt-0.5 truncate">{f.notes}</p>
                        )}
                      </div>
                      {/* Cost */}
                      <p className="text-sm font-black text-amber-600 flex-shrink-0">${f.totalCost.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Table footer */}
              {filteredFillups.length > 0 && (
                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex justify-between text-xs text-slate-400">
                  <span>{filteredFillups.length} fill-up{filteredFillups.length !== 1 ? 's' : ''}</span>
                  <span className="font-bold text-amber-600">
                    ${filteredFillups.reduce((s, f) => s + f.totalCost, 0).toFixed(2)} total
                  </span>
                </div>
              )}
            </div>

            <p className="text-center text-[10px] text-slate-300 pb-4">
              GasCap™ Fleet · <Link href="/settings" className="underline">Settings</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── StatPill ──────────────────────────────────────────────────────────────────

function StatPill({
  emoji, label, value, sub, color,
}: {
  emoji: string; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 px-3 py-3 text-center">
      <p className="text-base mb-0.5">{emoji}</p>
      <p className={`text-lg font-black leading-tight ${color}`}>{value}</p>
      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
      <p className="text-[9px] text-slate-300">{sub}</p>
    </div>
  );
}
