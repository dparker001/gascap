'use client';

/**
 * Shared photo-capture control for the Rental Return Assistant — same
 * compress-to-base64-thumbnail pattern as Fillup.receiptThumb, reused here
 * for pickup vehicle/gauge/agreement photos and return gauge/receipt
 * photos. Optional everywhere; never presented as legal proof of fuel
 * level, just the renter's own documentation.
 */

import { useState } from 'react';
import { compressImageForUpload } from '@/lib/imageUtils';
import { useTranslation } from '@/contexts/LanguageContext';

interface Props {
  label:      string;
  value:      string;
  onChange:   (dataUrl: string) => void;
}

export default function PhotoCaptureButton({ label, value, onChange }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState('');

  async function handleFile(file: File) {
    setError('');
    try {
      const compressed = await compressImageForUpload(file);
      const reader = new FileReader();
      reader.onload = () => onChange(reader.result as string);
      reader.onerror = () => setError(t.rentalReturn.photoError);
      reader.readAsDataURL(compressed);
    } catch {
      setError(t.rentalReturn.photoError);
    }
  }

  return (
    <div>
      <label
        className={[
          'flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors',
          value
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300',
        ].join(' ')}
      >
        <input
          type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
        {value ? (
          <img src={value} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <span className="text-base flex-shrink-0" aria-hidden="true">📷</span>
        )}
        <span className="text-xs font-bold flex-1">
          {value ? t.rentalReturn.photoAttached(label) : label}
        </span>
        {value && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onChange(''); }}
            className="text-[10px] font-bold text-emerald-500 hover:text-emerald-700"
          >
            {t.rentalReturn.photoRemove}
          </button>
        )}
      </label>
      {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}
