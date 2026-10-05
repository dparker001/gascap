'use client';

/**
 * One card for the lifecycle states that need the renter to act or look:
 *  - pickup:         "It's pickup time" (the Finish-setup card below does the work)
 *  - overdue:        "Did you return it?"  → Complete / still have it
 *  - stale:          3+ days past return   → Complete / still have it / didn't take it / delete
 *  - needs_schedule: times malformed       → edit the times
 * Nothing here changes a rental by itself: every outcome is the renter's tap,
 * and no state ever completes, cancels or deletes a rental on its own.
 */
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { resyncRentalFallbacks } from '@/lib/rentalReminderSync';
import type { RentalLifecycle } from '@/lib/rentalCalculations';
import DeleteRentalButton from './DeleteRentalButton';

export type AttentionState = Extract<RentalLifecycle, 'pickup' | 'overdue' | 'stale' | 'needs_schedule'>;

export default function RentalAttentionCard({ state, sessionId, onComplete, onEdit, onClosed }: {
  state:      AttentionState;
  sessionId:  string;
  onComplete: () => void;
  onEdit:     () => void;
  /** After a cancel or delete — the rental no longer exists as an open rental. */
  onClosed:   () => void;
}) {
  const { t } = useTranslation();
  const r = t.rentalReturn;
  const authUserId = (useSession().data?.user as { id?: string } | undefined)?.id;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function didntTake() {
    if (!window.confirm(r.cancelRentalConfirm)) return;
    setBusy(true); setFailed(false);
    try {
      const res = await fetch(`/api/rental-sessions/${sessionId}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error('cancel failed');
      void resyncRentalFallbacks(authUserId); // drop any local return fallback
      onClosed();
    } catch { setFailed(true); } finally { setBusy(false); }
  }

  const tone = state === 'pickup' ? 'border-blue-200 bg-blue-50 text-blue-900'
    : state === 'overdue' ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-slate-300 bg-slate-50 text-slate-800';
  const title = state === 'pickup' ? r.atPickupTitle : state === 'overdue' ? r.overdueTitle
    : state === 'stale' ? r.staleTitle : r.needsScheduleTitle;
  const body = state === 'pickup' ? r.atPickupBody : state === 'overdue' ? r.overdueBody
    : state === 'stale' ? r.staleBody : r.needsScheduleBody;
  const btn = 'px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50';

  return (
    <div data-testid={`rental-attention-${state}`} className={`rounded-2xl border p-3.5 space-y-2.5 ${tone}`}>
      <p className="text-sm font-black leading-tight">{title}</p>
      <p className="text-xs leading-snug opacity-90">{body}</p>

      {(state === 'overdue' || state === 'stale') && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onComplete} className={`${btn} bg-blue-600 text-white`}>{r.overdueYesReturned}</button>
          <button type="button" onClick={onEdit} className={`${btn} bg-white border border-slate-300 text-slate-700`}>{r.overdueStillHave}</button>
          {state === 'stale' && (
            <>
              <button type="button" onClick={didntTake} disabled={busy} className={`${btn} bg-white border border-slate-300 text-slate-700`}>{r.staleDidntTake}</button>
              <DeleteRentalButton sessionId={sessionId} onDeleted={onClosed} label={r.deleteRental} />
            </>
          )}
        </div>
      )}
      {state === 'needs_schedule' && (
        <button type="button" onClick={onEdit} className={`${btn} bg-blue-600 text-white`}>{r.needsScheduleEdit}</button>
      )}
      {failed && <p className="text-[11px] text-red-600">{r.cancelRentalFailed}</p>}
    </div>
  );
}
