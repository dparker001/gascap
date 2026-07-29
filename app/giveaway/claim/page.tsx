'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Stage = 'loading' | 'invalid' | 'expired' | 'already_claimed' | 'ready' | 'submitting' | 'done' | 'error';

function ClaimContent() {
  const params  = useSearchParams();
  const month   = params.get('month')  ?? '';
  const token   = params.get('token')  ?? '';

  const [stage, setStage]         = useState<Stage>('loading');
  const [firstName, setFirstName] = useState('');
  const [monthLabel, setMonthLabel] = useState('');
  const [prize, setPrize]         = useState('$50');
  const [checked, setChecked]     = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    if (!month || !token) { setStage('invalid'); return; }
    fetch(`/api/giveaway/claim?month=${encodeURIComponent(month)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; reason?: string; firstName?: string; monthLabel?: string; prize?: string }) => {
        if (!d.ok) {
          setStage(d.reason === 'already_claimed' ? 'already_claimed' : d.reason === 'expired' ? 'expired' : 'invalid');
          return;
        }
        setFirstName(d.firstName ?? '');
        setMonthLabel(d.monthLabel ?? '');
        setPrize(d.prize ?? '$50');
        setStage('ready');
      })
      .catch(() => setStage('invalid'));
  }, [month, token]);

  async function handleConfirm() {
    if (!checked) {
      setError('Please check the box to certify your eligibility.');
      return;
    }
    setError('');
    setStage('submitting');
    try {
      const res = await fetch('/api/giveaway/claim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ month, token, certifiedAdult: true }),
      });
      const d = await res.json() as { ok: boolean; error?: string };
      if (!d.ok) {
        setError(d.error ?? 'Something went wrong. Please try again.');
        setStage('ready');
        return;
      }
      setStage('done');
    } catch {
      setError('Network error — please try again.');
      setStage('ready');
    }
  }

  return (
    <div className="min-h-screen bg-[#005F4A] flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-6 space-y-4">

        {stage === 'loading' && (
          <p className="text-center text-slate-500 text-sm py-8">Loading…</p>
        )}

        {stage === 'invalid' && (
          <div className="text-center py-6 space-y-2">
            <p className="text-4xl">🔗</p>
            <p className="text-lg font-black text-slate-800">Link not valid</p>
            <p className="text-sm text-slate-500">
              This claim link doesn&apos;t match a recorded giveaway win. Double-check the link
              from your email, or contact us if you think this is a mistake.
            </p>
          </div>
        )}

        {stage === 'expired' && (
          <div className="text-center py-6 space-y-2">
            <p className="text-4xl">⏰</p>
            <p className="text-lg font-black text-slate-800">Claim window closed</p>
            <p className="text-sm text-slate-500">
              Prizes must be claimed within 3 days of winning. This window has passed — an
              alternate winner may have already been selected. Email{' '}
              <a href="mailto:support@gascap.app" className="text-[#1EB68F] underline">support@gascap.app</a>{' '}
              with questions.
            </p>
          </div>
        )}

        {stage === 'already_claimed' && (
          <div className="text-center py-6 space-y-2">
            <p className="text-4xl">✅</p>
            <p className="text-lg font-black text-slate-800">Already claimed</p>
            <p className="text-sm text-slate-500">
              This prize has already been confirmed and sent. If that wasn&apos;t you, email{' '}
              <a href="mailto:support@gascap.app" className="text-[#1EB68F] underline">support@gascap.app</a> right away.
            </p>
          </div>
        )}

        {(stage === 'ready' || stage === 'submitting') && (
          <>
            <div className="text-center space-y-1">
              <p className="text-5xl">🏆</p>
              <p className="text-lg font-black text-slate-800">
                Congrats{firstName ? `, ${firstName}` : ''}!
              </p>
              <p className="text-sm text-slate-500">
                You won the {monthLabel} GasCap™ Gas Card Giveaway.
              </p>
            </div>

            <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">Your Prize</p>
              <p className="text-3xl font-black text-slate-800">{prize} Visa Prepaid Card</p>
            </div>

            <label className="flex items-start gap-3 text-xs text-slate-600 leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={stage === 'submitting'}
                className="mt-0.5 h-4 w-4 flex-shrink-0"
              />
              <span>
                I certify that I am <strong>18 years of age or older</strong>, a legal resident of
                the United States, and eligible to win per the{' '}
                <Link href="/sweepstakes-rules" className="text-[#1EB68F] underline" target="_blank">
                  Official Rules
                </Link>.
              </span>
            </label>

            {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

            <button
              onClick={handleConfirm}
              disabled={stage === 'submitting' || !checked}
              className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50
                         text-white text-sm font-black transition-colors shadow-sm"
            >
              {stage === 'submitting' ? 'Confirming…' : 'Confirm & Claim My Prize'}
            </button>
          </>
        )}

        {stage === 'done' && (
          <div className="text-center py-6 space-y-2">
            <p className="text-4xl">🎉</p>
            <p className="text-lg font-black text-slate-800">Prize confirmed!</p>
            <p className="text-sm text-slate-500">
              Your {prize} Visa prepaid card is on its way to your email — it may take up to 24
              hours to arrive. Check your spam folder if you don&apos;t see it.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#005F4A]" />}>
      <ClaimContent />
    </Suspense>
  );
}
