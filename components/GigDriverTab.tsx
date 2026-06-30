'use client';

import { useState, useEffect, useCallback } from 'react';

const PLATFORMS = [
  { value: 'uber',        label: 'Uber' },
  { value: 'lyft',        label: 'Lyft' },
  { value: 'doordash',    label: 'DoorDash' },
  { value: 'instacart',   label: 'Instacart' },
  { value: 'spark',       label: 'Spark' },
  { value: 'amazon_flex', label: 'Amazon Flex' },
  { value: 'shipt',       label: 'Shipt' },
  { value: 'courier',     label: 'Courier' },
  { value: 'other',       label: 'Other' },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GigFillup {
  id: string; date: string; gallons: number; pricePerGallon: number;
  totalCost: number; station?: string | null; platform?: string | null;
}

interface GigMileageEntry {
  id: string; date: string; miles: number; platform?: string | null;
  category: string; startOdometer?: number | null; endOdometer?: number | null;
}

// ── Weekly summary stats ───────────────────────────────────────────────────────

function calcSummary(fillups: GigFillup[], mileage: GigMileageEntry[]) {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStr = weekAgo.toISOString().slice(0, 10);
  const wFillups  = fillups.filter(f => f.date >= weekStr);
  const wMileage  = mileage.filter(m => m.date >= weekStr && m.category === 'business');
  const totalSpend   = wFillups.reduce((s, f) => s + f.totalCost, 0);
  const totalGallons = wFillups.reduce((s, f) => s + f.gallons, 0);
  const totalMiles   = wMileage.reduce((s, m) => s + m.miles, 0);
  const avgPpg = totalGallons > 0 ? totalSpend / totalGallons : 0;
  const cpm    = totalMiles  > 0 && totalSpend > 0 ? totalSpend / totalMiles : 0;
  return { totalSpend, totalGallons, totalMiles, avgPpg, cpm, fillupCount: wFillups.length };
}

// ── Fuel log form ─────────────────────────────────────────────────────────────

function FillupForm({ onSaved }: { onSaved: () => void }) {
  const [date,     setDate]     = useState(todayStr());
  const [gallons,  setGallons]  = useState('');
  const [ppg,      setPpg]      = useState('');
  const [station,  setStation]  = useState('');
  const [platform, setPlatform] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!gallons || !ppg) return;
    setSaving(true);
    try {
      const res = await fetch('/api/gig/fillups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          gallons:        parseFloat(gallons),
          pricePerGallon: parseFloat(ppg),
          station:        station || undefined,
          platform:       platform || undefined,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setGallons(''); setPpg(''); setStation(''); setPlatform('');
        onSaved();
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  const total = gallons && ppg ? (parseFloat(gallons) * parseFloat(ppg)).toFixed(2) : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="field-label">Date</label>
        <input type="date" className="input-field text-sm w-full" value={date}
          onChange={e => setDate(e.target.value)} required />
      </div>
      <div>
        <label className="field-label">Platform</label>
        <select className="input-field text-sm text-slate-600 w-full" value={platform}
          onChange={e => setPlatform(e.target.value)}>
          <option value="">Any</option>
          {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Gallons</label>
          <input type="number" inputMode="decimal" className="input-field text-sm"
            placeholder="12.4" min="0.1" max="200" step="0.01"
            value={gallons} onChange={e => setGallons(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">Price / gal</label>
          <input type="number" inputMode="decimal" className="input-field text-sm"
            placeholder="3.49" min="0.01" max="30" step="0.001"
            value={ppg} onChange={e => setPpg(e.target.value)} required />
        </div>
      </div>
      <div>
        <label className="field-label">Station <span className="font-normal text-slate-400">(optional)</span></label>
        <input type="text" className="input-field text-sm" placeholder="Shell, Chevron…"
          value={station} onChange={e => setStation(e.target.value)} maxLength={80} />
      </div>
      {total && (
        <p className="text-xs font-black text-slate-700 text-right">
          Total: <span className="text-brand-orange">${total}</span>
        </p>
      )}
      <button type="submit" disabled={saving || !gallons || !ppg}
        className="w-full py-2.5 rounded-xl bg-brand-orange text-white font-black text-sm
                   disabled:opacity-40 hover:bg-orange-600 active:scale-[0.98] transition-all">
        {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Log Fill-Up'}
      </button>
    </form>
  );
}

// ── Mileage log form ──────────────────────────────────────────────────────────

function MileageForm({ onSaved }: { onSaved: () => void }) {
  const [date,     setDate]     = useState(todayStr());
  const [miles,    setMiles]    = useState('');
  const [startOdo, setStartOdo] = useState('');
  const [endOdo,   setEndOdo]   = useState('');
  const [platform, setPlatform] = useState('');
  const [category, setCategory] = useState('business');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  // Auto-calculate miles from odometer readings
  useEffect(() => {
    if (startOdo && endOdo) {
      const diff = parseFloat(endOdo) - parseFloat(startOdo);
      if (diff > 0) setMiles(diff.toFixed(1));
    }
  }, [startOdo, endOdo]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!miles) return;
    setSaving(true);
    try {
      const res = await fetch('/api/gig/mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          miles:         parseFloat(miles),
          startOdometer: startOdo ? parseFloat(startOdo) : undefined,
          endOdometer:   endOdo   ? parseFloat(endOdo)   : undefined,
          platform:      platform || undefined,
          category,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setMiles(''); setStartOdo(''); setEndOdo(''); setPlatform('');
        onSaved();
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="field-label">Date</label>
        <input type="date" className="input-field text-sm w-full" value={date}
          onChange={e => setDate(e.target.value)} required />
      </div>
      <div>
        <label className="field-label">Platform</label>
        <select className="input-field text-sm text-slate-600 w-full" value={platform}
          onChange={e => setPlatform(e.target.value)}>
          <option value="">Any</option>
          {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Start odometer</label>
          <input type="number" inputMode="decimal" className="input-field text-sm"
            placeholder="42000" min="0" step="0.1"
            value={startOdo} onChange={e => setStartOdo(e.target.value)} />
        </div>
        <div>
          <label className="field-label">End odometer</label>
          <input type="number" inputMode="decimal" className="input-field text-sm"
            placeholder="42087" min="0" step="0.1"
            value={endOdo} onChange={e => setEndOdo(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="field-label">Miles driven</label>
        <input type="number" inputMode="decimal" className="input-field text-sm"
          placeholder="87.3" min="0.1" max="9999" step="0.1"
          value={miles} onChange={e => setMiles(e.target.value)} required />
      </div>
      <div>
        <label className="field-label">Category</label>
        <div className="flex gap-2">
          {(['business','personal'] as const).map(c => (
            <button key={c} type="button" onClick={() => setCategory(c)}
              className={[
                'flex-1 py-2 rounded-xl text-xs font-black border transition-all',
                category === c
                  ? 'bg-brand-orange text-white border-brand-orange'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
              ].join(' ')}>
              {c === 'business' ? '💼 Business' : '🏠 Personal'}
            </button>
          ))}
        </div>
      </div>
      <button type="submit" disabled={saving || !miles}
        className="w-full py-2.5 rounded-xl bg-slate-800 text-white font-black text-sm
                   disabled:opacity-40 hover:bg-slate-700 active:scale-[0.98] transition-all">
        {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Log Mileage'}
      </button>
    </form>
  );
}

// ── Recent entries list ───────────────────────────────────────────────────────

function RecentFillups({ fillups, onDelete }: { fillups: GigFillup[]; onDelete: (id: string) => void }) {
  if (!fillups.length) return (
    <p className="text-xs text-slate-400 text-center py-3">No fill-ups logged yet.</p>
  );
  return (
    <ul className="space-y-2">
      {fillups.slice(0, 5).map(f => (
        <li key={f.id} className="flex items-center justify-between gap-2 text-xs">
          <div className="flex-1 min-w-0">
            <span className="font-black text-slate-700">{f.date}</span>
            {f.platform && <span className="ml-1.5 text-[10px] text-slate-400 capitalize">{f.platform.replace('_', ' ')}</span>}
            <span className="ml-2 text-slate-500">{f.gallons.toFixed(2)} gal @ ${f.pricePerGallon.toFixed(3)}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-black text-brand-orange">${f.totalCost.toFixed(2)}</span>
            <button onClick={() => onDelete(f.id)}
              className="text-slate-300 hover:text-red-400 transition-colors text-[10px]">✕</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RecentMileage({ entries, onDelete }: { entries: GigMileageEntry[]; onDelete: (id: string) => void }) {
  if (!entries.length) return (
    <p className="text-xs text-slate-400 text-center py-3">No mileage logged yet.</p>
  );
  return (
    <ul className="space-y-2">
      {entries.slice(0, 5).map(m => (
        <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
          <div className="flex-1 min-w-0">
            <span className="font-black text-slate-700">{m.date}</span>
            {m.platform && <span className="ml-1.5 text-[10px] text-slate-400 capitalize">{m.platform.replace('_', ' ')}</span>}
            <span className={`ml-1.5 text-[10px] font-semibold ${m.category === 'business' ? 'text-blue-500' : 'text-slate-400'}`}>
              {m.category === 'business' ? '💼' : '🏠'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="font-black text-slate-700">{m.miles.toFixed(1)} mi</span>
            <button onClick={() => onDelete(m.id)}
              className="text-slate-300 hover:text-red-400 transition-colors text-[10px]">✕</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type View = 'summary' | 'fillup' | 'mileage';

export default function GigDriverTab() {
  const [view,     setView]     = useState<View>('summary');
  const [fillups,  setFillups]  = useState<GigFillup[]>([]);
  const [mileage,  setMileage]  = useState<GigMileageEntry[]>([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, mRes] = await Promise.all([
        fetch('/api/gig/fillups?weeks=4'),
        fetch('/api/gig/mileage?weeks=4'),
      ]);
      const fData = fRes.ok ? await fRes.json() : { fillups: [] };
      const mData = mRes.ok ? await mRes.json() : { entries: [] };
      setFillups(fData.fillups ?? []);
      setMileage(mData.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteFillup(id: string) {
    await fetch(`/api/gig/fillups?id=${id}`, { method: 'DELETE' });
    setFillups(prev => prev.filter(f => f.id !== id));
  }

  async function deleteMileage(id: string) {
    await fetch(`/api/gig/mileage?id=${id}`, { method: 'DELETE' });
    setMileage(prev => prev.filter(m => m.id !== id));
  }

  const stats = calcSummary(fillups, mileage);

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 bg-[#1E2D4A] px-4 py-3.5">
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
            <span className="text-lg leading-none">📦</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-white">Gig Driver Mode</h3>
            <p className="text-[11px] text-white/60 leading-snug mt-0.5">Track fuel and mileage. Keep more of what you earn.</p>
          </div>
        </div>
      </div>

      {/* Weekly summary */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-3">This Week</p>
        {loading ? (
          <p className="text-xs text-slate-400 text-center py-2">Loading…</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Fuel spend',  value: `$${stats.totalSpend.toFixed(2)}` },
              { label: 'Biz miles',   value: stats.totalMiles > 0 ? `${stats.totalMiles.toFixed(0)} mi` : '—' },
              { label: 'Cost/mile',   value: stats.cpm > 0 ? `$${stats.cpm.toFixed(3)}` : '—' },
              { label: 'Avg $/gal',   value: stats.avgPpg > 0 ? `$${stats.avgPpg.toFixed(3)}` : '—' },
              { label: 'Fill-ups',    value: String(stats.fillupCount) },
              { label: 'Gallons',     value: stats.totalGallons > 0 ? stats.totalGallons.toFixed(1) : '—' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-sm font-black text-slate-800">{s.value}</p>
                <p className="text-[9px] text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nav buttons */}
      <div className="flex gap-2">
        {([
          { id: 'fillup',  label: '⛽ Log Fill-Up' },
          { id: 'mileage', label: '🛣️ Log Mileage' },
          { id: 'summary', label: '📋 History' },
        ] as { id: View; label: string }[]).map(btn => (
          <button key={btn.id} onClick={() => setView(btn.id)}
            className={[
              'flex-1 py-2 rounded-xl text-[11px] font-black border transition-all',
              view === btn.id
                ? 'bg-brand-orange text-white border-brand-orange'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
            ].join(' ')}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* Active view */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        {view === 'fillup' && <FillupForm onSaved={load} />}
        {view === 'mileage' && <MileageForm onSaved={load} />}
        {view === 'summary' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-2">Recent Fill-Ups</p>
              <RecentFillups fillups={fillups} onDelete={deleteFillup} />
            </div>
            <div className="border-t border-slate-100 pt-4">
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-2">Recent Mileage</p>
              <RecentMileage entries={mileage} onDelete={deleteMileage} />
            </div>
            <p className="text-[10px] text-slate-400 text-center pt-1">
              Showing last 4 weeks · Tax export coming soon
            </p>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-[9px] text-slate-400 text-center px-2">
        GasCap™ provides organization tools only. Consult a tax professional for deduction advice.
      </p>
    </div>
  );
}
