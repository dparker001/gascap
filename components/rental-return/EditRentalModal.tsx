'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/contexts/LanguageContext';
import ModalShell from './ModalShell';
import { RENTAL_COMPANIES } from '@/lib/rentalProvider';
import type { ReturnPolicyType } from '@/lib/rentalCalculations';
import type { RentalSession } from '@/lib/rentalSessions';
import ReturnLocationInput from './ReturnLocationInput';
import RentalVehicleLookup from '@/components/RentalVehicleLookup';
import RentalVinLookup from '@/components/RentalVinLookup';

interface Props {
  session: RentalSession;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditRentalModal({ session, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  const [rentalCompany, setRentalCompany] = useState(session.rentalCompany);
  const [agreementNumber, setAgreementNumber] = useState(session.rentalAgreementNumber ?? '');
  const [confirmationNumber, setConfirmationNumber] = useState(session.rentalConfirmationNumber ?? '');
  const [vehicleYear,   setVehicleYear]   = useState(session.vehicleYear ?? '');
  const [vehicleMake,   setVehicleMake]   = useState(session.vehicleMake ?? '');
  const [vehicleModel,  setVehicleModel]  = useState(session.vehicleModel ?? '');
  const [vehicleTrim,   setVehicleTrim]   = useState(session.vehicleTrim ?? '');
  const [tankCapacity,  setTankCapacity]  = useState(String(session.fuelTankCapacityGallons ?? ''));
  function handleVehicleResolved(details: { year: string; make: string; model: string; trim?: string; tankEst: number }) {
    setVehicleYear(details.year);
    setVehicleMake(details.make);
    setVehicleModel(details.model);
    if (details.trim) setVehicleTrim(details.trim);
    setTankCapacity(String(details.tankEst));
  }
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
  const [pickupDateTime, setPickupDateTime] = useState(session.pickupDateTime?.slice(0, 16) ?? '');
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
          rentalAgreementNumber: agreementNumber.trim() || undefined,
          rentalConfirmationNumber: confirmationNumber.trim() || undefined,
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
          pickupDateTime: pickupDateTime || undefined,
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
    <ModalShell onClose={onClose}>
        <p className="text-base font-black text-slate-900">{t.rentalReturn.editRental}</p>
        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* ── Vehicle first: what's currently selected, then how to change it.
            Identity (year/make/model/trim) is intentionally NOT free-text —
            it has to come from the EPA lookup or a VIN decode, because a
            typo'd make/model silently degrades both the tank-size lookup and
            the body-type inference. Tank size stays editable below, since
            that's a calculation input a renter may legitimately correct
            against the actual fuel door. */}
        <div className="bg-slate-50 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{t.rentalReturn.currentVehicle}</p>
          {vehicleMake || vehicleModel ? (
            <div className="bg-white rounded-lg px-3 py-2 border border-slate-200">
              <p className="text-sm font-black text-slate-800">
                {[vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ')}
              </p>
              {vehicleTrim && <p className="text-[11px] text-slate-500">{vehicleTrim}</p>}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">{t.rentalReturn.vehicleUnknown}</p>
          )}

          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide pt-1">{t.rentalReturn.changeVehicle}</p>
          <RentalVehicleLookup onTankSize={() => {}} onVehicleResolved={handleVehicleResolved} />
          <RentalVinLookup onTankSize={() => {}} onVehicleResolved={handleVehicleResolved} />
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.tankCapacity}</label>
          <input type="number" inputMode="decimal" min="1" max="60" step="0.1" value={tankCapacity} onChange={(e) => setTankCapacity(e.target.value)} className="input-field" />
          <p className="text-[11px] text-slate-400 mt-1">{t.rentalReturn.tankCapacityEditHint}</p>
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.stepCompany}</label>
          <select value={rentalCompany} onChange={(e) => setRentalCompany(e.target.value)} className="input-field">
            {RENTAL_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
            {!RENTAL_COMPANIES.includes(rentalCompany as typeof RENTAL_COMPANIES[number]) && (
              <option value={rentalCompany}>{rentalCompany}</option>
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">{t.rentalReturn.agreementNumberLabel}</label>
            <input type="text" placeholder={t.rentalReturn.agreementNumberPlaceholder}
              value={agreementNumber} onChange={(e) => setAgreementNumber(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="field-label">{t.rentalReturn.confirmationNumberLabel}</label>
            <input type="text" placeholder={t.rentalReturn.confirmationNumberPlaceholder}
              value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} className="input-field" />
          </div>
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
                className={`w-full text-left px-3 py-2 rounded-xl border text-xs font-semibold ${returnPolicy === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-700'}`}>
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
          <label className="field-label">{t.rentalReturn.pickupDateTimeLabel}</label>
          <input type="datetime-local" value={pickupDateTime} onChange={(e) => setPickupDateTime(e.target.value)} className="input-field" />
        </div>

        <div>
          <label className="field-label">{t.rentalReturn.returnDateTimeLabel}</label>
          <input type="datetime-local" value={returnDateTime} onChange={(e) => setReturnDateTime(e.target.value)} className="input-field" />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">{t.rentalReturn.cancel}</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
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
    </ModalShell>
  );
}
