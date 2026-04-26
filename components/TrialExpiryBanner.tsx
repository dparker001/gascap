'use client';

/**
 * TrialExpiryBanner
 *
 * Shows a dismissible upgrade nudge when a Pro trial user has 5 or fewer
 * days remaining. Dismissed state persists in sessionStorage so it doesn't
 * re-appear on every page interaction within the same browser session.
 *
 * Visible only to:
 *  - Signed-in users
 *  - Whose plan is 'pro' AND isProTrial is true
 *  - Whose betaProExpiry is within WARN_DAYS days from now
 */

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const WARN_DAYS        = 5;   // show banner when ≤ this many days remain
const DISMISS_KEY      = 'gc_trial_banner_dismissed';

export default function TrialExpiryBanner() {
  const { data: session, status } = useSession();
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    }
  }, []);

  if (status === 'loading' || dismissed) return null;

  const user = session?.user as {
    plan?:          string;
    isProTrial?:    boolean;
    betaProExpiry?: string | null;
  } | undefined;

  if (!user) return null;
  if (user.plan !== 'pro' || !user.isProTrial || !user.betaProExpiry) return null;

  const msRemaining  = new Date(user.betaProExpiry).getTime() - Date.now();
  const daysLeft     = Math.ceil(msRemaining / 86_400_000);

  // Only show when trial is active and expiry is within the warning window
  if (daysLeft > WARN_DAYS || daysLeft < 0) return null;

  const isLastDay  = daysLeft <= 1;
  const dayLabel   = isLastDay ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`mx-4 mt-3 mb-1 max-w-lg mx-auto rounded-2xl border px-4 py-3
                  flex items-start gap-3 shadow-sm
                  ${isLastDay
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'}`}
    >
      {/* Icon */}
      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">
        {isLastDay ? '⏰' : '⚡'}
      </span>

      {/* Copy */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-black leading-snug
                       ${isLastDay ? 'text-red-800' : 'text-amber-800'}`}>
          Your Pro trial ends {dayLabel}
        </p>
        <p className={`text-[11px] mt-0.5 leading-relaxed
                       ${isLastDay ? 'text-red-700' : 'text-amber-700'}`}>
          Keep fill-up tracking, MPG insights, and AI advisor — just $4.99/mo.
        </p>

        <div className="flex items-center gap-3 mt-2">
          <Link
            href="/upgrade"
            className={`px-3 py-1.5 rounded-xl text-xs font-black text-white
                        transition-colors whitespace-nowrap
                        ${isLastDay
                          ? 'bg-red-600 hover:bg-red-500'
                          : 'bg-amber-500 hover:bg-amber-400'}`}
          >
            Upgrade now →
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className={`text-[11px] font-semibold hover:underline
                        ${isLastDay ? 'text-red-500' : 'text-amber-600'}`}
          >
            Remind me later
          </button>
        </div>
      </div>

      {/* Dismiss X */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className={`flex-shrink-0 text-lg leading-none mt-0.5
                    ${isLastDay ? 'text-red-300 hover:text-red-500' : 'text-amber-300 hover:text-amber-500'}
                    transition-colors`}
      >
        ×
      </button>
    </div>
  );
}
