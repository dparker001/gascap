'use client';

/**
 * CookieConsentBanner — lightweight GDPR/CCPA compliance signal.
 *
 * Shows once on first visit (bottom of screen). User choice is persisted
 * in localStorage under `gc_cookie_consent` ('accepted' | 'declined').
 *
 * On accept:  nothing extra — GA4 and Meta Pixel are already loaded.
 * On decline: sets a flag that can be checked before firing analytics events.
 *             (Currently informational; extend with consent-mode in v2.)
 *
 * The banner is intentionally minimal: no dark overlay, no blocking.
 * Placed in layout so it renders on every page after first load.
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';

const CONSENT_KEY = 'gc_cookie_consent';

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const existing = localStorage.getItem(CONSENT_KEY);
      if (!existing) setVisible(true);
    } catch {
      // localStorage unavailable (private mode, SSR) — skip silently
    }
  }, []);

  function accept() {
    try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch { /* ignore */ }
    setVisible(false);
  }

  function decline() {
    try { localStorage.setItem(CONSENT_KEY, 'declined'); } catch { /* ignore */ }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed bottom-0 inset-x-0 z-50 px-4 pb-4 pointer-events-none"
    >
      <div className="pointer-events-auto max-w-xl mx-auto bg-navy-700 text-white
                      rounded-2xl shadow-2xl px-5 py-4 flex flex-col sm:flex-row
                      items-start sm:items-center gap-3">
        {/* Text */}
        <p className="text-xs text-white/80 leading-relaxed flex-1">
          We use cookies and similar tools (Google Analytics, Meta Pixel) to understand
          how GasCap™ is used and improve your experience. No personal data is sold.{' '}
          <Link href="/privacy" className="underline text-white/90 hover:text-white font-semibold">
            Privacy Policy
          </Link>
        </p>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          <button
            onClick={accept}
            className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-[#1EB68F] hover:bg-[#18a07e]
                       text-white text-xs font-black transition-colors"
          >
            Accept
          </button>
          <button
            onClick={decline}
            className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20
                       text-white text-xs font-semibold transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
