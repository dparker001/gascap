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
 *  - Whose trialExpiresAt is within WARN_DAYS days from now
 */

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { useIsNative } from '@/hooks/useIsNative';
import { trackClientEvent } from '@/lib/clientAnalytics';

const WARN_DAYS        = 15;  // show banner when ≤ this many days remain
const DISMISS_KEY      = 'gc_trial_banner_dismissed';

interface TrialValueSummary {
  calculations:   number | null;
  vehicles:       number;
  fillups:        number;
  rentalSessions: number;
}

function plural(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

/** Compact "N fill-ups • N vehicles • N rentals" line — omits zero/unreliable metrics. */
function trialValueLine(summary: TrialValueSummary | null): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.fillups > 0) parts.push(plural(summary.fillups, 'fill-up'));
  if (summary.vehicles > 0) parts.push(plural(summary.vehicles, 'vehicle'));
  if (summary.rentalSessions > 0) parts.push(plural(summary.rentalSessions, 'rental'));
  if (summary.calculations !== null && summary.calculations > 0) parts.push(plural(summary.calculations, 'GasCap calculation'));
  return parts.length > 0 ? parts.join(' • ') : null;
}

export default function TrialExpiryBanner() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const isNative = useIsNative();
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash
  const [trialValue, setTrialValue] = useState<TrialValueSummary | null>(null);
  const viewTrackedRef = useRef(false); // one-shot guard, stable across rerenders

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    }
  }, []);

  const sessionUser = session?.user as {
    plan?:           string;
    isProTrial?:     boolean;
    trialExpiresAt?: string | null;
  } | undefined;

  const daysLeftRaw = sessionUser?.trialExpiresAt
    ? Math.ceil((new Date(sessionUser.trialExpiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const wouldShowBanner =
    status !== 'loading' && !dismissed && !isNative && !!sessionUser &&
    sessionUser.plan === 'pro' && sessionUser.isProTrial && !!sessionUser.trialExpiresAt &&
    daysLeftRaw !== null && daysLeftRaw <= WARN_DAYS && daysLeftRaw >= 0;

  // Only fetch the value summary when the banner would otherwise actually be
  // eligible to render — never for unauthenticated users, non-trial users,
  // native wrappers, trials with more than WARN_DAYS remaining, or expired
  // trials. A failed fetch is swallowed (recap line is optional polish) and
  // must never hide or break the underlying trial reminder itself.
  useEffect(() => {
    if (!wouldShowBanner) return;
    fetch('/api/user/trial-value')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTrialValue(d as TrialValueSummary); })
      .catch(() => { /* recap line is optional polish — never break the banner */ });
  }, [wouldShowBanner]);

  const recapLineForTracking = wouldShowBanner ? trialValueLine(trialValue) : null;

  // Analytics — fire once per mounted impression when the personalized recap
  // actually renders. A ref-backed one-shot guard (not just the dependency
  // array) ensures a rerender that recomputes the same non-null recap line
  // can never emit a second view event for this impression. Narrow metadata
  // only: stage, daysRemaining, and boolean flags — never raw counts, PII.
  useEffect(() => {
    if (!recapLineForTracking || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    trackClientEvent('trial_value_recap_viewed', {
      stage:            'banner',
      daysRemaining:    daysLeftRaw ?? undefined,
      hasCalculations:  !!(trialValue && trialValue.calculations !== null && trialValue.calculations > 0),
      hasVehicles:      !!(trialValue && trialValue.vehicles > 0),
      hasFillups:       !!(trialValue && trialValue.fillups > 0),
      hasRentalSessions: !!(trialValue && trialValue.rentalSessions > 0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recapLineForTracking]);

  if (status === 'loading' || dismissed) return null;
  // Hidden in the native wrappers — no in-app upgrade steering (App Store / Play
  // anti-steering). Native trial users are nudged to upgrade via email + the web.
  if (isNative) return null;

  const user = session?.user as {
    plan?:           string;
    isProTrial?:     boolean;
    trialExpiresAt?: string | null;
  } | undefined;

  if (!user) return null;
  if (user.plan !== 'pro' || !user.isProTrial || !user.trialExpiresAt) return null;

  const msRemaining  = new Date(user.trialExpiresAt).getTime() - Date.now();
  const daysLeft     = Math.ceil(msRemaining / 86_400_000);

  // Only show when trial is active and expiry is within the warning window
  if (daysLeft > WARN_DAYS || daysLeft < 0) return null;

  // Urgency tiers
  const isUrgent   = daysLeft <= 1;   // red  — last day
  const isWarning  = daysLeft <= 5;   // amber — 2–5 days
  // else gentle     = 6–15 days (teal/green)

  const icon   = isUrgent ? '⏰' : isWarning ? '⚡' : '🗓️';

  const colors = isUrgent
    ? { bg: 'bg-red-50',   border: 'border-red-200',   title: 'text-red-800',   body: 'text-red-700',   btn: 'bg-red-600 hover:bg-red-500',     link: 'text-red-500',   x: 'text-red-300 hover:text-red-500'   }
    : isWarning
    ? { bg: 'bg-amber-50', border: 'border-amber-200', title: 'text-amber-800', body: 'text-amber-700', btn: 'bg-amber-500 hover:bg-amber-400', link: 'text-amber-600', x: 'text-amber-300 hover:text-amber-500' }
    : { bg: 'bg-teal-50',  border: 'border-teal-200',  title: 'text-teal-800',  body: 'text-teal-700',  btn: 'bg-teal-600 hover:bg-teal-500',   link: 'text-teal-600',  x: 'text-teal-300 hover:text-teal-500'  };

  const headline = isUrgent
    ? t.trialBanner.endsToday
    : t.trialBanner.endsDays(daysLeft);

  const subline = isUrgent || isWarning
    ? t.trialBanner.keepFeatures
    : t.trialBanner.lockInRate;

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  function handleUpgradeClick() {
    // The event name means "clicked Upgrade from a banner that ACTUALLY
    // displayed the personalized recap" — a zero-activity/failed-fetch
    // generic banner click must not be counted as a recap-attributed click.
    // Navigation to /upgrade is unaffected either way (this only guards the
    // analytics call, never the Link itself).
    if (!recapLine) return;
    trackClientEvent('trial_value_recap_upgrade_clicked', {
      stage:            'banner',
      daysRemaining:    daysLeft,
      hasCalculations:  !!(trialValue && trialValue.calculations !== null && trialValue.calculations > 0),
      hasVehicles:      !!(trialValue && trialValue.vehicles > 0),
      hasFillups:       !!(trialValue && trialValue.fillups > 0),
      hasRentalSessions: !!(trialValue && trialValue.rentalSessions > 0),
    });
  }

  const recapLine = trialValueLine(trialValue);

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
        <p className={`text-[11px] mt-0.5 font-semibold leading-relaxed ${colors.body}`}>
          {t.trialBanner.bonusEntries}
        </p>
        {recapLine && (
          <p className={`text-[11px] mt-1 leading-relaxed ${colors.body}`}>
            Your Pro activity: {recapLine}
          </p>
        )}

        <div className="flex items-center gap-3 mt-2">
          <Link
            href="/upgrade"
            onClick={handleUpgradeClick}
            className={`px-3 py-1.5 rounded-xl text-xs font-black text-white
                        transition-colors whitespace-nowrap ${colors.btn}`}
          >
            {t.trialBanner.upgradeNow}
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className={`text-[11px] font-semibold hover:underline ${colors.link}`}
          >
            {t.trialBanner.remindLater}
          </button>
        </div>
      </div>

      {/* Dismiss X */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t.trialBanner.dismiss}
        className={`flex-shrink-0 text-lg leading-none mt-0.5 transition-colors ${colors.x}`}
      >
        ×
      </button>
    </div>
  );
}
