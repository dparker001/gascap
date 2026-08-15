'use client';

/**
 * Upload the rental agreement (emailed PDF or a photo) and pre-fill the setup
 * flow from it. Everything it returns is a suggestion the renter reviews and
 * can edit — an OCR misread should never silently become the number a return
 * decision rests on.
 */

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

export interface ScannedAgreementFields {
  rentalCompany:             string | null;
  rentalAgreementNumber:     string | null;
  rentalConfirmationNumber:  string | null;
  vehicleYear:               string | null;
  vehicleMake:               string | null;
  vehicleModel:              string | null;
  pickupDateTime:            string | null;
  returnDateTime:            string | null;
  returnLocation:            string | null;
  rentalFuelChargePerGallon: number | null;
  fuelPolicy:                string | null;
}

export default function AgreementScanButton({ onScanned }: { onScanned: (f: ScannedAgreementFields) => void }) {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [error, setError]       = useState('');
  const [filled, setFilled]     = useState<string[]>([]);

  async function handleFile(file: File) {
    setScanning(true);
    setError('');
    setFilled([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/rental-sessions/scan-agreement', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json() as { ok?: boolean; fields?: ScannedAgreementFields; error?: string };
      if (!res.ok || !data.ok || !data.fields) {
        setError(data.error ?? t.rentalReturn.scanFailed);
        return;
      }
      onScanned(data.fields);
      // Name what actually came back — a scan that silently fills two of ten
      // fields shouldn't look like a complete success.
      const labels: Array<[keyof ScannedAgreementFields, string]> = [
        ['rentalCompany',             t.rentalReturn.scanFieldCompany],
        ['rentalAgreementNumber',     t.rentalReturn.scanFieldAgreement],
        ['rentalConfirmationNumber',  t.rentalReturn.scanFieldConfirmation],
        ['vehicleMake',               t.rentalReturn.scanFieldVehicle],
        ['returnDateTime',            t.rentalReturn.scanFieldReturnTime],
        ['returnLocation',            t.rentalReturn.scanFieldReturnLocation],
        ['rentalFuelChargePerGallon', t.rentalReturn.scanFieldRate],
      ];
      setFilled(labels.filter(([k]) => data.fields![k] != null).map(([, label]) => label));
    } catch {
      setError(t.rentalReturn.scanFailed);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-2">
      <label
        className={[
          'flex items-center gap-2.5 px-3 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
          scanning
            ? 'border-slate-200 bg-slate-50 text-slate-400 pointer-events-none'
            : 'border-[#005F4A]/30 bg-[#005F4A]/5 text-[#005F4A] hover:bg-[#005F4A]/10',
        ].join(' ')}
      >
        <input
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          disabled={scanning}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
        <span className="text-lg flex-shrink-0" aria-hidden="true">{scanning ? '⏳' : '📄'}</span>
        <div className="min-w-0">
          <p className="text-xs font-black leading-tight">
            {scanning ? t.rentalReturn.scanning : t.rentalReturn.scanAgreementTitle}
          </p>
          <p className="text-[10px] opacity-70 leading-snug">{t.rentalReturn.scanAgreementHint}</p>
        </div>
      </label>

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {filled.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          <p className="text-[11px] font-bold text-emerald-800">{t.rentalReturn.scanFilled(filled.length)}</p>
          <p className="text-[10px] text-emerald-600 leading-snug mt-0.5">{filled.join(' · ')}</p>
          <p className="text-[10px] text-emerald-600 leading-snug mt-1">{t.rentalReturn.scanReviewHint}</p>
        </div>
      )}
    </div>
  );
}
