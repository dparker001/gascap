'use client';

/**
 * /amoe — Free Alternative Method of Entry
 * No purchase necessary. One entry per person per calendar month.
 */

import { useState, FormEvent } from 'react';
import Link from 'next/link';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function currentMonthLabel(): string {
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

export default function AmoePage() {
  const [firstName,     setFirstName]     = useState('');
  const [lastName,      setLastName]      = useState('');
  const [email,         setEmail]         = useState('');
  const [ageConfirmed,  setAgeConfirmed]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success,    setSuccess]   = useState(false);
  const [errorMsg,   setErrorMsg]  = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/amoe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          website: '', // honeypot — always blank for real users
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? 'Something went wrong. Please try again.');
      } else {
        setSuccess(true);
      }
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#005F4A]">

      {/* Header */}
      <div className="px-5 pt-10 pb-6">
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <Link href="/giveaway" className="text-white/50 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </Link>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F]">GasCap™</p>
            <p className="text-white font-black text-lg leading-tight">Free Entry</p>
          </div>
          <div className="w-5" />
        </div>
      </div>

      <div className="max-w-sm mx-auto px-5 space-y-4 pb-12">

        {success ? (
          /* ── Success state ─────────────────────────────────────── */
          <div className="space-y-5 py-4">
            <div className="text-center space-y-3">
              <p className="text-6xl">🎉</p>
              <p className="text-white text-2xl font-black leading-tight">You&apos;re entered!</p>
              <p className="text-white/60 text-sm leading-relaxed">
                Your free entry for the <strong className="text-white">{currentMonthLabel()}</strong> drawing
                has been received. One winner is drawn on the 5th of next month.
              </p>
            </div>

            <div className="bg-white/10 border border-white/10 rounded-2xl p-4 text-center space-y-2">
              <p className="text-white/80 text-xs leading-relaxed">
                Want up to <strong className="text-amber-400">31× more entries</strong> every month?
                Upgrade to Pro and earn one entry automatically every day you open the app.
              </p>
              <Link
                href="/upgrade"
                className="block w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400
                           text-white font-black text-sm transition-colors mt-2"
              >
                ⭐ Upgrade to Pro — $4.99/mo
              </Link>
            </div>

            <div className="text-center">
              <Link href="/" className="text-[11px] text-white/40 hover:text-white/70 transition-colors">
                ← Back to GasCap™
              </Link>
            </div>
          </div>

        ) : (
          /* ── Entry form ────────────────────────────────────────── */
          <>
            <div className="text-center py-2 space-y-1">
              <p className="text-white text-xl font-black">
                Enter the {currentMonthLabel()} Drawing
              </p>
              <p className="text-white/60 text-sm">
                No purchase necessary. One free entry per person per month.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3" noValidate>

              {/* Honeypot — visually hidden, never filled by real users */}
              <input
                type="text"
                name="website"
                autoComplete="off"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0 }}
              />

              {/* First name */}
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5 uppercase tracking-wide">
                  First Name
                </label>
                <input
                  type="text"
                  required
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
                             text-white placeholder-white/30 text-sm focus:outline-none
                             focus:border-[#1EB68F] focus:ring-1 focus:ring-[#1EB68F] transition-colors"
                />
              </div>

              {/* Last name */}
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5 uppercase tracking-wide">
                  Last Name
                </label>
                <input
                  type="text"
                  required
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
                             text-white placeholder-white/30 text-sm focus:outline-none
                             focus:border-[#1EB68F] focus:ring-1 focus:ring-[#1EB68F] transition-colors"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-white/60 text-xs font-bold mb-1.5 uppercase tracking-wide">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
                             text-white placeholder-white/30 text-sm focus:outline-none
                             focus:border-[#1EB68F] focus:ring-1 focus:ring-[#1EB68F] transition-colors"
                />
                <p className="text-white/30 text-[10px] mt-1 leading-snug">
                  Used only to notify you if you win. We never spam or sell your info.
                </p>
              </div>

              {/* Age & residency confirmation */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={ageConfirmed}
                  onChange={(e) => setAgeConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 flex-shrink-0 rounded accent-[#1EB68F] cursor-pointer"
                />
                <span className="text-white/60 text-xs leading-relaxed">
                  I confirm that I am <strong className="text-white/80">18 years of age or older</strong> and
                  a <strong className="text-white/80">legal resident of the United States</strong>.
                </span>
              </label>

              {/* Error */}
              {errorMsg && (
                <div className="bg-red-500/20 border border-red-400/30 rounded-xl px-4 py-2.5">
                  <p className="text-red-300 text-xs font-semibold">{errorMsg}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !firstName.trim() || !lastName.trim() || !email.trim() || !ageConfirmed}
                className="w-full py-4 rounded-2xl bg-[#1EB68F] hover:bg-[#17a07f] active:scale-[0.98]
                           text-white font-black text-sm transition-all disabled:opacity-40
                           disabled:pointer-events-none mt-1"
              >
                {submitting ? 'Submitting…' : '🎁 Submit My Free Entry'}
              </button>
            </form>

            {/* Upgrade nudge */}
            <div className="bg-white/8 border border-white/10 rounded-2xl p-4 space-y-2">
              <p className="text-white/70 text-xs font-bold">Want more entries?</p>
              <p className="text-white/50 text-xs leading-relaxed">
                Pro members earn 1 entry automatically every day they open the app —
                up to <strong className="text-white/80">31 entries per month</strong> vs your 1 free entry.
              </p>
              <Link
                href="/upgrade"
                className="block text-center w-full py-2.5 rounded-xl bg-amber-500/90 hover:bg-amber-500
                           text-white font-black text-xs transition-colors"
              >
                ⭐ Upgrade to Pro — $4.99/mo
              </Link>
            </div>

            {/* Legal */}
            <div className="text-center space-y-1.5 pt-1">
              <Link
                href="/sweepstakes-rules"
                className="text-[11px] text-white/40 hover:text-white/70 underline transition-colors"
              >
                Official Rules →
              </Link>
              <p className="text-[10px] text-white/25">
                No purchase necessary. A purchase does not improve your odds of winning.
                Open to US residents 18+. Void where prohibited.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
