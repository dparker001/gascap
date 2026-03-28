'use client';

import { useState, useRef } from 'react';
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
}

export default function FillupLogger({ prefill, onSaved, onCancel }: FillupLoggerProps) {
  const { data: session } = useSession();

  const today = new Date().toISOString().split('T')[0];

  const [date,           setDate]           = useState(today);
  const [gallons,        setGallons]        = useState(String(prefill.gallonsPumped));
  const [price,          setPrice]          = useState(String(prefill.pricePerGallon));
  const [odometer,       setOdometer]       = useState(
    prefill.vehicleOdometer != null ? String(prefill.vehicleOdometer) : ''
  );
  const [notes,          setNotes]          = useState('');
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [warnings,     setWarnings]     = useState<string[]>([]);
  const [forceConfirm, setForceConfirm] = useState(false);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalCost = (parseFloat(gallons) * parseFloat(price)) || 0;

  async function handleScan(file: File) {
    setScanning(true);
    setScanError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/fillups/scan', { method: 'POST', body: fd });
      const data = await res.json() as {
        gallons?:       number | null;
        pricePerGallon?: number | null;
        totalCost?:     number | null;
        date?:          string | null;
        stationName?:   string | null;
        error?:         string;
        upgrade?:       boolean;
      };
      if (!res.ok) {
        if (res.status === 403 && data.upgrade) {
          setScanError('Receipt scanning requires Pro. Upgrade to unlock.');
        } else {
          setScanError(data.error ?? 'Scan failed.');
        }
        return;
      }
      if (data.gallons       != null) setGallons(String(data.gallons));
      if (data.pricePerGallon != null) setPrice(String(data.pricePerGallon));
      if (data.date           != null) setDate(data.date);
      if (data.stationName    != null) setNotes(data.stationName);
    } catch {
      setScanError('Network error — try again.');
    } finally {
      setScanning(false);
    }
  }

  async function handleSave(force = false) {
    if (!session) { setError('Sign in to log fillups.'); return; }
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
          notes:           notes.trim() || undefined,
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
            <p className="text-sm font-black text-slate-800">Log This Fillup</p>
            <p className="text-[10px] text-slate-500">{prefill.vehicleName}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-black text-amber-600">${totalCost.toFixed(2)}</p>
          <p className="text-[10px] text-slate-400">estimated total</p>
        </div>
      </div>

      {/* Hidden file input for receipt scanning */}
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

      {/* Scan receipt section */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving || scanning}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
          >
            <span>{scanning ? '🔄' : '📷'}</span>
            <span>{scanning ? 'Scanning…' : 'Scan Receipt'}</span>
          </button>
          <span className="text-[10px] text-amber-600 font-bold bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">PRO</span>
          <span className="text-[10px] text-slate-400 ml-auto">or fill in manually below</span>
        </div>
        {scanError && <p className="text-[11px] text-red-500 font-medium">{scanError}</p>}
      </div>

      <div className="border-t border-amber-100" />

      {/* Date + Gallons row */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Date</label>
          <input
            type="date"
            className="input-field text-sm"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Gallons pumped</label>
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className="input-field text-sm pr-10"
              value={gallons}
              min="0.1" step="0.1"
              onChange={(e) => setGallons(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">gal</span>
          </div>
        </div>
      </div>

      {/* Price + Odometer row */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Price / gallon</label>
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
        <div>
          <label className="field-label">Odometer <span className="text-[10px] font-bold text-green-600 bg-green-50 rounded px-1 py-0.5">MPG tracking</span></label>
          <div className="relative">
            <input
              type="number" inputMode="numeric"
              className="input-field text-sm pr-10"
              placeholder="e.g. 42500"
              value={odometer}
              min="0" step="1"
              onChange={(e) => setOdometer(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">mi</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="field-label">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
        <input
          type="text"
          className="input-field text-sm"
          placeholder='e.g. "Shell on Main St"'
          value={notes}
          maxLength={100}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Odometer tip */}
      <p className="text-[10px] text-slate-400 leading-relaxed">
        💡 Add your odometer reading each fillup to unlock <span className="font-semibold text-amber-600">MPG tracking</span>.
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
          {saving ? 'Saving…' : forceConfirm ? 'Save Anyway ✓' : 'Save Fillup ✓'}
        </button>
      </div>
    </div>
  );
}
