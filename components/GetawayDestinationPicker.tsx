'use client';

/**
 * GetawayDestinationPicker — shown to a Lifetime buyer (after purchase, during
 * the getaway promo) so they choose their complimentary getaway destination.
 *
 * On submit it POSTs to /api/getaway/choose, which emails the admin exactly which
 * destination to issue in Marketing Boost and confirms to the buyer. A localStorage
 * flag remembers the choice so revisiting shows the confirmed state instead of
 * letting them re-submit.
 *
 * Used on the upgrade success page and the standalone /getaway page.
 */

import { useState, useEffect } from 'react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { GETAWAY_DESTINATIONS, findGetawayDestination } from '@/lib/getawayPromo';

const STORAGE_KEY = 'gc_getaway_destination';

export default function GetawayDestinationPicker() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen,   setChosen]   = useState<string | null>(null);  // confirmed destination id
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Restore a prior choice so we show the confirmed state, not the picker.
  useEffect(() => {
    try {
      const prior = localStorage.getItem(STORAGE_KEY);
      if (prior && findGetawayDestination(prior)) setChosen(prior);
    } catch { /* ignore */ }
  }, []);

  async function handleConfirm() {
    if (!selected) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/getaway/choose', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ destination: selected }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        try { localStorage.setItem(STORAGE_KEY, selected); } catch { /* ignore */ }
        setChosen(selected);
      } else if (res.status === 403) {
        // Account not confirmed Lifetime yet — the IAP grant webhook is still
        // catching up. Show a friendly retry instead of the raw "included" error.
        setError(t.pricing.getawayPickerFinalizing);
      } else {
        setError(data.error ?? t.pricing.getawayPickerError);
      }
    } catch {
      setError(t.pricing.getawayPickerError);
    } finally {
      setLoading(false);
    }
  }

  // ── Confirmed state ────────────────────────────────────────────────────────
  if (chosen) {
    const d = findGetawayDestination(chosen);
    return (
      <div className="rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-4 py-4 text-left">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-1">
          🏝️ {t.pricing.getawayPill}
        </p>
        <p className="text-white text-sm font-black leading-snug">
          {d ? `${d.emoji} ${d.name}` : ''} — {t.pricing.getawayPickerConfirmed}
        </p>
        <p className="text-white/60 text-[11px] leading-snug mt-1.5">
          {t.pricing.getawayDisclosure}
        </p>
      </div>
    );
  }

  // ── Picker ─────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border-2 border-teal-300 bg-[#f0fdf9] px-4 py-4 text-left">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F] mb-0.5">
        🏝️ {t.pricing.getawayPill}
      </p>
      <p className="text-sm font-black text-[#005F4A] leading-tight">
        {t.pricing.getawayPickerHeadline}
      </p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
        {t.pricing.getawayPickerSub}
      </p>

      <div className="mt-3 space-y-2">
        {GETAWAY_DESTINATIONS.map((d) => {
          const isSel = selected === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelected(d.id)}
              className={`w-full flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                isSel ? 'border-teal-500 bg-white ring-2 ring-teal-400' : 'border-slate-200 bg-white hover:border-teal-300'
              }`}
            >
              <span className="text-xl flex-shrink-0" aria-hidden="true">{d.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-black text-navy-700 leading-tight">{d.name}</span>
                <span className="block text-[11px] text-slate-500 leading-tight">{d.vibe}</span>
              </span>
              <span className="flex-shrink-0 text-right">
                <span className="block text-[11px] font-bold text-teal-700">${d.fee.toFixed(2)}</span>
                <span className="block text-[9px] text-slate-400 leading-tight">{t.pricing.getawayPickerFeeLabel}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-400 mt-2 leading-snug">
        {t.pricing.getawayPickerNote}
      </p>

      {error && <p className="text-[11px] text-red-600 font-semibold mt-2">{error}</p>}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!selected || loading}
        className="mt-3 w-full bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white text-sm font-black
                   py-3 rounded-xl transition-colors"
      >
        {loading ? t.pricing.loading : t.pricing.getawayPickerConfirm}
      </button>
    </div>
  );
}
