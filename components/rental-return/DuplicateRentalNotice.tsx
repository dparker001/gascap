'use client';

/**
 * Shown when the server answers possible_duplicate: a soft warning, never a
 * block. The renter either opens the rental they already saved or saves this
 * one anyway (the form retries with confirmDuplicate and the same
 * clientRentalId).
 */
import { useTranslation } from '@/contexts/LanguageContext';

export default function DuplicateRentalNotice({ onOpenExisting, onSaveAnyway, busy }: {
  onOpenExisting: () => void;
  onSaveAnyway:   () => void;
  busy?:          boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" data-testid="duplicate-rental-notice" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <p className="text-xs font-black text-amber-900">{t.rentalReturn.duplicateTitle}</p>
      <p className="text-[11px] text-amber-800 leading-snug">{t.rentalReturn.duplicateBody}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onOpenExisting} disabled={busy}
                className="flex-1 py-2 rounded-xl bg-white border border-amber-300 text-amber-900 text-xs font-bold disabled:opacity-50">
          {t.rentalReturn.duplicateOpen}
        </button>
        <button type="button" onClick={onSaveAnyway} disabled={busy}
                className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold disabled:opacity-50">
          {t.rentalReturn.duplicateSaveAnyway}
        </button>
      </div>
    </div>
  );
}
