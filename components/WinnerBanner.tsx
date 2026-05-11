'use client';

import { useEffect, useState } from 'react';

interface Draw {
  month:      string;
  winnerName: string;
  drawnAt:    string;
}

type Stage = 'loading' | 'none' | 'notify' | 'form' | 'submitting' | 'done';

/** Month string "2026-04" → "April 2026" */
function formatMonth(m: string): string {
  const [year, mo] = m.split('-');
  const date = new Date(Number(year), Number(mo) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Persistent in-app banner shown to a winner until they claim their prize.
 * Fetches /api/giveaway/my-win on mount; renders nothing for non-winners.
 * Expands inline to a shipping address form — no modal/overlay needed.
 */
export default function WinnerBanner() {
  const [stage, setStage]   = useState<Stage>('loading');
  const [draw,  setDraw]    = useState<Draw | null>(null);
  const [error, setError]   = useState('');

  // Address form state
  const [street, setStreet] = useState('');
  const [city,   setCity]   = useState('');
  const [state,  setState]  = useState('');
  const [zip,    setZip]    = useState('');

  useEffect(() => {
    fetch('/api/giveaway/my-win')
      .then((r) => r.json())
      .then((d: { draw: Draw | null }) => {
        if (d.draw) {
          setDraw(d.draw);
          setStage('notify');
        } else {
          setStage('none');
        }
      })
      .catch(() => setStage('none'));
  }, []);

  async function handleClaim() {
    if (!draw) return;
    if (!street.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setError('Please fill in all address fields.');
      return;
    }
    setError('');
    setStage('submitting');
    try {
      const res = await fetch('/api/giveaway/claim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month:   draw.month,
          address: { street, city, state, zip },
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? 'Something went wrong. Please try again.');
        setStage('form');
        return;
      }
      setStage('done');
      // Auto-dismiss after 8 seconds
      setTimeout(() => setStage('none'), 8000);
    } catch {
      setError('Network error — please try again.');
      setStage('form');
    }
  }

  if (stage === 'loading' || stage === 'none') return null;

  const monthLabel = draw ? formatMonth(draw.month) : '';

  // ── Success state ──────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className="mx-4 mt-3 mb-1 rounded-2xl bg-green-600 px-4 py-3.5
                      flex items-center gap-3 animate-fade-in">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">✅</span>
        <div>
          <p className="text-sm font-black text-white">Prize claimed!</p>
          <p className="text-xs text-green-100 mt-0.5 leading-relaxed">
            We have your shipping address and will get your $25 Visa card on its way.
            Watch for an email from admin@gascap.app.
          </p>
        </div>
      </div>
    );
  }

  // ── Notify + Form states ───────────────────────────────────────────────────
  return (
    <div className="mx-4 mt-3 mb-1 rounded-2xl border-2 border-amber-400
                    bg-amber-50 overflow-hidden animate-fade-in">

      {/* Header row — always visible */}
      <div className="px-4 py-3.5 flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">🏆</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-amber-900 leading-tight">
            You won the {monthLabel} GasCap™ Giveaway!
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            Congratulations, {draw?.winnerName.split(' ')[0]}! Your $25 Visa Prepaid Card
            is waiting — claim it below.
          </p>
        </div>
        {stage === 'notify' && (
          <button
            onClick={() => setStage('form')}
            className="flex-shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-400
                       text-white text-xs font-black rounded-xl transition-colors
                       whitespace-nowrap shadow-sm"
          >
            Claim prize →
          </button>
        )}
      </div>

      {/* Inline address form — shown when stage === 'form' | 'submitting' */}
      {(stage === 'form' || stage === 'submitting') && (
        <div className="border-t border-amber-200 bg-white px-4 py-4 space-y-3">
          <p className="text-xs font-black text-slate-700">
            Ship my $25 Visa card to:
          </p>

          <div className="space-y-2">
            <input
              type="text"
              placeholder="Street address"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              disabled={stage === 'submitting'}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5
                         text-sm text-slate-700 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-amber-400
                         disabled:opacity-60"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={stage === 'submitting'}
                className="col-span-1 rounded-xl border border-slate-200 px-3 py-2.5
                           text-sm text-slate-700 placeholder:text-slate-400
                           focus:outline-none focus:ring-2 focus:ring-amber-400
                           disabled:opacity-60"
              />
              <input
                type="text"
                placeholder="State"
                maxLength={2}
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                disabled={stage === 'submitting'}
                className="rounded-xl border border-slate-200 px-3 py-2.5
                           text-sm text-slate-700 placeholder:text-slate-400 uppercase
                           focus:outline-none focus:ring-2 focus:ring-amber-400
                           disabled:opacity-60"
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="ZIP"
                maxLength={5}
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
                disabled={stage === 'submitting'}
                className="rounded-xl border border-slate-200 px-3 py-2.5
                           text-sm text-slate-700 placeholder:text-slate-400
                           focus:outline-none focus:ring-2 focus:ring-amber-400
                           disabled:opacity-60"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500 font-semibold">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleClaim}
              disabled={stage === 'submitting'}
              className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400
                         text-white text-sm font-black transition-colors
                         disabled:opacity-60 shadow-sm"
            >
              {stage === 'submitting' ? 'Submitting…' : 'Confirm & claim prize'}
            </button>
            <button
              onClick={() => setStage('notify')}
              disabled={stage === 'submitting'}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              Cancel
            </button>
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed text-center">
            U.S. addresses only. Prize ships within 5–7 business days.
            Questions? Email admin@gascap.app
          </p>
        </div>
      )}
    </div>
  );
}
