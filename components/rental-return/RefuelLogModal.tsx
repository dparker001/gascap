'use client';

import { useState, useRef } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import ModalShell from './ModalShell';
import { compressImageForUpload } from '@/lib/imageUtils';
import { trackRentalRefuelLogged, trackRentalReceiptUploaded } from '@/lib/gtag';

interface Props {
  sessionId: string;
  onClose:   () => void;
  onSaved:   () => void;
  /** Pre-fills the gallons field with the "gallons needed to reach the
   *  return target" figure already shown on the dashboard — the Calculate
   *  Fill flow opens this same modal rather than duplicating its form. */
  suggestedGallons?: number;
  /** Defaults the Trip / Final Return classification. */
  defaultFillupType?: 'trip' | 'final_return';
  /** Pre-fills price/gallon from the dashboard's Calculate Fill section, so
   *  a price already entered there doesn't have to be typed again here. */
  suggestedPricePerGallon?: number;
}

export default function RefuelLogModal({ sessionId, onClose, onSaved, suggestedGallons, defaultFillupType, suggestedPricePerGallon }: Props) {
  const { t } = useTranslation();
  const [gallons,     setGallons]     = useState(suggestedGallons != null && suggestedGallons > 0 ? String(suggestedGallons) : '');
  const [pricePerGal, setPricePerGal] = useState(suggestedPricePerGallon != null && suggestedPricePerGallon > 0 ? String(suggestedPricePerGallon) : '');
  const [totalPaid,   setTotalPaid]   = useState('');
  const [stationName, setStationName] = useState('');
  const [receiptThumb, setReceiptThumb] = useState('');
  const [fillupType,  setFillupType]  = useState<'trip' | 'final_return'>(defaultFillupType ?? 'trip');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  // Generated once per modal instance — a retried submission (network error,
  // double-tap) reuses this id so the server treats it as the same
  // submission rather than creating a duplicate Fillup. See
  // lib/rentalFillups.ts's createRentalFillup().
  const clientRefuelId = useRef(crypto.randomUUID());

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageForUpload(file);
      const reader = new FileReader();
      reader.onload = () => setReceiptThumb(reader.result as string);
      reader.readAsDataURL(compressed);
    } catch { /* photo is optional — silently skip on failure */ }
  }

  async function handleSubmit() {
    const g = Number(gallons);
    if (!(g > 0)) { setError(t.rentalReturn.gallonsRequired); return; }
    // $0.00 means free fuel, never "unknown" — require a real price signal
    // rather than letting the server default to a fabricated zero.
    if (!pricePerGal && !totalPaid) { setError(t.rentalReturn.priceOrTotalRequired); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/rental-sessions/${sessionId}/refuel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallons: g,
          pricePerGallon: pricePerGal ? Number(pricePerGal) : undefined,
          totalPaid:      totalPaid   ? Number(totalPaid)   : undefined,
          stationName:    stationName || undefined,
          receiptPhotoThumb: receiptThumb || undefined,
          fillupType,
          clientRefuelId: clientRefuelId.current,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) { setError(t.rentalReturn.finalReturnAlreadyLogged); return; }
        setError(t.rentalReturn.setupError);
        return;
      }
      trackRentalRefuelLogged();
      if (receiptThumb) trackRentalReceiptUploaded();
      onSaved();
    } catch {
      setError(t.rentalReturn.setupError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
        <p className="text-base font-black text-slate-900">⛽ {t.rentalReturn.iJustRefueled}</p>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFillupType('trip')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold border ${fillupType === 'trip' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {t.rentalReturn.tripFillUp}
          </button>
          <button
            type="button"
            onClick={() => setFillupType('final_return')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold border ${fillupType === 'final_return' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {t.rentalReturn.finalReturnFillUp}
          </button>
        </div>
        <div>
          <label className="field-label">{t.rentalReturn.gallonsPurchased}</label>
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="1.5" value={gallons} onChange={(e) => setGallons(e.target.value)} className="input-field" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">{t.rentalReturn.pricePerGallon}</label>
            <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="3.09" value={pricePerGal} onChange={(e) => setPricePerGal(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="field-label">{t.rentalReturn.totalPaid}</label>
            <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="4.64" value={totalPaid} onChange={(e) => setTotalPaid(e.target.value)} className="input-field" />
          </div>
        </div>
        <input type="text" placeholder={t.rentalReturn.stationNameOptional} value={stationName} onChange={(e) => setStationName(e.target.value)} className="input-field" />
        <div>
          <label className="text-xs font-bold text-blue-600 cursor-pointer">
            {receiptThumb ? t.rentalReturn.receiptAttached : t.rentalReturn.attachReceiptOptional}
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">{t.rentalReturn.cancel}</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
            {saving ? t.rentalReturn.saving : t.rentalReturn.save}
          </button>
        </div>
    </ModalShell>
  );
}
