'use client';

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { compressImageForUpload } from '@/lib/imageUtils';

interface VinResult {
  vin:      string;
  make:     string;
  model:    string;
  year:     string;
  trim:     string | null;
  tankEst?: number | null;
}

interface RentalVinLookupProps {
  /** Fired once the VIN decodes to an EPA tank estimate. */
  onTankSize: (gallons: string, label: string) => void;
  /** Optional — fired alongside onTankSize with the structured fields, for
   *  callers (like the Rental Return Assistant setup flow) that need
   *  separate year/make/model/trim rather than just a combined label. */
  onVehicleResolved?: (details: { year: string; make: string; model: string; trim?: string; tankEst: number }) => void;
}

/**
 * Scan or type the rental car's VIN (dash / door jamb sticker — same as any
 * owned car) to resolve the exact trim's tank size. More accurate than the
 * Year/Make/Model dropdown since a VIN pins the exact configuration instead
 * of asking the renter to pick from a trim list. No "save to garage"
 * semantics — this only ever fills the rental calculator's tank size.
 */
export default function RentalVinLookup({ onTankSize, onVehicleResolved }: RentalVinLookupProps) {
  const { t } = useTranslation();
  const [vin,       setVin]       = useState('');
  const [state,     setState]     = useState<'idle' | 'loading' | 'found' | 'error'>('idle');
  const [errorMsg,  setErrorMsg]  = useState('');
  const [scanning,  setScanning]  = useState(false);
  const [scanError, setScanError] = useState('');
  // Confirmation shown at the point of the scan/decode — the tank-size field
  // above updates too, but that's easy to miss; this is the "yes, it worked" moment.
  const [foundVehicle, setFoundVehicle] = useState<{ label: string; tank: string } | null>(null);

  const vinClean  = vin.trim().toUpperCase();
  const vinValid  = /^[A-HJ-NPR-Z0-9]{17}$/.test(vinClean);
  const vinLength = vinClean.length;

  async function handleVinScan(file: File) {
    setScanning(true);
    setScanError('');
    try {
      const compressed = await compressImageForUpload(file);
      const fd = new FormData();
      fd.append('image', compressed, 'vin.jpg');
      const res  = await fetch('/api/vin/scan', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as { vin?: string | null; error?: string };
      if (!res.ok || data.error) { setScanError(data.error ?? t.vehiclePicker.scanCouldNotRead); return; }
      if (!data.vin) { setScanError(t.vehiclePicker.scanNoVin); return; }
      setVin(data.vin);
    } catch {
      setScanError(t.vehiclePicker.scanNetworkError);
    } finally {
      setScanning(false);
    }
  }

  async function handleLookup() {
    if (!vinValid) return;
    setState('loading');
    setErrorMsg('');
    try {
      const res  = await fetch(`/api/vin?vin=${vinClean}`);
      const data = await res.json() as VinResult & { error?: string };
      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? t.vehiclePicker.vinLookupFailed);
        setState('error');
        return;
      }
      setState('found');
      const label = `${data.year} ${data.make} ${data.model}${data.trim ? ' ' + data.trim : ''}`;
      if (data.tankEst != null) {
        onTankSize(String(data.tankEst), label);
        onVehicleResolved?.({ year: data.year, make: data.make, model: data.model, trim: data.trim ?? undefined, tankEst: data.tankEst });
        setFoundVehicle({ label, tank: String(data.tankEst) });
      } else {
        // Fallback: try a separate EPA lookup if the VIN API's internal EPA lookup failed
        const qs = new URLSearchParams({ action: 'lookup', year: data.year, make: data.make, model: data.model });
        const epaRes = await fetch(`/api/fueleconomy?${qs}`);
        if (epaRes.ok) {
          const epa = await epaRes.json() as { tankEst?: number | null };
          if (epa.tankEst) {
            onTankSize(String(epa.tankEst), label);
            onVehicleResolved?.({ year: data.year, make: data.make, model: data.model, trim: data.trim ?? undefined, tankEst: epa.tankEst });
            setFoundVehicle({ label, tank: String(epa.tankEst) });
          }
        }
      }
    } catch {
      setErrorMsg(t.vehiclePicker.vinNetworkError);
      setState('error');
    }
  }

  const lenColor = vinLength === 0 ? 'text-slate-300'
    : vinLength === 17 && vinValid ? 'text-green-600'
    : vinLength > 17 ? 'text-red-500'
    : 'text-amber-500';

  return (
    <div className="space-y-2 mt-3 pt-3 border-t border-blue-100">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-blue-700">{t.rentalLookup.vinTitle}</p>
        <label
          className={[
            'flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50',
            'border border-amber-200 rounded-lg px-2 py-1 hover:bg-amber-100 transition-colors',
            scanning ? 'opacity-50 pointer-events-none' : 'cursor-pointer',
          ].join(' ')}
        >
          <input
            type="file" accept="image/*" className="hidden" disabled={scanning}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleVinScan(f);
              e.target.value = '';
            }}
          />
          <span>{scanning ? '🔄' : '📷'}</span>
          <span>{scanning ? t.vehiclePicker.scanning : t.vehiclePicker.scanVin}</span>
        </label>
      </div>

      {scanError && <p className="text-[11px] text-red-500 font-medium">{scanError}</p>}

      <div className="relative">
        <input
          type="text"
          className="input-field text-xs font-mono tracking-wider pr-14"
          placeholder="e.g. 1HGCM82633A123456"
          value={vin}
          maxLength={17}
          onChange={(e) => {
            setVin(e.target.value.replace(/[\s-]/g, '').toUpperCase());
            setState('idle');
            setFoundVehicle(null);
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold pointer-events-none ${lenColor}`}>
          {vinLength}/17
        </span>
      </div>

      <button
        onClick={handleLookup}
        disabled={!vinValid || state === 'loading'}
        className="w-full py-2 rounded-xl border-2 border-amber-400 text-xs font-bold
                   text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
      >
        {state === 'loading' ? t.vehiclePicker.decodingVin : t.vehiclePicker.decodeVin}
      </button>

      {state === 'error' && (
        <p className="text-[11px] text-red-600 font-semibold">❌ {errorMsg}</p>
      )}

      {state === 'found' && foundVehicle && (
        <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
          <span className="text-base flex-shrink-0" aria-hidden="true">✅</span>
          <p className="text-[11px] text-emerald-700 leading-snug">
            <span className="font-black block">{t.rentalLookup.vinFoundTitle(foundVehicle.label)}</span>
            {t.rentalLookup.vinFoundTank(foundVehicle.tank)}
          </p>
        </div>
      )}
    </div>
  );
}
