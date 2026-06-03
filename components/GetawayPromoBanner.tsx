'use client';

/**
 * GetawayPromoBanner — hero strip promoting Pro Lifetime ($19.99) + a
 * complimentary resort getaway. Shown to any signed-in user who isn't already on
 * Lifetime, while the getaway promo is active (see lib/getawayPromo.ts).
 *
 * There is NO discount — Lifetime stays $19.99 and the getaway is the incentive.
 * Clicking starts a normal Lifetime checkout; the webhook detects the active
 * promo on completion and triggers certificate fulfillment (admin-issued).
 *
 * Email-not-verified (403) is handled the same way as the new-member banner:
 * prompt to verify with a one-tap resend, so the cert + receipt can reach them.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { PRICING }             from '@/lib/stripe';
import { trackUpgradeClick }   from '@/lib/gtag';

export default function GetawayPromoBanner() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [show,        setShow]        = useState(false);
  const [daysLeft,    setDaysLeft]    = useState<number | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resending,   setResending]   = useState(false);
  const [resent,      setResent]      = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/user/getaway-offer')
      .then((r) => r.json())
      .then((d: { active?: boolean; eligible?: boolean; daysLeft?: number | null }) => {
        if (d.active && d.eligible) {
          setShow(true);
          setDaysLeft(typeof d.daysLeft === 'number' ? d.daysLeft : null);
        }
      })
      .catch(() => {});
  }, [session]);

  if (!session?.user || !show) return null;

  const price    = PRICING.pro.lifetime.toFixed(2);
  const daysWord = daysLeft === 1 ? t.pricing.getawayDayLeft : t.pricing.getawayDaysLeft;

  async function handleClaim() {
    setLoading(true);
    trackUpgradeClick('getaway_promo');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: 'pro', billing: 'lifetime' }),
      });
      // 403 = email not verified (checkout requires it so the cert + receipt reach the buyer)
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
                      bg-gradient-to-r from-[#005F4A] to-[#1EB68F] shadow-md border border-white/10">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">🏝️</span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300">
              {t.pricing.getawayTitle}
              <span className="bg-amber-400 text-navy-900 px-1.5 py-0.5 rounded-full tracking-normal whitespace-nowrap">
                {t.pricing.getawayPill}
              </span>
            </p>
            <p className="text-white text-[13px] font-bold leading-snug">
              {t.pricing.getawayMsg} — <span className="text-amber-300">${price}</span>
            </p>
            {needsVerify ? (
              <p className="text-[11px] text-amber-200 mt-1 font-semibold leading-snug">
                ⚠️ {t.pricing.newMemberVerify}
              </p>
            ) : (
              <p className="text-[10px] text-white/60 mt-1 leading-snug">
                {t.pricing.getawayDisclosure}
                {daysLeft !== null && (
                  <span className="text-white/80 font-semibold"> · ⏳ {daysLeft} {daysWord}</span>
                )}
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
            {loading ? t.pricing.loading : `${t.pricing.getawayCta} — $${price}`}
          </button>
        )}
      </div>
    </div>
  );
}
