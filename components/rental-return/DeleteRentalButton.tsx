'use client';

/**
 * Delete a rental session, permanently.
 *
 * The DELETE endpoint has existed since the Level 1 build; nothing on the
 * active-rentals list or in Rental History ever called it, so a test rental
 * (or a booking that fell through) was stuck in the app forever. The only
 * way out was buried in the Edit modal under "Cancel this rental" — wording
 * that reads like "cancel the booking," sitting next to a Cancel button that
 * just closes the modal.
 *
 * Two taps, never one: a stray thumb shouldn't erase a real rental's fuel
 * records. The confirm step says what is actually lost.
 */

import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

export default function DeleteRentalButton({
  sessionId,
  onDeleted,
  label,
}: {
  sessionId: string;
  onDeleted: () => void;
  /** Optional text button (Edit modal). Omit for the compact trash icon. */
  label?: string;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/rental-sessions/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      onDeleted();
    } catch {
      // Don't call onDeleted on failure — the row would vanish from the list
      // while the record is still on the server, and it'd be back on reload.
      setFailed(true);
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div
        // w-full so it wraps onto its own line inside the card's flex-wrap
        // row. Inline beside the vehicle name it collided with the text on
        // the active list and ran off the card edge in history at 375px.
        className={`flex items-center gap-2 ${label ? 'justify-center' : 'w-full justify-end pt-2 mt-1 border-t border-slate-100'}`}
        // The list rows are buttons that navigate; without this, confirming
        // opens the rental you're trying to delete.
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
      >
        <span className="text-[11px] text-red-600 font-semibold flex-1 min-w-0 leading-snug">{t.rentalReturn.deleteRentalConfirm}</span>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-[11px] font-black text-white bg-red-600 rounded-lg px-2.5 py-1 disabled:opacity-60"
        >
          {busy ? t.rentalReturn.deleting : t.rentalReturn.deleteRentalYes}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="text-[11px] font-bold text-slate-500 px-1"
        >
          {t.rentalReturn.deleteRentalKeep}
        </button>
      </div>
    );
  }

  return (
    <div onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={t.rentalReturn.deleteRental}
        className={
          label
            ? 'w-full text-center text-[11px] font-bold text-red-500 hover:text-red-700 py-1'
            : 'p-1.5 -m-1.5 text-slate-300 hover:text-red-500 transition-colors'
        }
      >
        {label ?? (
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />
          </svg>
        )}
      </button>
      {failed && <p className="text-[10px] text-red-500 mt-1">{t.rentalReturn.deleteRentalFailed}</p>}
    </div>
  );
}
