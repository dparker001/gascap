'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';

interface FillupLoggerProps {
  /** Pre-filled from the calculation result or Find Gas selection */
  prefill: {
    gallonsPumped:      number;
    pricePerGallon:     number;
    vehicleName:        string;
    vehicleId?:         string;
    vehicleOdometer?:   number;
    fuelLevelBefore?:   number;
    stationName?:       string;
    fuelGrade?:         FuelGrade;
    calculatedGallons?: number;  // GasCap's suggested amount — used for breakdown comparison
    tankCapacity?:      number;  // full tank size — used for post-save savings card
  };
  onSaved: () => void;   // called after successful save (to refresh history)
  onCancel: () => void;
  /** Fleet Phase 1 — driver roster. When provided, shows a driver picker. */
  drivers?: string[];
}

export type FuelGrade = 'regular' | 'midgrade' | 'premium' | 'diesel' | 'e85' | '';

type FuelGradeKey = 'gradeRegular' | 'gradeMidGrade' | 'gradePremium' | 'gradeDiesel';
const FUEL_GRADES: { value: FuelGrade; labelKey: FuelGradeKey; sub: string }[] = [
  { value: 'regular',  labelKey: 'gradeRegular',  sub: '87'      },
  { value: 'midgrade', labelKey: 'gradeMidGrade', sub: '89'      },
  { value: 'premium',  labelKey: 'gradePremium',  sub: '91–93'   },
  { value: 'diesel',   labelKey: 'gradeDiesel',   sub: 'diesel'  },
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
  const { t } = useTranslation();

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
  const [stationName,    setStationName]    = useState(prefill.stationName ?? '');
  const [recentStations, setRecentStations] = useState<string[]>([]);
  const [hiddenStations, setHiddenStations] = useState<Set<string>>(new Set());
  const [nearbyStations, setNearbyStations] = useState<{ name: string; address?: string }[]>([]);
  const [detecting,      setDetecting]      = useState(false);
  const [detectMsg,      setDetectMsg]      = useState('');
  const [notes,          setNotes]          = useState('');
  const [driverLabel,    setDriverLabel]    = useState('');
  const [fuelGrade,      setFuelGrade]      = useState<FuelGrade>(prefill.fuelGrade ?? '');
  const [receiptThumb,   setReceiptThumb]   = useState('');   // base64 data URL
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [warnings,       setWarnings]       = useState<string[]>([]);
  const [amountPaid,     setAmountPaid]     = useState('');
  const [savedSummary,   setSavedSummary]   = useState<{ gallons: number; pricePaid: number; saved: number; overfillGal: number } | null>(null);
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

  // Load hidden stations from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('gascap_hidden_stations');
      if (raw) setHiddenStations(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  function forgetStation(name: string) {
    setHiddenStations((prev) => {
      const next = new Set(prev);
      next.add(name);
      try { localStorage.setItem('gascap_hidden_stations', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    setRecentStations((prev) => prev.filter((s) => s !== name));
    if (stationName === name) setStationName('');
  }

  // Fetch recent station names for the picker
  useEffect(() => {
    if (!session) return;
    fetch('/api/fillups/stations')
      .then((r) => r.json())
      .then((d: { stations?: string[] }) => {
        if (d.stations) {
          const hidden = (() => {
            try { return new Set(JSON.parse(localStorage.getItem('gascap_hidden_stations') ?? '[]') as string[]); }
            catch { return new Set<string>(); }
          })();
          setRecentStations(d.stations.filter((s) => !hidden.has(s)));
        }
      })
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
          setScanError(t.fillup.receiptRequiresPro(plan === 'free' ? t.fillup.upgradeToUnlock : ''));
        } else {
          setScanError(data.error ?? t.fillup.scanFailed);
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
      setScanError(t.fillup.networkError);
    } finally {
      setScanning(false);
    }
  }

  // Detect the gas station you're standing at via geolocation → nearby search.
  // Precise GPS is used transiently and rounded to ~110 m before it leaves the
  // device; only the station NAME ever gets stored on the fill-up.
  async function detectStation() {
    setDetecting(true);
    setDetectMsg('');
    let coords: GeolocationCoordinates;
    try {
      coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          { timeout: 10000, maximumAge: 60_000 },
        );
      });
    } catch {
      setDetecting(false);
      setDetectMsg(t.fillup.detectDenied);
      return;
    }

    // Round to 3 decimals (~110 m) — precise enough to find the right station,
    // never pinpoint, and we never persist the coordinates.
    const lat = Math.round(coords.latitude  * 1000) / 1000;
    const lng = Math.round(coords.longitude * 1000) / 1000;

    try {
      const res  = await fetch(`/api/fillups/nearby-stations?lat=${lat}&lng=${lng}`);
      const data = await res.json() as { available?: boolean; stations?: { name: string; address?: string }[] };
      const seen = new Set<string>();
      const stations = (data.stations ?? []).filter((s) => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
      }).slice(0, 5);
      if (stations.length === 0) {
        setDetectMsg(data.available === false ? t.fillup.detectUnavailable : t.fillup.detectNone);
      } else {
        setNearbyStations(stations);
        // Auto-fill the closest if the field is still empty — one less tap.
        setStationName((prev) => prev.trim() ? prev : stations[0].name);
      }
    } catch {
      setDetectMsg(t.fillup.detectNone);
    } finally {
      setDetecting(false);
    }
  }

  async function handleSave(force = false) {
    if (!session) { setError(t.fillup.errSignIn); return; }
    if (!gallons || parseFloat(gallons) <= 0) { setError(t.fillup.errGallons); return; }
    if (!price   || parseFloat(price)   <= 0) { setError(t.fillup.errPrice); return; }

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
          totalCost:       amountPaid && parseFloat(amountPaid) > 0
            ? parseFloat(amountPaid)
            : undefined,
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
        setError(d.error ?? t.fillup.errSaveFailed);
        return;
      }

      window.dispatchEvent(new Event('fillup-saved'));

      // Compute overfill savings and show the confirmation card.
      // Industry average pump overfill is ~0.4 gal; if the user followed GasCap's
      // suggestion closely (within 0.5 gal) we use the avg, otherwise use the delta.
      const pumpedGal = parseFloat(gallons);
      const ppg       = parseFloat(price);
      if (ppg > 0 && pumpedGal > 0 && prefill.calculatedGallons) {
        const AVG_OVERFILL_GAL = 0.4;
        const delta     = Math.abs(pumpedGal - prefill.calculatedGallons);
        const overfill  = delta <= 0.5 ? AVG_OVERFILL_GAL : Math.max(AVG_OVERFILL_GAL, delta);
        const computed  = Math.round(pumpedGal * ppg * 100) / 100;
        const pricePaid = amountPaid && parseFloat(amountPaid) > 0
          ? Math.round(parseFloat(amountPaid) * 100) / 100
          : computed;
        const saved     = Math.round(overfill * ppg * 100) / 100;
        setSavedSummary({ gallons: pumpedGal, pricePaid, saved, overfillGal: overfill });
      } else {
        onSaved();
      }
    } catch {
      setError(t.fillup.networkError);
    } finally {
      setSaving(false);
    }
  }

  // ── Post-save savings confirmation ────────────────────────────────────────
  if (savedSummary) {
    return (
      <div className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-5 space-y-4 animate-fade-in text-center">
        <div>
          <p className="text-3xl mb-1">⛽</p>
          <p className="text-sm font-black text-emerald-800">You saved money today</p>
          <p className="text-[11px] text-emerald-600 mt-0.5">GasCap helped you avoid pump overfill</p>
        </div>

        {/* Big savings number */}
        <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-emerald-100 space-y-3">
          <div>
            <p className="text-4xl font-black text-emerald-600">${savedSummary.saved.toFixed(2)}</p>
            <p className="text-xs font-bold text-emerald-700 mt-0.5">saved at the pump</p>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-1.5 text-left">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">You paid</span>
              <span className="font-bold text-slate-700">${savedSummary.pricePaid.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-500">Typical pump overfill (~{savedSummary.overfillGal.toFixed(1)} gal)</span>
              <span className="font-bold text-amber-600">+${savedSummary.saved.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px] border-t border-slate-100 pt-1.5">
              <span className="font-semibold text-slate-600">Without GasCap</span>
              <span className="font-bold text-slate-700">${(savedSummary.pricePaid + savedSummary.saved).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed px-1">
          Pumps click off a little late — you end up paying for gas that goes into the vapor recovery system, not your tank. GasCap calculated the exact amount so you didn&rsquo;t overpay.
        </p>

        <button
          onClick={onSaved}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⛽</span>
          <div>
            <p className="text-sm font-black text-slate-800">{t.fillup.title}</p>
            <p className="text-[10px] text-slate-500">{prefill.vehicleName}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-black text-amber-600">${totalCost.toFixed(2)}</p>
          <p className="text-[10px] text-slate-400">{t.fillup.estimatedTotal}</p>
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

      {/* Gallons + Price row — at top so the breakdown is immediately visible */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">
            {t.fillup.gallonsLabel}
            {prefill.calculatedGallons && prefill.calculatedGallons > 0 && (
              <span className="ml-1 text-[9px] font-normal text-slate-400">actual pumped</span>
            )}
          </label>
          <div className="relative">
            <input
              type="number" inputMode="decimal"
              className="input-field text-sm pr-9"
              value={gallons}
              min="0.1" step="0.1"
              onChange={(e) => setGallons(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{t.calc.unitGal}</span>
          </div>
        </div>
        <div>
          <label className="field-label">{t.fillup.pricePerGalLabel}</label>
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

      {/* ── Actual amount paid (optional) ──────────────────────────────────── */}
      <div>
        <label className="field-label">
          Amount actually paid <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold pointer-events-none text-sm">$</span>
          <input
            type="number" inputMode="decimal"
            className="input-field text-sm pl-7"
            placeholder={(parseFloat(gallons) > 0 && parseFloat(price) > 0)
              ? (Math.ceil(parseFloat(gallons) * parseFloat(price) * 100) / 100).toFixed(2)
              : '0.00'}
            value={amountPaid}
            min="0.01" step="0.01"
            onChange={(e) => setAmountPaid(e.target.value)}
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-1">
          Enter what you paid at the pump or inside — if different from the calculated total.
        </p>
      </div>

      {/* ── Fill-up breakdown vs. GasCap calculation ───────────────── */}
      {(() => {
        const calcGal = prefill.calculatedGallons;
        if (!calcGal || calcGal <= 0) return null;
        const pumped = parseFloat(gallons) || 0;
        const ppg    = parseFloat(price)   || 0;
        if (pumped <= 0 || ppg <= 0) return null;
        const calcCost = Math.round(calcGal * ppg * 100) / 100;
        const pumpCost = Math.round(pumped  * ppg * 100) / 100;
        const diff     = Math.round((pumped - calcGal) * 100) / 100;
        const onTarget = Math.abs(diff) <= 0.05;
        const overGal  = diff > 0.05 ? diff : 0;
        const underGal = diff < -0.05 ? Math.abs(diff) : 0;
        const overCost = Math.round(overGal  * ppg * 100) / 100;
        return (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2 -mt-1">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide">Fill-up breakdown</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">GasCap suggested</span>
                <span className="text-[11px] font-bold text-slate-700">{calcGal.toFixed(2)} gal · <span className="text-slate-400">${calcCost.toFixed(2)}</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">You pumped</span>
                <span className="text-[11px] font-bold text-slate-700">{pumped.toFixed(2)} gal · <span className="text-slate-400">${pumpCost.toFixed(2)}</span></span>
              </div>
              <div className="border-t border-slate-200 pt-1.5">
                {onTarget && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px]">✓</span>
                    <span className="text-[11px] font-semibold text-emerald-600">On target</span>
                  </div>
                )}
                {overGal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-amber-600 font-semibold">Tank overfill</span>
                    <span className="text-[11px] font-bold text-amber-600">+{overGal.toFixed(2)} gal · +${overCost.toFixed(2)}</span>
                  </div>
                )}
                {underGal > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-blue-500 font-semibold">Under target</span>
                    <span className="text-[11px] font-bold text-blue-500">−{underGal.toFixed(2)} gal · −${Math.round(underGal * ppg * 100) / 100}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Scan receipt section ───────────────────────────────────── */}
      <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black text-slate-700">
              {t.fillup.autoFillTitle}
            </p>
            <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
              {t.fillup.autoFillSub}
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
                <span>{scanning ? t.fillup.readingReceipt : t.fillup.useCamera}</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={saving || scanning}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
              >
                <span>🖼️</span>
                <span>{t.fillup.uploadFromPhotos}</span>
              </button>
            </div>
            {scanError && <p className="text-[11px] text-red-500 font-medium">{scanError}</p>}
            {receiptThumb && !scanning && (
              <p className="text-[10px] text-emerald-600 font-semibold">
                {t.fillup.receiptSaved}
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
        {t.fillup.fillManually}
      </p>

      <div className="border-t border-amber-100" />

      {/* Fleet — driver picker (only shown when driver roster is available) */}
      {drivers.length > 0 && (
        <div>
          <label className="field-label">
            {t.fillup.driverLabel}
            <span className="ml-1 text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{t.garage.fleetBadge}</span>
          </label>
          <select
            value={driverLabel}
            onChange={(e) => setDriverLabel(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">{t.fillup.driverUnassigned}</option>
            {drivers.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      )}

      {/* Date — full width, explicit bottom margin to prevent overlap with gallons grid */}
      <div className="mb-1">
        <label className="field-label">{t.fillup.dateLabel}</label>
        <input
          type="date"
          className="input-field text-base appearance-none min-w-0 w-full [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-w-0"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {/* Price intelligence card */}
      {nationalAvg !== null && (() => {
        const entered = parseFloat(price);
        if (!entered || entered <= 0) return null;
        const delta = nationalAvg - entered;
        if (Math.abs(delta) < 0.005) return (
          <p className="text-[10px] text-slate-400 text-center -mt-1">
            {t.fillup.atNationalAvg(nationalAvg.toFixed(3))}
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
                  ? t.fillup.belowNationalAvg(delta.toFixed(3))
                  : t.fillup.aboveNationalAvg(Math.abs(delta).toFixed(3))}
              </p>
              <p className="text-[9px] text-slate-400 mt-0.5">
                {t.fillup.nationalAvgNote(nationalAvg.toFixed(3))}
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── Fuel Grade picker ───────────────────────────────────────── */}
      <div>
        <label className="field-label">
          {t.fillup.fuelGradeLabel} <span className="text-slate-400 font-normal">{t.fillup.optional}</span>
          {fuelGrade && (
            <span className="ml-1.5 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-100">
              {t.fillup.fromReceipt}
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
              <span className="text-[11px] font-black leading-tight">{t.fillup[g.labelKey]}</span>
              <span className="text-[9px] text-slate-400 leading-tight">{g.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Odometer */}
      <div>
        <label className="field-label">
          {t.fillup.odometerLabel}{' '}
          <span className="text-slate-400 font-normal">{t.fillup.optional}</span>
          {' '}
          <span className="text-[10px] font-bold text-green-600 bg-green-50 rounded px-1 py-0.5">{t.fillup.mpgTrackingTag}</span>
        </label>
        <div className="relative">
          <input
            type="number" inputMode="numeric"
            className={[
              'input-field text-sm pr-10',
              odomIsEst ? 'border-blue-300 bg-blue-50/40' : '',
            ].join(' ')}
            placeholder={t.fillup.odometerPlaceholder}
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
              <span className="font-semibold">{t.fillup.smartEstimate}</span>{' '}
              {t.fillup.smartEstimateBasedOn}{' '}
              <span className="font-semibold">{t.fillup.milesPerDay(odomEst.avgMilesPerDay.toLocaleString())}</span>
              {odomEst.confidence === 'low' && (
                <span className="text-blue-400"> {t.fillup.limitedHistory}</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => { setOdometer(''); setOdomIsEst(false); }}
              className="text-[10px] font-bold text-slate-400 hover:text-red-400 transition-colors flex-shrink-0"
              title={t.fillup.clearEstimateTitle}
            >
              {t.fillup.clearEstimate}
            </button>
          </div>
        )}
      </div>

      {/* Gas Station */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="field-label mb-0">{t.fillup.gasStationLabel} <span className="text-slate-400 font-normal">{t.fillup.optional}</span></label>
          <button
            type="button"
            onClick={detectStation}
            disabled={detecting || saving}
            className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 hover:border-amber-300 transition-colors disabled:opacity-50"
          >
            <span aria-hidden="true">{detecting ? '🔄' : '📍'}</span>
            <span>{detecting ? t.fillup.detecting : t.fillup.detectStation}</span>
          </button>
        </div>
        <input
          id="station-input"
          type="text"
          list="station-suggestions"
          className="input-field text-sm mt-1"
          placeholder={t.fillup.gasStationPlaceholder}
          value={stationName}
          maxLength={60}
          onChange={(e) => setStationName(e.target.value)}
        />
        <datalist id="station-suggestions">
          {[...nearbyStations.map((s) => s.name), ...recentStations].map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {detectMsg && (
          <p className="text-[10px] text-slate-400 mt-1 px-0.5">{detectMsg}</p>
        )}
        {/* Nearby stations from GPS — tap to select */}
        {nearbyStations.length > 0 && (
          <div className="mt-1.5">
            <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wide mb-1">📍 {t.fillup.nearbyStations}</p>
            <div className="flex flex-col gap-1.5">
              {nearbyStations.map((s) => {
                const street = s.address?.split(',')[0] ?? '';
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setStationName((prev) => prev === s.name ? '' : s.name)}
                    className={[
                      'text-left px-2.5 py-1.5 rounded-xl border transition-colors',
                      stationName === s.name
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-700',
                    ].join(' ')}
                  >
                    <p className="text-[10px] font-semibold leading-tight">{s.name}</p>
                    {street && (
                      <p className={`text-[9px] leading-tight mt-0.5 ${stationName === s.name ? 'text-amber-100' : 'text-slate-400'}`}>
                        {street}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* Quick-select chips — top 3 recent stations, with forget (×) */}
        {recentStations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {recentStations.slice(0, 3).map((s) => (
              <div key={s} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setStationName((prev) => prev === s ? '' : s)}
                  className={[
                    'text-[10px] font-semibold pl-2.5 pr-1.5 py-1 rounded-l-full border-y border-l transition-colors',
                    stationName === s
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:text-amber-700',
                  ].join(' ')}
                >
                  {s}
                </button>
                <button
                  type="button"
                  onClick={() => forgetStation(s)}
                  title="Remove from recent stations"
                  className={[
                    'text-[10px] px-1.5 py-1 rounded-r-full border-y border-r transition-colors',
                    stationName === s
                      ? 'bg-amber-500 text-white/70 border-amber-500 hover:text-white'
                      : 'bg-white text-slate-300 border-slate-200 hover:text-red-400 hover:border-red-200',
                  ].join(' ')}
                  aria-label={`Forget ${s}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes — also used for address from receipt scan */}
      <div>
        <label className="field-label">
          {t.fillup.notesLabel} <span className="text-slate-400 font-normal">{t.fillup.optional}</span>
        </label>
        <input
          type="text"
          className="input-field text-sm"
          placeholder={t.fillup.notesPlaceholder}
          value={notes}
          maxLength={160}
          onChange={(e) => setNotes(e.target.value)}
        />
        {notes.startsWith('📍') && (
          <p className="text-[10px] text-blue-500 mt-0.5 px-0.5">{t.fillup.addressCaptured}</p>
        )}
      </div>

      {/* Odometer tip */}
      <p className="text-[10px] text-slate-400 leading-relaxed">
        💡 <span className="font-semibold text-slate-500">{t.fillup.odometerTipLead}</span> {t.fillup.odometerTipBody1}{' '}
        <span className="font-semibold text-amber-600">{t.fillup.odometerTipMpg}</span>.{' '}
        {t.fillup.odometerTipBody2}
      </p>

      {warnings.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" fill="currentColor" aria-hidden="true">
              <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 4.5zm0 7a1 1 0 100-2 1 1 0 000 2z"/>
            </svg>
            <p className="text-[11px] font-black text-amber-700 uppercase tracking-wide">{t.fillup.headsUp}</p>
          </div>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800 leading-snug">{w}</p>
          ))}
          <p className="text-[10px] text-amber-600 font-semibold mt-1">
            {t.fillup.saveAnywayHint1} <strong>{t.fillup.saveAnywayQuoted}</strong> {t.fillup.saveAnywayHint2}
          </p>
        </div>
      )}
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-semibold text-slate-500 hover:border-slate-300 transition-colors bg-white"
        >
          {t.fillup.cancel}
        </button>
        <button
          onClick={() => handleSave(forceConfirm)}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold disabled:opacity-50 transition-colors"
        >
          {saving ? t.fillup.saving : forceConfirm ? t.fillup.saveAnyway : t.fillup.saveFillup}
        </button>
      </div>
    </div>
  );
}
