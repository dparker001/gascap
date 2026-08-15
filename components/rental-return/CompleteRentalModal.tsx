'use client';

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import ModalShell from './ModalShell';
import { trackRentalCompleted, trackRentalFuelFeeReported } from '@/lib/gtag';
import PhotoCaptureButton from './PhotoCaptureButton';
import { rentalRecap } from '@/lib/rentalCalculations';

interface Props {
  sessionId:   string;
  onClose:     () => void;
  onCompleted: () => void;
  /** Refuels logged during this rental — drives the end-of-rental recap. */
  refuelLogs:  Array<{ gallons: number; totalPaid?: number; pricePerGallon?: number }>;
  rentalFuelChargePerGallon: number | null;
}

type FeeAnswer = 'no' | 'yes' | 'not_sure' | null;

export default function CompleteRentalModal({ sessionId, onClose, onCompleted, refuelLogs, rentalFuelChargePerGallon }: Props) {
  const { t } = useTranslation();
  const recap = rentalRecap(refuelLogs, rentalFuelChargePerGallon);
  const [feeAnswer, setFeeAnswer] = useState<FeeAnswer>(null);
  const [feeAmount, setFeeAmount] = useState('');
  const [feeGallons, setFeeGallons] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [returnGaugePhoto, setReturnGaugePhoto] = useState('');
  const [returnReceiptPhoto, setReturnReceiptPhoto] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      await fetch(`/api/rental-sessions/${sessionId}/complete`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fuelFeeCharged: feeAnswer === 'yes' ? true : feeAnswer === 'no' ? false : undefined,
          fuelFeeAmount:  feeAnswer === 'yes' && feeAmount  ? Number(feeAmount)  : undefined,
          fuelFeeGallonsClaimed: feeAnswer === 'yes' && feeGallons ? Number(feeGallons) : undefined,
          feedbackRating: rating ?? undefined,
          feedbackText:   feedback || undefined,
          returnGaugePhotoThumb: returnGaugePhoto || undefined,
          returnReceiptPhotoThumb: returnReceiptPhoto || undefined,
        }),
      });
      trackRentalCompleted();
      if (feeAnswer === 'yes' || feeAnswer === 'no') trackRentalFuelFeeReported(feeAnswer === 'yes');
      onCompleted();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
        <p className="text-base font-black text-slate-900">{t.rentalReturn.completeRental}</p>

        {/* End-of-rental recap — the payoff moment. Based on what the renter
            actually logged paying, not estimates. */}
        {recap.count > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-3 space-y-1.5">
            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">{t.rentalReturn.recapTitle}</p>
            <div className="flex justify-between text-xs text-emerald-800">
              <span>{t.rentalReturn.recapFuelAdded(recap.count)}</span>
              <span className="font-bold">{recap.totalGallons} gal</span>
            </div>
            {recap.totalPaid > 0 && (
              <div className="flex justify-between text-xs text-emerald-800">
                <span>{t.rentalReturn.recapYouPaid}</span>
                <span className="font-bold">${recap.totalPaid.toFixed(2)}</span>
              </div>
            )}
            {recap.rentalWouldHaveCharged != null && (
              <>
                <div className="flex justify-between text-xs text-emerald-800">
                  <span>{t.rentalReturn.recapRentalWouldCharge}</span>
                  <span className="font-bold">${recap.rentalWouldHaveCharged.toFixed(2)}</span>
                </div>
                {recap.savings != null && (
                  <div className="flex justify-between text-sm font-black text-emerald-900 pt-1.5 border-t border-emerald-200">
                    <span>{recap.savings >= 0 ? t.rentalReturn.recapYouSaved : t.rentalReturn.recapYouPaidMore}</span>
                    <span>${Math.abs(recap.savings).toFixed(2)}</span>
                  </div>
                )}
              </>
            )}
            <p className="text-[10px] text-emerald-600 leading-snug pt-0.5">{t.rentalReturn.recapDisclaimer}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-bold text-slate-600 mb-1.5">{t.rentalReturn.wereYouCharged}</p>
          <div className="flex gap-1.5">
            {(['no', 'yes', 'not_sure'] as FeeAnswer[]).map((a) => (
              <button key={a} onClick={() => setFeeAnswer(a)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border ${feeAnswer === a ? 'bg-[#005F4A] text-white border-[#005F4A]' : 'bg-white border-slate-200 text-slate-600'}`}>
                {a === 'no' ? t.rentalReturn.feeNo : a === 'yes' ? t.rentalReturn.feeYes : t.rentalReturn.feeNotSure}
              </button>
            ))}
          </div>
          {feeAnswer === 'yes' && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder={t.rentalReturn.amountCharged} value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} className="input-field text-sm" />
              <input type="number" inputMode="decimal" min="0" step="0.1" placeholder={t.rentalReturn.gallonsChargedOptional} value={feeGallons} onChange={(e) => setFeeGallons(e.target.value)} className="input-field text-sm" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-600">{t.rentalReturn.stepDocumentation}</p>
          <PhotoCaptureButton label={t.rentalReturn.photoReturnGauge} value={returnGaugePhoto} onChange={setReturnGaugePhoto} />
          <PhotoCaptureButton label={t.rentalReturn.photoReturnReceipt} value={returnReceiptPhoto} onChange={setReturnReceiptPhoto} />
        </div>

        <div>
          <p className="text-xs font-bold text-slate-600 mb-1.5">{t.rentalReturn.feedbackPrompt}</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)}
                className={`flex-1 py-2 rounded-lg text-lg ${rating != null && n <= rating ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-300'}`}>
                ★
              </button>
            ))}
          </div>
          <textarea
            placeholder={t.rentalReturn.feedbackTextPlaceholder}
            value={feedback} onChange={(e) => setFeedback(e.target.value)}
            className="input-field text-sm mt-2 resize-none" rows={2}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">{t.rentalReturn.cancel}</button>
          <button onClick={handleSubmit} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-bold disabled:opacity-40">
            {saving ? t.rentalReturn.saving : t.rentalReturn.finish}
          </button>
        </div>
    </ModalShell>
  );
}
