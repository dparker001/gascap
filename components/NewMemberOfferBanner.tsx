'use client';

/**
 * NewMemberOfferBanner — hero strip shown to brand-new users (within 7 days of
 * signup, not already Lifetime) offering Pro Lifetime at $5 off ($14.99).
 *
 * Eligibility + days-left come from /api/user/new-member-offer (server-side, from
 * the account's createdAt). Clicking starts a Lifetime checkout with the discount
 * auto-applied server-side — there's no code to type and nothing to abuse.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { PRICING }             from '@/lib/stripe';
import { trackUpgradeClick }   from '@/lib/gtag';

export default function NewMemberOfferBanner() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/user/new-member-offer')
      .then((r) => r.json())
      .then((d: { eligible?: boolean; daysLeft?: number }) => {
        if (d.eligible && typeof d.daysLeft === 'number') setDaysLeft(d.daysLeft);
      })
      .catch(() => {});
  }, [session]);

  if (!session?.user || daysLeft === null) return null;

  const price    = (PRICING.pro.lifetime - 5).toFixed(2);
  const original = PRICING.pro.lifetime.toFixed(2);
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
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) { window.location.href = data.url; return; }
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="px-4 lg:px-0 pt-3 max-w-lg lg:max-w-none mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl px-4 py-3
                      bg-gradient-to-r from-[#1E2D4A] to-[#005F4A] shadow-md border border-white/10">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">🎁</span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
              {t.pricing.newMemberTitle}
            </p>
            <p className="text-white text-[13px] font-bold leading-snug">
              {t.pricing.newMemberMsg} — <span className="text-amber-300">${price}</span>{' '}
              <span className="text-white/40 line-through">${original}</span>
            </p>
            <p className="text-[11px] text-white/60 mt-0.5 font-semibold">
              ⏳ {daysLeft} {daysWord} · {t.pricing.newMemberSave} $5
            </p>
          </div>
        </div>

        <button
          onClick={handleClaim}
          disabled={loading}
          className="flex-shrink-0 w-full sm:w-auto bg-amber-400 hover:bg-amber-300 disabled:opacity-60
                     text-navy-900 text-sm font-black px-5 py-2.5 rounded-xl transition-colors
                     whitespace-nowrap"
        >
          {loading ? t.pricing.loading : `${t.pricing.getLifetime} — $${price}`}
        </button>
      </div>
    </div>
  );
}
