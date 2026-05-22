'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface FillupLoggerProps {
  /** Pre-filled from the calculation result */
  prefill: {
    gallonsPumped:    number;
    pricePerGallon:   number;
    vehicleName:      string;
    vehicleId?:       string;
    vehicleOdometer?: number;   // from vehicle's stored currentOdometer — used as first-fillup baseline
    fuelLevelBefore?: number;
  };
  onSaved: () => void;   // called after successful save (to refresh history)
  onCancel: () => void;
  /** Fleet Phase 1 — driver roster. When provided, shows a driver picker. */
  drivers?: string[];
}

type FuelGrade = 'regular' | 'midgrade' | 'premium' | 'diesel' | 'e85' | '';

const FUEL_GRADES: { value: FuelGrade; label: string; sub: string }[] = [
  { value: 'regular',  label: 'Regular',   sub: '87'      },
  { value: 'midgrade', label: 'Mid-Grade',  sub: '89'      },
  { value: 'premium',  label: 'Premium',    sub: '91–93'   },
  { value: 'diesel',   label: 'Diesel',     sub: 'diesel'  },
];

/** Compress an image File to a small JPEG thumbnail (max 320px wide, 0.55 quality) */
async function compressImage(file: File): Promise<string> {
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

export default function FillupLogger({ prefill, onSaved, onCancel, drivers = [] }: FillupLoggerProps) {
  const { data: session } = useSession();

  const today = new Date().toISOString().split('T')[0];

  const [date,           setDate]           = useState(today);
  const [gallons,        setGallons]        = useState(String(prefill.gallonsPumped));
  const [price,          setPrice]          = useState(String(prefill.pricePerGallon));
  const [odometer,       setOdometer]       = useState(
    prefill.vehicleOdometer != null ? String(prefill.vehicleOdometer) : ''
  );
  // Smart odometer estimate — computed from fill-up history
  const [odomEst,        setOdomEst]        = useState<{
    value:          number;
    avgMilesPerDay: number;
    confidence:     'high' | 'low';
  } | null>(null);
  // True while the odometer field still shows the auto-estimated value
  const [odomIsEst,      setOdomIsEst]      = useState(false);
  const [stationName,    setStationName]    = useState('');
  const [recentStations, setRecentStations] = useState<string[]>([]);
  const [notes,          setNotes]          = useState('');
  const [driverLabel,    setDriverLabel]    = useState('');
  const [fuelGrade,      setFuelGrade]      = useState<FuelGrade>('');
  const [receiptThumb,   setReceiptThumb]   = useState('');   // base64 data URL
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [warnings,     setWarnings]     = useState<string[]>([]);
  const [forceConfirm, setForceConfirm] = useState(false);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState('');
  const [nationalAvg,  setNationalAvg]  = useState<number | null>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Fetch national average once for inline price intelligence card
  useEffect(() => {
    fetch('/api/gas-price/national')
      .then((r) => r.ok ? r.json() as Promise<{ price: number | null }> : Promise.reject())
      .then((d) => { if (d.price !== null) setNationalAvg(d.price); })
      .catch(() => {});
  }, []);

  // Fetch live plan from server — session JWT can be stale after an upgrade
  const [livePlan, setLivePlan] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch('/api/vehicles')
      .then((r) => r.json())
      .then((d: { plan?: string }) => {
        if (d.plan) setLivePlan(d.plan);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Fetch smart odometer estimate from fill-up history
  useEffect(() => {
    if (!session || !prefill.vehicleId) return;
    fetch(`/api/vehicles/odometer-estimate?vehicleId=${prefill.vehicleId}`)
      .then((r) => r.json())
      .then((d: {
        confidence:       'none' | 'low' | 'high';
        estimatedOdometer?: number;
        avgMilesPerDay?:    number;
      }) => {
        if ((d.confidence === 'high' || d.confidence === 'low') && d.estimatedOdometer) {
          setOdomEst({
            value:          d.estimatedOdometer,
            avgMilesPerDay: d.avgMilesPerDay ?? 0,
            confidence:     d.confidence,
          });
          // Pre-fill the field only if user hasn't already typed something
          setOdometer((prev) => {
            // Don't overwrite a value the user may have entered manually;
            // only set if still blank or equal to the vehicle baseline
            const baseline = prefill.vehicleOdometer != null ? String(prefill.vehicleOdometer) : '';
            if (prev === '' || prev === baseline) {
              setOdomIsEst(true);
              return String(d.estimatedOdometer);
            }
            return prev;
          });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Fetch recent station names for the picker
  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups/stations')
      .then((r) => r.json())
      .then((d: { stations?: string[] }) => { if (d.stations) setRecentStations(d.stations); })
      .catch(() => {});
  }, [session]);

  const plan      = livePlan ?? session?.user?.plan ?? 'free';
  const isPro     = plan === 'pro' || plan === 'fleet';
  const planBadge = plan === 'fleet' ? 'FLEET' : 'PRO';

  const totalCost = (parseFloat(gallons) * parseFloat(price)) || 0;

  async function handleScan(file: File) {
    setScanning(true);
    setScanError('');
    // Compress first so we have a thumbnail regardless of scan outcome
    let thumb = '';
    try {
      thumb = await compressImage(file);
      setReceiptThumb(thumb);
    } catch { /* canvas not available — continue without thumbnail */ }

    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/fillups/scan', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as {
        gallons?:        number | null;
        pricePerGallon?: number | null;
        totalCost?:      number | null;
        date?:           string | null;
        stationName?:    string | null;
        address?:        string | null;
        fuelGrade?:      string | null;
        error?:          string;
        upgrade?:        boolean;
      };
      if (!res.ok) {
        if (res.status === 403 && data.upgrade) {
          setScanError(`Receipt scanning requires Pro${plan === 'free' ? ' — upgrade to unlock' : ''}.`);
        } else {
          setScanError(data.error ?? 'Scan failed.');
        }
        return;
      }
      if (data.gallons        != null) setGallons(String(data.gallons));
      if (data.pricePerGallon != null) setPrice(String(data.pricePerGallon));
      if (data.date           != null) setDate(data.date);
      if (data.stationName    != null) setStationName(data.stationName);
      // Address → pre-fill notes (prefix so user knows it came from the receipt)
      if (data.address        != null && data.address.trim()) {
        setNotes((prev) => prev ? prev : `📍 ${data.address!.trim()}`);
      }
      // Fuel grade — map to our enum
      if (data.fuelGrade != null) {
        const g = data.fuelGrade as FuelGrade;
        if (['regular','midgrade','premium','diesel','e85'].includes(g)) setFuelGrade(g);
      }
    } catch {
      setScanError('Network error — try again.');
    } finally {
      setScanning(false);
    }
  }

  async function handleSave(force = false) {
    if (!session) { setError('Sign in to log fill-ups.'); return; }
    if (!gallons || parseFloat(gallons) <= 0) { setError('Enter valid gallons.'); return; }
    if (!price   || parseFloat(price)   <= 0) { setError('Enter valid price.'); return; }

    setSaving(true);
    setError('');
    setWarnings([]);
    try {
      const res = await fetch('/api/fillups', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          vehicleName:     prefill.vehicleName,
          vehicleId:       prefill.vehicleId,
          date,
          gallonsPumped:   parseFloat(gallons),
          pricePerGallon:  parseFloat(price),
          odometerReading: odometer ? parseInt(odometer, 10) : undefined,
          fuelLevelBefore: prefill.fuelLevelBefore,
          stationName:     stationName.trim() || undefined,
          notes:           notes.trim() || undefined,
          driverLabel:     driverLabel.trim() || undefined,
          fuelGrade:       fuelGrade || undefined,
          receiptThumb:    receiptThumb || undefined,
          force,
        }),
      });

      if (res.status === 409) {
        // Soft warnings — show and let user confirm
        const d = await res.json() as { allWarnings: string[]; canOverride: boolean };
        setWarnings(d.allWarnings ?? []);
        setForceConfirm(true);
        return;
      }

      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Save failed.');
        return;
      }

      window.dispatchEvent(new Event('fillup-saved'));
      onSaved();
    } catch {
      setError('Network error — try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⛽</span>
          <div>
            <p className="text-sm font-black text-slate-800">Log This Fill-Up</p>
            <p className="text-[10px] text-slate-500">{prefill.vehicleName}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-black text-amber-600">${totalCost.toFixed(2)}</p>
          <p className="text-[10px] text-slate-400">estimated total</p>
        </div>
      </div>

      {/* Hidden file inputs — camera and gallery */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleScan(f);
          e.target.value = '';
        }}
      />
      <input
        type="file"
        accept="image/*"
        ref={galleryInputRef}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleScan(f);
          e.target.value = '';
        }}
      />

      {/* ── Scan receipt section ───────────────────────────────────── */}
      <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black text-slate-700">
              ✨ Auto-fill from your receipt
            </p>
            <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
              AI reads gallons, price, station &amp; fuel grade — review before saving.
            </p>
          </div>
          <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 flex-shrink-0 ${isPro ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-amber-600 bg-amber-50 border-amber-200'}`}>
            {planBadge}
          </span>
        </div>

        {/* Scan buttons + receipt thumbnail */}
        <div className="flex items-start gap-3">
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving || scanning}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
              >
                <span>{scanning ? '🔄' : '📷'}</span>
                <span>{scanning ? 'Reading receipt…' : 'Use Camera'}</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={saving || scanning}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
              >
                <span>🖼️</span>
                <span>Upload from Photos</span>
              </button>
            </div>
            {scanError && <p className="text-[11px] text-red-500 font-medium">{scanError}</p>}
            {receiptThumb && !scanning && (
              <p className="text-[10px] text-emerald-600 font-semibold">
                ✓ Receipt photo saved with this fill-up
              </p>
            )}
          </div>

          {/* Receipt thumbnail preview */}
          {receiptThumb && (
            <div className="flex-shrink-0 relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receiptThumb}
                alt="Receipt preview"
                className="w-14 h-20 object-cover rounded-lg border border-slate-200 shadow-sm"
              />
              <button
                type="button"
                onClick={() => setReceiptThumb('')}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-600 text-white flex items-center justify-center"
                aria-label="Remove receipt photo"
              >
                <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 -mt-1 px-0.5">
        Or fill in the fields manually below ↓
      </p>

      <div className="border-t border-amber-100" />

      {/* Fleet — driver picker (only shown when driver roster is available) */}
      {drivers.length > 0 && (
        <div>
          <label className="field-label">
            Driver
            <span className="ml-1 text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">FLEET</span>
          </label>
          <select
            value={driverLabel}
            onChange={(e) => setDriverLabel(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">— Unassigned —</option>
            {drivers.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {/* Date — full width, explicit bottom margin to prevent overlap with gallons grid */}
      <div className="mb-1">
        <label className="field-label">Date</label>
        <input
          type="date"
          className="input-field text-base"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {/* Gallons + Price row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Gallons</label>
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className="input-field text-sm pr-9"
              value={gallons}
              min="0.1" step="0.1"
              onChange={(e) => setGallons(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">gal</span>
          </div>
        </div>
        <div>
          <label className="field-label">Price / gal</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none text-sm">$</span>
            <input
              type="number" inputMode="decimal"
              className="input-field text-sm pl-7"
              value={price}
              min="0.01" step="0.01"
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Price intelligence card */}
      {nationalAvg !== null && (() => {
        const entered = parseFloat(price);
        if (!entered || entered <= 0) return null;
        const delta = nationalAvg - entered;
        if (Math.abs(delta) < 0.005) return (
          <p className="text-[10px] text-slate-400 text-center -mt-1">
            📊 Right at the national average (${nationalAvg.toFixed(3)}/gal)
          </p>
        );
        const saved = delta > 0;
        return (
          <div className={[
            'rounded-xl px-3 py-2.5 flex items-center gap-2.5 -mt-1',
            saved ? 'bg-emerald-50 border border-emerald-100' : 'bg-amber-50 border border-amber-100',
          ].join(' ')}>
            <span className="text-base flex-shrink-0" aria-hidden="true">{saved ? '🎉' : '📈'}</span>
            <div className="min-w-0">
              <p className={[
                'text-[11px] font-black leading-tight',
                saved ? 'text-emerald-700' : 'text-amber-700',
              ].join(' ')}>
                {saved
                  ? `$${delta.toFixed(3)}/gal below national avg — great deal!`
                  : `$${Math.abs(delta).toFixed(3)}/gal above national avg`}
              </p>
              <p className="text-[9px] text-slate-400 mt-0.5">
                EIA national avg: ${nationalAvg.toFixed(3)}/gal (updated weekly)
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── Fuel Grade picker ───────────────────────────────────────── */}
      <div>
        <label className="field-label">
          Fuel Grade <span className="text-slate-400 font-normal">(optional)</span>
          {fuelGrade && (
            <span className="ml-1.5 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100">
              from receipt
            </span>
          )}
        </label>
        <div className="grid grid-cols-4 gap-1.5 mt-1">
          {FUEL_GRADES.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setFuelGrade((prev) => prev === g.value ? '' : g.value)}
              className={[
                'flex flex-col items-center justify-center rounded-xl border-2 py-2 transition-all',
                fuelGrade === g.value
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
              ].join(' ')}
            >
              <span className="text-[11px] font-black leading-tight">{g.label}</span>
              <span className="text-[9px] text-slate-400 leading-tight">{g.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Odometer */}
      <div>
        <label className="field-label">
          Odometer{' '}
          <span className="text-slate-400 font-normal">(optional)</span>
          {' '}
          <span className="text-[10px] font-bold text-green-600 bg-green-50 rounded px-1 py-0.5">MPG tracking</span>
        </label>
        <div className="relative">
          <input
            type="number" inputMode="numeric"
            className={[
              'input-field text-sm pr-10',
              odomIsEst ? 'border-blue-300 bg-blue-50/40' : '',
            ].join(' ')}
            placeholder="e.g. 42500 — skip if you don't track every fill-up"
            value={odometer}
            min="0" step="1"
            onChange={(e) => {
              setOdometer(e.target.value);
              setOdomIsEst(false);   // user took over — clear the estimate flag
            }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mi</span>
        </div>
        {/* Smart estimate hint — shown while the field holds the auto-filled value */}
        {odomIsEst && odomEst && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-[10px] text-blue-600 leading-snug">
              {odomEst.confidence === 'high' ? '🔮' : '〜'}{' '}
              <span className="font-semibold">Smart estimate</span>{' '}
              based on your avg{' '}
              <span className="font-semibold">{odomEst.avgMilesPerDay.toLocaleString()} mi/day</span>
              {odomEst.confidence === 'low' && (
                <span className="text-blue-400"> · limited history</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => { setOdometer(''); setOdomIsEst(false); }}
              className="text-[10px] font-bold text-slate-400 hover:text-red-400 transition-colors flex-shrink-0"
              title="Clear estimate and enter manually"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Gas Station */}
      <div>
        <label className="field-label">⛽ Gas Station <span className="text-slate-400 font-normal">(optional)</span></label>
        <input
          id="station-input"
          type="text"
          list="station-suggestions"
          className="input-field text-sm"
          placeholder="e.g. Shell, Chevron, BP…"
          value={stationName}
          maxLength={60}
          onChange={(e) => setStationName(e.target.value)}
        />
        <datalist id="station-suggestions">
          {recentStations.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {/* Quick-select chips — top 3 recent stations */}
        {recentStations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {recentStations.slice(0, 3).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStationName((prev) => prev === s ? '' : s)}
                className={[
                  'text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors',
                  stationName === s
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:text-amber-700',
                ].join(' ')}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notes — also used for address from receipt scan */}
      <div>
        <label className="field-label">
          Notes <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          className="input-field text-sm"
          placeholder="Address, notes, anything else…"
          value={notes}
          maxLength={160}
          onChange={(e) => setNotes(e.target.value)}
        />
        {notes.startsWith('📍') && (
          <p className="text-[10px] text-blue-500 mt-0.5 px-0.5">📋 Station address captured from receipt</p>
        )}
      </div>

      {/* Odometer tip */}
      <p className="text-[10px] text-slate-400 leading-relaxed">
        💡 <span className="font-semibold text-slate-500">Optional:</span> Log your odometer on every fill-up to unlock{' '}
        <span className="font-semibold text-amber-600">real-world MPG tracking</span>.{' '}
        After 4 consecutive fill-ups with odometer readings, your personal avg MPG will appear in the Trip Planner.
        Skip it if you don&apos;t track every fill-up — the app uses EPA estimates instead.
      </p>

      {warnings.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" fill="currentColor" aria-hidden="true">
              <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 4.5zm0 7a1 1 0 100-2 1 1 0 000 2z"/>
            </svg>
            <p className="text-[11px] font-black text-amber-700 uppercase tracking-wide">Heads up</p>
          </div>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800 leading-snug">{w}</p>
          ))}
          <p className="text-[10px] text-amber-600 font-semibold mt-1">
            Tap <strong>&quot;Save Anyway&quot;</strong> if this looks correct.
          </p>
        </div>
      )}
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-500 hover:border-slate-300 transition-colors bg-white"
        >
          Cancel
        </button>
        <button
          onClick={() => handleSave(forceConfirm)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : forceConfirm ? 'Save Anyway ✓' : 'Save Fill-Up ✓'}
        </button>
      </div>
    </div>
  );
}
