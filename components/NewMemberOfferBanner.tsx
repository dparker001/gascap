'use client';

/**
 * NewMemberOfferBanner — hero strip shown to brand-new users (within 7 days of
 * signup, not already Lifetime) offering Pro Lifetime at 50% off ($9.99).
 *
 * Eligibility + days-left come from /api/user/new-member-offer (server-side, from
 * the account's createdAt). Clicking starts a Lifetime checkout with the discount
 * auto-applied server-side — there's no code to type and nothing to abuse.
 *
 * If the account's email isn't verified yet, checkout returns 403 (so the receipt
 * and Lifetime confirmation can actually reach the buyer). We catch that and prompt
 * the user to verify — with a one-tap resend — instead of failing silently.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { PRICING }             from '@/lib/stripe';
import { NEW_MEMBER_DISCOUNT_USD } from '@/lib/newMemberOffer';
import { getawayPromoActive }  from '@/lib/getawayPromo';
import { trackUpgradeClick }   from '@/lib/gtag';
import { useIsNative }         from '@/hooks/useIsNative';

export default function NewMemberOfferBanner() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const isNative = useIsNative();   // hide the in-app discount purchase in native wrappers
  const [daysLeft,    setDaysLeft]    = useState<number | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resending,   setResending]   = useState(false);
  const [resent,      setResent]      = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    // While the Lifetime + getaway promo is live, the getaway is the headline
    // Lifetime offer — pause this standalone 50%-off discount so they don't compete.
    if (getawayPromoActive()) return;
    fetch('/api/user/new-member-offer')
      .then((r) => r.json())
      .then((d: { eligible?: boolean; daysLeft?: number }) => {
        if (d.eligible && typeof d.daysLeft === 'number') setDaysLeft(d.daysLeft);
      })
      .catch(() => {});
  }, [session]);

  if (!session?.user || daysLeft === null || isNative) return null;

  const price    = (PRICING.pro.lifetime - NEW_MEMBER_DISCOUNT_USD).toFixed(2);
  const original = PRICING.pro.lifetime.toFixed(2);
  const pctOff   = Math.round((NEW_MEMBER_DISCOUNT_USD / PRICING.pro.lifetime) * 100);
  const daysWord = daysLeft === 1 ? t.pricing.newMemberDayLeft : t.pricing.newMemberDaysLeft;

  async function handleClaim() {
    setLoading(true);
    trackUpgradeClick('new_member_offer');
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: 'pro', billing: 'lifetime', newMemberOffer: true }),
      });
      // 403 = email not verified (checkout requires it so receipts reach the buyer)
      if (res.status === 403) { setNeedsVerify(true); setLoading(false); return; }
      const data = await res.json() as { url?: string; error?: string };
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
    } catch {
      /* ignore — user can retry */
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="px-4 lg:px-0 pt-3 max-w-lg lg:max-w-none mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl px-4 py-3
                      bg-gradient-to-r from-[#1E2D4A] to-[#005F4A] shadow-md border border-white/10">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">🎁</span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300">
              {t.pricing.newMemberTitle}
              <span className="bg-amber-400 text-navy-900 px-1.5 py-0.5 rounded-full tracking-normal whitespace-nowrap">
                {pctOff}% {t.pricing.newMemberOff}
              </span>
            </p>
            <p className="text-white text-[13px] font-bold leading-snug">
              {t.pricing.newMemberMsg} — <span className="text-amber-300">${price}</span>{' '}
              <span className="text-white/40 line-through">${original}</span>
            </p>
            {needsVerify ? (
              <p className="text-[11px] text-amber-200 mt-1 font-semibold leading-snug">
                ⚠️ {t.pricing.newMemberVerify}
              </p>
            ) : (
              <p className="text-[11px] text-white/60 mt-0.5 font-semibold">
                ⏳ {daysLeft} {daysWord}
              </p>
            )}
          </div>
        </div>

        {needsVerify ? (
          <button
            onClick={handleResend}
            disabled={resending || resent}
            className="flex-shrink-0 w-full sm:w-auto bg-white/15 hover:bg-white/25 disabled:opacity-70
                       text-white text-sm font-black px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap"
          >
            {resent ? `✓ ${t.pricing.newMemberSent}` : resending ? t.pricing.loading : t.pricing.newMemberResend}
          </button>
        ) : (
          <button
            onClick={handleClaim}
            disabled={loading}
            className="flex-shrink-0 w-full sm:w-auto bg-amber-400 hover:bg-amber-300 disabled:opacity-60
                       text-navy-900 text-sm font-black px-5 py-2.5 rounded-xl transition-colors whitespace-nowrap"
          >
            {loading ? t.pricing.loading : `${t.pricing.getLifetime} — $${price}`}
          </button>
        )}
      </div>
    </div>
  );
}
