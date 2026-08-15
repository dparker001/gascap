'use client';

/**
 * Multi-step setup for a new Rental Return Assistant session (Level 1 —
 * ManualRentalDataProvider). Company → Vehicle → Pickup fuel → Return
 * requirement → Rate → Return location/time → create.
 */

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { RENTAL_COMPANIES, gallonsFromGaugeFraction, gallonsFromPercent } from '@/lib/rentalProvider';
import type { FuelDataSource } from '@/lib/rentalProvider';
import type { ReturnPolicyType } from '@/lib/rentalCalculations';
import RentalVehicleLookup from '@/components/RentalVehicleLookup';
import RentalVinLookup from '@/components/RentalVinLookup';
import ReturnLocationInput from './ReturnLocationInput';

const GAUGE_OPTIONS = ['Full', '7/8', '3/4', '5/8', '1/2', '3/8', '1/4', '1/8', 'Empty'];

interface Props {
  onCreated: (sessionId: string) => void;
  onCancel:  () => void;
}

type FuelInputMethod = 'gauge' | 'percent' | 'gallons';

export default function RentalSetupFlow({ onCreated, onCancel }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [rentalCompany, setRentalCompany] = useState('');
  const [customCompany, setCustomCompany] = useState('');

  // Step 2 — lookup is the primary path (know-exact-car, matches the
  // calculator's proven UX); manual entry is the fallback for renters who
  // don't know the exact trim or whose vehicle isn't in EPA's database.
  const [vehicleEntryMode, setVehicleEntryMode] = useState<'lookup' | 'manual'>('lookup');
  const [vehicleYear,  setVehicleYear]  = useState('');
  const [vehicleMake,  setVehicleMake]  = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleTrim,  setVehicleTrim]  = useState('');
  const [tankCapacity, setTankCapacity] = useState('');
  const [vehicleResolvedLabel, setVehicleResolvedLabel] = useState('');

  function handleVehicleResolved(details: { year: string; make: string; model: string; trim?: string; tankEst: number }) {
    setVehicleYear(details.year);
    setVehicleMake(details.make);
    setVehicleModel(details.model);
    if (details.trim) setVehicleTrim(details.trim);
    setTankCapacity(String(details.tankEst));
    setVehicleResolvedLabel(`${details.year} ${details.make} ${details.model}${details.trim ? ' ' + details.trim : ''}`);
  }

  // Step 3 — pickup fuel
  const [pickupMethod, setPickupMethod] = useState<FuelInputMethod>('gauge');
  const [pickupGauge,  setPickupGauge]  = useState('Full');
  const [pickupPercent, setPickupPercent] = useState('');
  const [pickupGallons, setPickupGallons] = useState('');

  // Step 4 — return requirement
  const [returnPolicy, setReturnPolicy] = useState<ReturnPolicyType>('same_as_pickup');
  const [exactReturnGallons, setExactReturnGallons] = useState('');

  // Step 5 — rate
  const [rentalRate, setRentalRate] = useState('');

  // Step 6 — return location/time
  const [returnLocation, setReturnLocation] = useState('');
  const [returnCoords, setReturnCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [returnDateTime, setReturnDateTime] = useState('');

  const company = rentalCompany === 'Other' ? customCompany.trim() : rentalCompany;

  function resolvePickupFuel(): { gallons: number | null; source: FuelDataSource | null } {
    const tank = Number(tankCapacity) || 0;
    if (pickupMethod === 'gauge') {
      const g = gallonsFromGaugeFraction(pickupGauge, tank);
      return { gallons: g, source: 'MANUAL_GAUGE' };
    }
    if (pickupMethod === 'percent') {
      const pct = Number(pickupPercent);
      const g = gallonsFromPercent(pct, tank);
      return { gallons: g, source: 'MANUAL_PERCENT' };
    }
    const g = Number(pickupGallons);
    return { gallons: g > 0 ? g : null, source: 'MANUAL_GALLONS' };
  }

  const canNext1 = !!company;
  const canNext2 = !!vehicleMake.trim() && !!vehicleModel.trim() && Number(tankCapacity) > 0;
  const pickupPreview = resolvePickupFuel();
  const canNext3 = pickupPreview.gallons != null;
  const canNext4 = returnPolicy !== 'exact' || Number(exactReturnGallons) > 0;
  const canSubmit = !!returnDateTime;

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const pickup = resolvePickupFuel();
      const res = await fetch('/api/rental-sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalCompany: company,
          vehicleYear: vehicleYear || undefined,
          vehicleMake, vehicleModel,
          vehicleTrim: vehicleTrim || undefined,
          fuelTankCapacityGallons: Number(tankCapacity),
          pickupFuelGallons: pickup.gallons,
          pickupFuelSource: pickup.source,
          requiredReturnPolicyType: returnPolicy,
          requiredReturnFuelGallons: returnPolicy === 'exact' ? Number(exactReturnGallons) : undefined,
          rentalFuelChargePerGallon: rentalRate ? Number(rentalRate) : undefined,
          returnLocation: returnLocation || undefined,
          returnLatitude: returnCoords?.lat,
          returnLongitude: returnCoords?.lng,
          returnDateTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? t.rentalReturn.setupError); return; }
      onCreated(data.session.id);
    } catch {
      setError(t.rentalReturn.setupError);
    } finally {
      setSubmitting(false);
    }
  }

  const stepTitles = [
    t.rentalReturn.stepCompany, t.rentalReturn.stepVehicle, t.rentalReturn.stepPickupFuel,
    t.rentalReturn.stepReturnReq, t.rentalReturn.stepRate, t.rentalReturn.stepReturnDetails,
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          {t.rentalReturn.stepOf(step, 6)} · {stepTitles[step - 1]}
        </p>
        <button onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600">
          {t.rentalReturn.cancel}
        </button>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-[#005F4A] transition-all duration-300" style={{ width: `${(step / 6) * 100}%` }} />
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}

      {/* Step 1 — Rental company */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {RENTAL_COMPANIES.map((c) => (
              <button
                key={c}
                onClick={() => setRentalCompany(c)}
                className={`py-3 rounded-xl text-sm font-bold border transition-colors ${
                  rentalCompany === c ? 'bg-[#005F4A] text-white border-[#005F4A]' : 'bg-white border-slate-200 text-slate-700 hover:border-[#005F4A]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {rentalCompany === 'Other' && (
            <input
              type="text" placeholder={t.rentalReturn.otherCompanyPlaceholder}
              value={customCompany} onChange={(e) => setCustomCompany(e.target.value)}
              className="input-field"
            />
          )}
        </div>
      )}

      {/* Step 2 — Vehicle */}
      {step === 2 && (
        <div className="space-y-3">
          {vehicleEntryMode === 'lookup' ? (
            <>
              <RentalVehicleLookup
                onTankSize={() => {}}
                onVehicleResolved={handleVehicleResolved}
              />
              <RentalVinLookup
                onTankSize={() => {}}
                onVehicleResolved={handleVehicleResolved}
              />
              {vehicleResolvedLabel && (
                <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-emerald-800 truncate">{vehicleResolvedLabel}</p>
                    <p className="text-[11px] text-emerald-600">{t.rentalReturn.tankCapacityResolved(tankCapacity)}</p>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setVehicleEntryMode('manual')}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
              >
                {t.rentalReturn.enterVehicleManually}
              </button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <input type="text" placeholder={t.rentalReturn.year} value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} className="input-field col-span-1" />
                <input type="text" placeholder={t.rentalReturn.make} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className="input-field col-span-2" />
              </div>
              <input type="text" placeholder={t.rentalReturn.model} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="input-field" />
              <input type="text" placeholder={t.rentalReturn.trimOptional} value={vehicleTrim} onChange={(e) => setVehicleTrim(e.target.value)} className="input-field" />
              <div>
                <label className="field-label">{t.rentalReturn.tankCapacity}</label>
                <input type="number" inputMode="decimal" min="1" max="60" step="0.1" placeholder="15.0" value={tankCapacity} onChange={(e) => setTankCapacity(e.target.value)} className="input-field" />
                <p className="text-[11px] text-slate-400 mt-1">{t.rentalReturn.tankCapacityHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setVehicleEntryMode('lookup')}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
              >
                {t.rentalReturn.lookUpVehicleInstead}
              </button>
            </>
          )}
        </div>
      )}

      {/* Step 3 — Pickup fuel */}
      {step === 3 && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['gauge', 'percent', 'gallons'] as FuelInputMethod[]).map((m) => (
              <button key={m} onClick={() => setPickupMethod(m)}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border ${pickupMethod === m ? 'bg-[#005F4A] text-white border-[#005F4A]' : 'bg-white border-slate-200 text-slate-600'}`}>
                {m === 'gauge' ? t.rentalReturn.methodGauge : m === 'percent' ? t.rentalReturn.methodPercent : t.rentalReturn.methodGallons}
              </button>
            ))}
          </div>
          {pickupMethod === 'gauge' && (
            <div className="grid grid-cols-3 gap-2">
              {GAUGE_OPTIONS.map((g) => (
                <button key={g} onClick={() => setPickupGauge(g)}
                  className={`py-2.5 rounded-xl text-sm font-bold border ${pickupGauge === g ? 'bg-[#005F4A] text-white border-[#005F4A]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  {g}
                </button>
              ))}
            </div>
          )}
          {pickupMethod === 'percent' && (
            <input type="number" inputMode="decimal" min="0" max="100" placeholder="95" value={pickupPercent} onChange={(e) => setPickupPercent(e.target.value)} className="input-field" />
          )}
          {pickupMethod === 'gallons' && (
            <input type="number" inputMode="decimal" min="0" step="0.1" placeholder="14.1" value={pickupGallons} onChange={(e) => setPickupGallons(e.target.value)} className="input-field" />
          )}
          {pickupPreview.gallons != null && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              {t.rentalReturn.estimatedStartingFuel(pickupPreview.gallons)}
            </p>
          )}
        </div>
      )}

      {/* Step 4 — Return requirement */}
      {step === 4 && (
        <div className="space-y-2">
          {([
            ['same_as_pickup', t.rentalReturn.returnSameAsPickup],
            ['full',            t.rentalReturn.returnFull],
            ['exact',           t.rentalReturn.returnExact],
          ] as [ReturnPolicyType, string][]).map(([val, label]) => (
            <button key={val} onClick={() => setReturnPolicy(val)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-semibold ${returnPolicy === val ? 'bg-[#005F4A] text-white border-[#005F4A]' : 'bg-white border-slate-200 text-slate-700'}`}>
              {label}
            </button>
          ))}
          {returnPolicy === 'exact' && (
            <input type="number" inputMode="decimal" min="0" step="0.1" placeholder={t.rentalReturn.gallonsPlaceholder}
              value={exactReturnGallons} onChange={(e) => setExactReturnGallons(e.target.value)} className="input-field" />
          )}
        </div>
      )}

      {/* Step 5 — Rate */}
      {step === 5 && (
        <div className="space-y-3">
          <label className="field-label">{t.rentalReturn.rentalRateLabel}</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="5.11" value={rentalRate} onChange={(e) => setRentalRate(e.target.value)} className="input-field" />
          <p className="text-[11px] text-slate-400">{t.rentalReturn.rentalRateHint}</p>
        </div>
      )}

      {/* Step 6 — Return location/time */}
      {step === 6 && (
        <div className="space-y-3">
          <div>
            <label className="field-label">{t.rentalReturn.returnLocationLabel}</label>
            <ReturnLocationInput
              value={returnLocation}
              placeholder={t.rentalReturn.returnLocationPlaceholder}
              onChange={(text, coords) => { setReturnLocation(text); setReturnCoords(coords); }}
            />
            {returnLocation && !returnCoords && (
              <p className="text-[10px] text-slate-400 mt-1">{t.rentalReturn.returnLocationNoCoordsHint}</p>
            )}
          </div>
          <div>
            <label className="field-label">{t.rentalReturn.returnDateTimeLabel}</label>
            <input type="datetime-local" value={returnDateTime} onChange={(e) => setReturnDateTime(e.target.value)} className="input-field" />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {step > 1 && (
          <button onClick={() => setStep((s) => s - 1)} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-bold">
            {t.rentalReturn.back}
          </button>
        )}
        {step < 6 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2) || (step === 3 && !canNext3) || (step === 4 && !canNext4)}
            className="flex-1 py-3 rounded-2xl bg-[#005F4A] text-white text-sm font-bold disabled:opacity-40"
          >
            {t.rentalReturn.next}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex-1 py-3 rounded-2xl bg-[#005F4A] text-white text-sm font-bold disabled:opacity-40"
          >
            {submitting ? t.rentalReturn.creating : t.rentalReturn.createSession}
          </button>
        )}
      </div>
    </div>
  );
}
