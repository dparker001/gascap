'use client';

/**
 * FreshSignupBanner — shown once, immediately after account creation.
 *
 * Triggered by the ?welcome=1 query param set by /signup (email path) and
 * the Google OAuth callbackUrl. Renders above the calculator to welcome the
 * user and nudge them to start their first calculation.
 *
 * Suppresses the WelcomeBanner first-time card (via sessionStorage flag) so
 * the two cards don't stack on top of each other for Google users who are
 * already emailVerified.
 */

import { useEffect, useState } from 'react';
import { useSearchParams }     from 'next/navigation';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';

// sessionStorage flag — tells WelcomeBanner not to double-show its first-time card
const FRESH_FLAG = 'gascap_fresh_signup';

export default function FreshSignupBanner() {
  const searchParams  = useSearchParams();
  const { data: session } = useSession();
  const { t } = useTranslation();

  const [show,      setShow]      = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const emailVerified = (session?.user as { emailVerified?: boolean })?.emailVerified ?? false;
  const rawName       = session?.user?.name ?? '';
  const firstName     = rawName.split(' ')[0] || '';

  // Detect ?welcome=1, clean the URL, set session flag
  useEffect(() => {
    if (searchParams.get('welcome') !== '1') return;

    setShow(true);

    // Tell WelcomeBanner not to double-show its first-time tips card
    try { sessionStorage.setItem(FRESH_FLAG, '1'); } catch { /* ignore */ }

    // Strip the param without a page reload
    const url = new URL(window.location.href);
    url.searchParams.delete('welcome');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams]);

  // Auto-dismiss after 9 s
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setDismissed(true), 9000);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show || dismissed) return null;

  const heading = firstName
    ? t.freshSignupBanner.headingNamed(firstName)
    : t.freshSignupBanner.headingGeneric;

  const body = emailVerified
    ? t.freshSignupBanner.bodyVerified
    : t.freshSignupBanner.bodyUnverified;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-4 lg:mx-0 mb-4 relative overflow-hidden
                 bg-gradient-to-r from-[#005F4A] to-[#1EB68F]
                 rounded-2xl shadow-md"
    >
      {/* Decorative gas-pump arc */}
      <svg
        className="absolute right-0 top-0 h-full opacity-[0.07] pointer-events-none"
        viewBox="0 0 100 80" aria-hidden="true" preserveAspectRatio="xMaxYMid slice"
      >
        <path d="M 80 75 A 60 60 0 0 0 20 75"
          fill="none" stroke="white" strokeWidth="14" strokeLinecap="round" />
      </svg>

      <div className="relative flex items-start gap-3 px-4 py-4 pr-10">
        {/* Icon */}
        <span className="flex-shrink-0 text-2xl mt-0.5" aria-hidden="true">⛽</span>

        {/* Text */}
        <div className="min-w-0">
          <p className="text-white font-black text-[15px] leading-snug">{heading}</p>
          <p className="text-white/75 text-[13px] mt-0.5 leading-snug">{body}</p>

          {/* Down-arrow CTA */}
          <div className="flex items-center gap-1 mt-2">
            <span className="text-white/60 text-[11px] font-semibold tracking-wide uppercase">
              {t.freshSignupBanner.startCalculating}
            </span>
            <svg viewBox="0 0 12 12" className="w-3 h-3 text-white/60 mt-px"
                 fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
                 aria-hidden="true">
              <path d="M6 2v8M2 7l4 4 4-4" />
            </svg>
          </div>
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={() => setDismissed(true)}
        aria-label={t.freshSignupBanner.dismissAriaLabel}
        className="absolute top-3 right-3 text-white/35 hover:text-white/75
                   transition-colors p-1 rounded-full"
      >
        <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
             stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M2 2l8 8M10 2L2 10" />
        </svg>
      </button>
    </div>
  );
}
