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

const WARN_DAYS        = 15;  // show banner when ≤ this many days remain
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

  // Urgency tiers
  const isUrgent   = daysLeft <= 1;   // red  — last day
  const isWarning  = daysLeft <= 5;   // amber — 2–5 days
  // else gentle     = 6–15 days (teal/green)

  const icon     = isUrgent ? '⏰' : isWarning ? '⚡' : '🗓️';
  const dayLabel = isUrgent ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  const colors = isUrgent
    ? { bg: 'bg-red-50',   border: 'border-red-200',   title: 'text-red-800',   body: 'text-red-700',   btn: 'bg-red-600 hover:bg-red-500',     link: 'text-red-500',   x: 'text-red-300 hover:text-red-500'   }
    : isWarning
    ? { bg: 'bg-amber-50', border: 'border-amber-200', title: 'text-amber-800', body: 'text-amber-700', btn: 'bg-amber-500 hover:bg-amber-400', link: 'text-amber-600', x: 'text-amber-300 hover:text-amber-500' }
    : { bg: 'bg-teal-50',  border: 'border-teal-200',  title: 'text-teal-800',  body: 'text-teal-700',  btn: 'bg-teal-600 hover:bg-teal-500',   link: 'text-teal-600',  x: 'text-teal-300 hover:text-teal-500'  };

  const headline = isUrgent
    ? `Your Pro trial ends today`
    : `Your Pro trial ends ${dayLabel}`;

  const subline = isUrgent || isWarning
    ? 'Keep fill-up tracking, MPG insights, and AI advisor — just $4.99/mo.'
    : `Enjoying Pro? Lock in your rate before the trial ends.`;

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`mx-4 mt-3 mb-1 max-w-lg mx-auto rounded-2xl border px-4 py-3
                  flex items-start gap-3 shadow-sm ${colors.bg} ${colors.border}`}
    >
      {/* Icon */}
      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">{icon}</span>

      {/* Copy */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-black leading-snug ${colors.title}`}>{headline}</p>
        <p className={`text-[11px] mt-0.5 leading-relaxed ${colors.body}`}>{subline}</p>

        <div className="flex items-center gap-3 mt-2">
          <Link
            href="/upgrade"
            className={`px-3 py-1.5 rounded-xl text-xs font-black text-white
                        transition-colors whitespace-nowrap ${colors.btn}`}
          >
            Upgrade now →
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className={`text-[11px] font-semibold hover:underline ${colors.link}`}
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
        className={`flex-shrink-0 text-lg leading-none mt-0.5 transition-colors ${colors.x}`}
      >
        ×
      </button>
    </div>
  );
}
