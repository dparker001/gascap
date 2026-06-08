'use client';

/**
 * LifetimeUpgradeModal — an occasional pop-up shown to *paying* Pro members
 * (monthly or annual subscribers) inviting them to switch to Pro Lifetime.
 *
 * Audience: logged-in, plan === 'pro', NOT on a trial, and NOT already Lifetime.
 * Free users, Fleet, trial users, and existing Lifetime owners never see it.
 *
 * "On occasion" without nagging — a frequency cap keeps it polite:
 *   - shows a few seconds after the app loads (not instantly),
 *   - at most once every COOLDOWN_DAYS,
 *   - at most MAX_IMPRESSIONS times ever,
 *   - "Don't show this again" opts out permanently.
 *
 * While the getaway promo is live, the headline leads with the complimentary
 * getaway (a Lifetime purchase during the promo gets one automatically via the
 * Stripe webhook). After the promo ends it falls back to the plain
 * "one payment, Pro forever" message.
 *
 * Upgrading starts a normal Lifetime checkout (same endpoint the rest of the app
 * uses). If the email isn't verified, checkout returns 403 and we prompt to
 * verify with a one-tap resend, mirroring NewMemberOfferBanner.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { PRICING }             from '@/lib/stripe';
import { getawayPromoActive }  from '@/lib/getawayPromo';
import { trackUpgradeClick }   from '@/lib/gtag';
import { useIsNative }         from '@/hooks/useIsNative';

const LAST_KEY   = 'gc_lt_modal_last';   // ms timestamp of last impression
const COUNT_KEY  = 'gc_lt_modal_count';  // total impressions so far
const OPTOUT_KEY = 'gc_lt_modal_optout'; // '1' = never show again

const COOLDOWN_DAYS    = 7;     // minimum gap between impressions
const MAX_IMPRESSIONS  = 5;     // stop after this many shows
const DELAY_MS         = 6000;  // wait after load before popping up

export default function LifetimeUpgradeModal() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const isNative = useIsNative();   // hide in-app purchase in the native wrappers
  const [show,        setShow]        = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resending,   setResending]   = useState(false);
  const [resent,      setResent]      = useState(false);

  const promo = getawayPromoActive();

  useEffect(() => {
    if (!session?.user) return;

    const plan       = (session.user as { plan?: string })?.plan ?? 'free';
    const isProTrial = (session.user as { isProTrial?: boolean })?.isProTrial ?? false;
    const interval   = (session.user as { stripeInterval?: string | null })?.stripeInterval ?? null;

    // Only paying Pro subscribers (monthly/annual) — not free, fleet, trial, or Lifetime.
    const isPayingPro = plan === 'pro' && !isProTrial && interval !== 'lifetime';
    if (!isPayingPro) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (localStorage.getItem(OPTOUT_KEY) === '1') return;

      const count = parseInt(localStorage.getItem(COUNT_KEY) ?? '0', 10) || 0;
      if (count >= MAX_IMPRESSIONS) return;

      const last = parseInt(localStorage.getItem(LAST_KEY) ?? '0', 10) || 0;
      if (Date.now() - last < COOLDOWN_DAYS * 86_400_000) return;

      timer = setTimeout(() => {
        setShow(true);
        try {
          localStorage.setItem(LAST_KEY, String(Date.now()));
          localStorage.setItem(COUNT_KEY, String(count + 1));
        } catch { /* ignore */ }
      }, DELAY_MS);
    } catch { /* storage blocked — don't show */ }

    return () => { if (timer) clearTimeout(timer); };
  }, [session]);

  // Never surface the in-app purchase prompt inside the native wrappers.
  if (!show || isNative) return null;

  function close() { setShow(false); }

  function optOut() {
    try { localStorage.setItem(OPTOUT_KEY, '1'); } catch { /* ignore */ }
    setShow(false);
  }

  async function handleUpgrade() {
    setLoading(true);
    trackUpgradeClick('lifetime_modal');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: 'pro', billing: 'lifetime' }),
      });
      if (res.status === 403) { setNeedsVerify(true); setLoading(false); return; }
      const data = await res.json() as { url?: string };
      if (data.url) { window.location.href = data.url; return; }
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await fetch('/api/auth/verify-email', { method: 'POST' });
      setResent(true);
    } catch { /* ignore */ } finally {
      setResending(false);
    }
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
            onClick={close}
            aria-label={t.ltModal.later}
            className="absolute top-3 right-3.5 text-white/60 hover:text-white text-xl leading-none"
          >
            ✕
          </button>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
            {t.ltModal.eyebrow}
          </p>
          <p className="text-4xl mt-1" aria-hidden="true">{promo ? '🏝️' : '🏅'}</p>
          <h2 className="text-white text-xl font-black leading-tight mt-2">
            {promo ? t.ltModal.headlinePromo : t.ltModal.headlinePlain}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed text-center">
            {promo ? t.ltModal.bodyPromo : t.ltModal.bodyPlain}
          </p>

          <ul className="space-y-2">
            <li className="flex items-center gap-2.5 text-sm text-slate-700">
              <span aria-hidden="true">♾️</span> {t.ltModal.bulletOnePayment}
            </li>
            <li className="flex items-center gap-2.5 text-sm text-slate-700">
              <span aria-hidden="true">⭐</span> {t.ltModal.bulletEntries}
            </li>
            {promo && (
              <li className="flex items-center gap-2.5 text-sm font-semibold text-teal-700">
                <span aria-hidden="true">🏝️</span> {t.ltModal.bulletGetaway}
              </li>
            )}
            <li className="flex items-center gap-2.5 text-sm text-slate-700">
              <span aria-hidden="true">🏅</span> {t.ltModal.bulletBadge}
            </li>
          </ul>

          {needsVerify ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 text-center">
              <p className="text-[13px] text-amber-800 font-semibold leading-snug">
                ⚠️ {t.ltModal.verify}
              </p>
              {resent ? (
                <p className="text-xs text-amber-700 mt-1.5">{t.ltModal.verifySent}</p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="mt-2 text-xs font-black text-amber-700 underline underline-offset-2 disabled:opacity-50"
                >
                  {resending ? t.ltModal.verifySending : t.ltModal.verifyResend}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="block w-full py-3.5 rounded-2xl font-black text-base text-white text-center
                         bg-gradient-to-r from-[#005F4A] to-[#1EB68F] hover:opacity-95
                         transition-opacity disabled:opacity-60"
            >
              {loading ? '…' : `${t.ltModal.cta} — $${price}`}
            </button>
          )}

          <div className="flex items-center justify-between pt-0.5">
            <button
              onClick={close}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
            >
              {t.ltModal.later}
            </button>
            <button
              onClick={optOut}
              className="text-xs text-slate-300 hover:text-slate-500 transition-colors"
            >
              {t.ltModal.optOut}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
