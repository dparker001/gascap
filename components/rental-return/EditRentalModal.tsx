'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';
import { RENTAL_COMPANIES } from '@/lib/rentalProvider';
import type { ReturnPolicyType } from '@/lib/rentalCalculations';
import type { RentalSession } from '@/lib/rentalSessions';
import ReturnLocationInput from './ReturnLocationInput';

interface Props {
  session: RentalSession;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditRentalModal({ session, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  const [rentalCompany, setRentalCompany] = useState(session.rentalCompany);
  const [vehicleYear,   setVehicleYear]   = useState(session.vehicleYear ?? '');
  const [vehicleMake,   setVehicleMake]   = useState(session.vehicleMake ?? '');
  const [vehicleModel,  setVehicleModel]  = useState(session.vehicleModel ?? '');
  const [vehicleTrim,   setVehicleTrim]   = useState(session.vehicleTrim ?? '');
  const [tankCapacity,  setTankCapacity]  = useState(String(session.fuelTankCapacityGallons ?? ''));
  const [returnPolicy,  setReturnPolicy]  = useState<ReturnPolicyType>(session.requiredReturnPolicyType ?? 'same_as_pickup');
  const [exactReturnGallons, setExactReturnGallons] = useState(
    session.requiredReturnPolicyType === 'exact' ? String(session.requiredReturnFuelGallons ?? '') : '',
  );
  const [rentalRate,    setRentalRate]    = useState(String(session.rentalFuelChargePerGallon ?? ''));
  const [returnLocation, setReturnLocation] = useState(session.returnLocation ?? '');
  const [returnCoords, setReturnCoords] = useState<{ lat: number; lng: number } | null>(
    session.returnLatitude != null && session.returnLongitude != null
      ? { lat: session.returnLatitude, lng: session.returnLongitude }
      : null,
  );
  const [returnDateTime, setReturnDateTime] = useState(session.returnDateTime?.slice(0, 16) ?? '');

  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/rental-sessions/${session.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalCompany,
          vehicleYear: vehicleYear || undefined,
          vehicleMake: vehicleMake || undefined,
          vehicleModel: vehicleModel || undefined,
          vehicleTrim: vehicleTrim || undefined,
          fuelTankCapacityGallons: tankCapacity ? Number(tankCapacity) : undefined,
          requiredReturnPolicyType: returnPolicy,
          requiredReturnFuelGallons: returnPolicy === 'exact'
            ? Number(exactReturnGallons)
            : returnPolicy === 'full'
              ? Number(tankCapacity)
              : undefined, // 'same_as_pickup' — leave the original pickup-derived value untouched
          rentalFuelChargePerGallon: rentalRate ? Number(rentalRate) : undefined,
          returnLocation: returnLocation || undefined,
          returnLatitude: returnCoords?.lat,
          returnLongitude: returnCoords?.lng,
          returnDateTime: returnDateTime || undefined,
        }),
      });
      if (!res.ok) { setError(t.rentalReturn.setupError); return; }
      onSaved();
    } catch {
      setError(t.rentalReturn.setupError);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelRental() {
    setCancelling(true);
    try {
      await fetch(`/api/rental-sessions/${session.id}`, { method: 'DELETE' });
      router.push('/rental-return');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-black text-slate-900">{t.rentalReturn.editRental}</p>
        {error && <p className="text-xs text-red-500">{error}</p>}

        <div>
          <label className="field-label">{t.rentalReturn.stepCompany}</label>
          <select value={rentalCompany} onChange={(e) => setRentalCompany(e.target.value)} className="input-field">
            {RENTAL_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
            {!RENTAL_COMPANIES.includes(rentalCompany as typeof RENTAL_COMPANIES[number]) && (
              <option value={rentalCompany}>{rentalCompany}</option>
            )}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <input type="text" placeholder={t.rentalReturn.year} value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} className="input-field col-span-1" />
          <input type="text" placeholder={t.rentalReturn.make} value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} className="input-field col-span-2" />
        </div>
        <input type="text" placeholder={t.rentalReturn.model} value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} className="input-field" />
        <input type="text" placeholder={t.rentalReturn.trimOptional} value={vehicleTrim} onChange={(e) => setVehicleTrim(e.target.value)} className="input-field" />

        <div>
          <label className="field-label">{t.rentalReturn.tankCapacity}</label>
          <input type="number" inputMode="decimal" min="1" max="60" step="0.1" value={tankCapacity} onChange={(e) => setTankCapacity(e.target.value)} className="input-field" />
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.stepReturnReq}</label>
          <div className="space-y-1.5">
            {([
              ['same_as_pickup', t.rentalReturn.returnSameAsPickup],
              ['full',            t.rentalReturn.returnFull],
              ['exact',           t.rentalReturn.returnExact],
            ] as [ReturnPolicyType, string][]).map(([val, label]) => (
              <button key={val} type="button" onClick={() => setReturnPolicy(val)}
                className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-semibold ${returnPolicy === val ? 'bg-[#005F4A] text-white border-[#005F4A]' : 'bg-white border-slate-200 text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          {returnPolicy === 'exact' && (
            <input type="number" inputMode="decimal" min="0" step="0.1" placeholder={t.rentalReturn.gallonsPlaceholder}
              value={exactReturnGallons} onChange={(e) => setExactReturnGallons(e.target.value)} className="input-field mt-1.5" />
          )}
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.rentalRateLabel}</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={rentalRate} onChange={(e) => setRentalRate(e.target.value)} className="input-field" />
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.returnLocationLabel}</label>
          <ReturnLocationInput
            value={returnLocation}
            onChange={(text, coords) => { setReturnLocation(text); setReturnCoords(coords); }}
          />
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.returnDateTimeLabel}</label>
          <input type="datetime-local" value={returnDateTime} onChange={(e) => setReturnDateTime(e.target.value)} className="input-field" />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">{t.rentalReturn.cancel}</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-bold disabled:opacity-40">
            {saving ? t.rentalReturn.saving : t.rentalReturn.save}
          </button>
        </div>

        <div className="pt-2 border-t border-slate-100">
          {!confirmCancel ? (
            <button type="button" onClick={() => setConfirmCancel(true)} className="w-full text-center text-[11px] font-bold text-red-500 hover:text-red-700 py-1">
              {t.rentalReturn.cancelThisRental}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <span className="text-[11px] text-red-600 font-semibold">{t.rentalReturn.cancelThisRentalConfirm}</span>
              <button type="button" onClick={handleCancelRental} disabled={cancelling}
                className="text-[11px] font-black text-white bg-red-500 hover:bg-red-600 rounded-lg px-2 py-1 disabled:opacity-40">
                {t.rentalReturn.yesRemove}
              </button>
              <button type="button" onClick={() => setConfirmCancel(false)} className="text-[11px] font-bold text-slate-500">
                {t.rentalReturn.keepIt}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
