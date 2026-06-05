'use client';

/**
 * AdLandingBanner — shown to visitors arriving from a paid ad (Google Ads adds
 * `gclid`; we also accept `utm_source=google` or `?ad=1`). Leads with the
 * Lifetime + complimentary getaway hook to give cold ad traffic a reason to
 * convert, with a low-friction FREE signup as the primary action (the tracked
 * conversion) and the Lifetime+getaway purchase as the upsell.
 *
 * - Only renders while the getaway promo is active.
 * - Remembers "came from ad" in sessionStorage so it persists across the visit.
 * - Dismissible (localStorage) and hidden for existing Lifetime owners.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { PRICING }             from '@/lib/stripe';
import { getawayPromoActive }  from '@/lib/getawayPromo';

const FROM_AD_KEY = 'gc_from_ad';
const DISMISS_KEY = 'gc_ad_banner_dismissed';

export default function AdLandingBanner() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!getawayPromoActive()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;

      let fromAd = sessionStorage.getItem(FROM_AD_KEY) === '1';
      if (!fromAd) {
        const p = new URLSearchParams(window.location.search);
        const utm = (p.get('utm_source') ?? '').toLowerCase();
        if (p.has('gclid') || p.has('ad') || utm.includes('google') || utm.includes('cpc')) {
          fromAd = true;
          sessionStorage.setItem(FROM_AD_KEY, '1');
        }
      }
      setShow(fromAd);
    } catch { /* storage blocked — just don't show */ }
  }, []);

  // Hide for existing Lifetime owners (nothing to upsell)
  const interval = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  if (!show || (session?.user && interval === 'lifetime')) return null;

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setShow(false);
  }

  const price = PRICING.pro.lifetime.toFixed(2);

  return (
    <div className="px-4 pt-3 max-w-3xl mx-auto w-full">
      <div className="relative rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-4 py-3.5 shadow-md border border-white/10">
        <button
          onClick={dismiss}
          aria-label={t.adBanner.dismiss}
          className="absolute top-1.5 right-2.5 text-white/55 hover:text-white text-base leading-none"
        >
          ✕
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pr-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-2xl flex-shrink-0" aria-hidden="true">🏝️</span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                {t.adBanner.eyebrow}
              </p>
              <p className="text-white text-sm font-bold leading-snug">
                {t.adBanner.headline} <span className="text-amber-300 whitespace-nowrap">${price}</span>
              </p>
              <p className="text-white/55 text-[10px] leading-snug mt-0.5">
                {t.adBanner.disclosure}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 flex-shrink-0 w-full sm:w-auto">
            <a
              href="/signup"
              className="bg-amber-400 hover:bg-amber-300 text-navy-900 text-sm font-black
                         px-4 py-2.5 rounded-xl text-center whitespace-nowrap transition-colors"
            >
              {t.adBanner.ctaFree}
            </a>
            <a
              href="/upgrade"
              className="text-white/85 hover:text-white text-[11px] font-bold text-center
                         underline underline-offset-2 transition-colors"
            >
              {t.adBanner.ctaLifetime}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
