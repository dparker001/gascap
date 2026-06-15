'use client';

/**
 * ComebackBanner
 *
 * In-app companion to the win-back email campaign. Shown to lapsed free users
 * (completed a Pro trial, now on free) — surfaces the $9.99 Lifetime comeback
 * offer when they open the app, linking to /upgrade?wb=1 (the server applies +
 * re-validates the discount). Eligibility is checked via /api/winback/status so
 * it never shows to users it doesn't apply to.
 *
 * Hidden in the native wrappers (App Store / Play anti-steering) and dismissible
 * for the session.
 */

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useIsNative } from '@/hooks/useIsNative';

const DISMISS_KEY = 'gc_comeback_banner_dismissed';

export default function ComebackBanner() {
  const { data: session, status } = useSession();
  const isNative = useIsNative();
  const [eligible, setEligible]   = useState(false);
  const [getaway, setGetaway]     = useState(false);
  const [dismissed, setDismissed] = useState(true); // start hidden to avoid flash

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    }
  }, []);

  // Only check eligibility for signed-in free users (skip trials/paid/guests).
  const plan = (session?.user as { plan?: string } | undefined)?.plan;
  useEffect(() => {
    if (status !== 'authenticated' || plan !== 'free' || isNative) return;
    let active = true;
    fetch('/api/winback/status')
      .then((r) => r.json())
      .then((d: { eligible?: boolean; getaway?: boolean }) => {
        if (!active) return;
        setEligible(!!d.eligible);
        setGetaway(!!d.getaway);
      })
      .catch(() => { /* silent */ });
    return () => { active = false; };
  }, [status, plan, isNative]);

  if (isNative || dismissed || !eligible) return null;

  function handleDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div
      role="region"
      aria-label="Comeback offer"
      className="mx-4 mt-3 mb-1 max-w-lg mx-auto rounded-2xl border border-teal-300 bg-teal-50
                 px-4 py-3 flex items-start gap-3 shadow-sm"
    >
      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">👋</span>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-black leading-snug text-teal-800">
          Welcome back — get Pro Lifetime for $9.99 (50% off){getaway ? ' + a free getaway 🏝️' : ''}
        </p>
        <p className="text-[11px] mt-0.5 leading-relaxed text-teal-700">
          One payment, Pro forever. Your saved vehicles &amp; history unlock instantly.{getaway ? ' Plus a complimentary resort getaway certificate.' : ''}
        </p>

        <div className="flex items-center gap-3 mt-2">
          <Link
            href="/upgrade?wb=1"
            className="px-3 py-1.5 rounded-xl text-xs font-black text-white bg-teal-600
                       hover:bg-teal-500 transition-colors whitespace-nowrap"
          >
            Claim $9.99 Lifetime
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-[11px] font-semibold text-teal-600 hover:underline"
          >
            Not now
          </button>
        </div>

        {getaway && (
          <p className="text-[9px] mt-1.5 leading-snug text-teal-600/70">
            *Resort getaway = hotel certificate; you cover taxes &amp; fees. Flights not included. Full terms on the upgrade page.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-lg leading-none mt-0.5 text-teal-300 hover:text-teal-500 transition-colors"
      >
        ×
      </button>
    </div>
  );
}
