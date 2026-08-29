'use client';

/**
 * AdLandingBanner — a pop-up (modal) shown to non-members (logged-out visitors +
 * free-tier users) while the getaway promo is active. Leads with the Lifetime +
 * complimentary getaway hook to give unconverted traffic a reason to act, with a
 * low-friction FREE signup as the primary action and the Lifetime+getaway
 * purchase as the upsell.
 *
 * Behaviour (per product): pops up a couple seconds after the site loads, can be
 * closed (✕ / backdrop / "Maybe later"), and auto-dismisses on a timer if the
 * visitor doesn't interact.
 *
 * Politeness:
 *   - shows at most once per browser session (sessionStorage),
 *   - if manually dismissed, stays hidden for COOLDOWN_DAYS (localStorage),
 *   - only while the getaway promo is active,
 *   - hidden for existing members (any active paid plan or Pro trial).
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { PRICING }             from '@/lib/stripe';
import { getawayPromoActive }  from '@/lib/getawayPromo';
import { trackUpgradeClick }   from '@/lib/gtag';
import { useIsNative }         from '@/hooks/useIsNative';

const SESSION_KEY  = 'gc_ad_popup_shown';      // shown once this session
const DISMISS_KEY  = 'gc_ad_popup_dismissed';  // ms timestamp of last manual close

const COOLDOWN_DAYS = 1;      // after a manual close, stay hidden this long
const SHOW_DELAY_MS = 2500;   // wait after load before popping up
const AUTO_HIDE_MS  = 12000;  // auto-dismiss if the visitor doesn't interact
const RESULT_RECHECK_MS  = 1500;   // how often to re-check whether a result is on screen
const MAX_RESULT_WAIT_MS = 30000;  // give up entirely rather than nag someone mid-task

// 2026-08-29 (CR-3B) — same canonical activation contract CR-3A introduced
// for NewMemberOfferBanner: no promotional interruption before the visitor
// has experienced the product's core value at least once. Reuses the
// existing key/event rather than introducing a second one.
//
// Unlike NewMemberOfferBanner (only mounted on the authenticated homepage,
// where FirstCalcNudge already writes this key), AdLandingBanner is mounted
// globally, including for guests who can use the calculator without
// FirstCalcNudge ever mounting. So AdLandingBanner must itself persist the
// flag on gascap:calculated — it can't only read a key some other component
// might not have written yet for this visitor.
const FIRST_CALC_DONE_KEY = 'gc_has_calculated';

export default function AdLandingBanner() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const isNative = useIsNative();   // suppress the upsell pop-up in native wrappers
  const [show, setShow] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);

  // Activation gate: read the existing flag on mount, and persist it (for
  // guests who may never have FirstCalcNudge mounted to do so) the moment a
  // calculation happens. setHasCalculated(true) always runs on the event —
  // even if localStorage is blocked — so the CURRENT session still activates.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(FIRST_CALC_DONE_KEY) === '1') setHasCalculated(true);
    } catch { /* ignore — treat as not-yet-activated */ }

    const onCalc = () => {
      try { localStorage.setItem(FIRST_CALC_DONE_KEY, '1'); } catch { /* ignore */ }
      setHasCalculated(true);
    };
    window.addEventListener('gascap:calculated', onCalc);
    return () => window.removeEventListener('gascap:calculated', onCalc);
  }, []);

  // Decide whether to pop up (waits for the session to resolve first).
  useEffect(() => {
    if (status === 'loading') return;
    if (!hasCalculated) return; // product value first — no interruption before it
    if (!getawayPromoActive()) return;

    const plan       = (session?.user as { plan?: string })?.plan ?? 'free';
    const isProTrial = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;
    const isMember   = !!session?.user && (plan === 'pro' || plan === 'fleet' || isProTrial);
    if (isMember) return; // members are already converted — nothing to pitch

    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return;
      const last = parseInt(localStorage.getItem(DISMISS_KEY) ?? '0', 10) || 0;
      if (Date.now() - last < COOLDOWN_DAYS * 86_400_000) return;
    } catch { /* storage blocked — still show */ }

    // Don't interrupt a calculation. The pop-up runs on a load timer, so it
    // used to land wherever the visitor happened to be — including directly
    // over a fresh result, which is the one moment the app has just proven
    // its value. Wait until no result is on screen, re-checking on an
    // interval, and give up rather than nag if they stay on it.
    let waited = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      setShow(true);
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
    };

    const timer = setTimeout(function attempt() {
      const el = document.querySelector('[data-calc-result]');
      const resultOnScreen = !!el && (() => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight;
      })();

      if (!resultOnScreen) { reveal(); return; }
      waited += RESULT_RECHECK_MS;
      if (waited >= MAX_RESULT_WAIT_MS) return; // reading it this long — leave them alone
      retry = setTimeout(attempt, RESULT_RECHECK_MS);
    }, SHOW_DELAY_MS);

    return () => { clearTimeout(timer); if (retry) clearTimeout(retry); };
  }, [status, session, hasCalculated]);

  // Auto-dismiss on a timer once visible.
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setShow(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show || isNative) return null;

  // Soft close (backdrop / auto-hide / "Maybe later") — won't show again this
  // session, but may return on a later visit.
  function close() { setShow(false); }

  // Hard close (✕) — also start the cooldown so they aren't pestered next visit.
  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  }

  const price = PRICING.pro.lifetime.toFixed(2);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-lift overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Branded header */}
        <div className="bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-6 pt-6 pb-5 text-center">
          <button
            onClick={dismiss}
            aria-label={t.adBanner.dismiss}
            className="absolute top-3 right-3.5 text-white/60 hover:text-white text-xl leading-none"
          >
            ✕
          </button>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
            {t.adBanner.eyebrow}
          </p>
          <p className="text-4xl mt-1" aria-hidden="true">🏝️</p>
          <h2 className="text-white text-lg font-black leading-snug mt-2">
            {t.adBanner.headline}{' '}
            <span className="text-amber-300 whitespace-nowrap">${price}</span>
          </h2>
          <p className="text-white/60 text-[11px] leading-snug mt-2">
            {t.adBanner.disclosure}
          </p>
        </div>

        {/* CTAs */}
        <div className="px-6 py-5 space-y-3">
          <a
            href="/signup"
            className="block w-full bg-amber-400 hover:bg-amber-300 text-navy-900 text-base font-black
                       px-4 py-3.5 rounded-2xl text-center transition-colors"
          >
            {t.adBanner.ctaFree}
          </a>
          <a
            href="/upgrade"
            onClick={() => trackUpgradeClick('getaway_popup')}
            className="block text-center text-slate-500 hover:text-slate-700 text-sm font-bold
                       underline underline-offset-2 transition-colors"
          >
            {t.adBanner.ctaLifetime}
          </a>
          <button
            onClick={close}
            className="block w-full text-center text-xs font-bold text-slate-400 hover:text-slate-600 pt-0.5 transition-colors"
          >
            {t.adBanner.later}
          </button>
        </div>
      </div>
    </div>
  );
}
