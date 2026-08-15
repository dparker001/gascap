'use client';

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import ModalShell from './ModalShell';
import { compressImageForUpload } from '@/lib/imageUtils';
import { trackRentalRefuelLogged, trackRentalReceiptUploaded } from '@/lib/gtag';

interface Props {
  sessionId: string;
  onClose:   () => void;
  onSaved:   () => void;
}

export default function RefuelLogModal({ sessionId, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [gallons,     setGallons]     = useState('');
  const [pricePerGal, setPricePerGal] = useState('');
  const [totalPaid,   setTotalPaid]   = useState('');
  const [stationName, setStationName] = useState('');
  const [receiptThumb, setReceiptThumb] = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

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
        }),
      });
      if (!res.ok) { setError(t.rentalReturn.setupError); return; }
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
          <label className="text-xs font-bold text-teal-600 cursor-pointer">
            {receiptThumb ? t.rentalReturn.receiptAttached : t.rentalReturn.attachReceiptOptional}
            <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">{t.rentalReturn.cancel}</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-bold disabled:opacity-40">
            {saving ? t.rentalReturn.saving : t.rentalReturn.save}
          </button>
        </div>
    </ModalShell>
  );
}
