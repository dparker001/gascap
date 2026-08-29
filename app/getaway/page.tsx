'use client';

/**
 * /getaway — stable page where a Lifetime member chooses (or reviews) their
 * complimentary getaway destination. Linked from the post-purchase email so
 * buyers who didn't choose on the success page can come back any time.
 */

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';
import { getawayPromoActive } from '@/lib/getawayPromo';
import { hasLifetimeEntitlement } from '@/lib/entitlements';
import GetawayDestinationPicker from '@/components/GetawayDestinationPicker';
import BrandBar from '@/components/BrandBar';
import { GlowIcon } from '@/components/marketing/GlowIcon';

export default function GetawayPage() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();

  // 2026-08-29 (CR-3A) — provider-neutral Lifetime check, same pattern as
  // WelcomeBanner. The prior `stripeInterval === 'lifetime'` check only
  // recognized Stripe/gift Lifetime; a RevenueCat (Apple/Google) Lifetime
  // purchaser would be shown the "you need Lifetime" upsell here despite
  // already owning it. The authoritative /api/getaway/choose route already
  // uses hasLifetimeEntitlement() and is unchanged — this fixes the
  // client-side DISPLAY to match what that route actually enforces.
  const stripeInterval     = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const revenueCatActive   = (session?.user as { revenueCatActive?: boolean })?.revenueCatActive ?? false;
  const revenueCatInterval = (session?.user as { revenueCatInterval?: string | null })?.revenueCatInterval ?? null;
  const isLifetime = !!session && hasLifetimeEntitlement({ stripeInterval, revenueCatActive, revenueCatInterval });
  const promoOn    = getawayPromoActive();

  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <BrandBar />
      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="bg-white rounded-3xl shadow-card p-7 max-w-md w-full space-y-4">
          <div className="text-center">
            <div className="flex justify-center mb-2">
              <GlowIcon name="palm" size={64} />
            </div>
            <h1 className="text-xl font-black text-navy-700">{t.pricing.getawayPageTitle}</h1>
          </div>

          {status === 'loading' ? (
            <p className="text-center text-sm text-slate-400">{t.pricing.loading}</p>
          ) : !promoOn ? (
            <p className="text-center text-sm text-slate-500 leading-relaxed">
              {t.pricing.getawayPickerInactive}
            </p>
          ) : !session ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-slate-500 leading-relaxed">{t.pricing.getawayPickerSignIn}</p>
              <Link href="/signin?next=/getaway"
                    className="inline-block bg-teal-500 hover:bg-teal-400 text-white text-sm font-black px-6 py-3 rounded-2xl">
                {t.pricing.getawayPickerSignInCta}
              </Link>
            </div>
          ) : !isLifetime ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-slate-500 leading-relaxed">{t.pricing.getawayPickerNeedsLifetime}</p>
              <Link href="/upgrade"
                    className="inline-block bg-teal-500 hover:bg-teal-400 text-white text-sm font-black px-6 py-3 rounded-2xl">
                {t.pricing.getawayCta}
              </Link>
            </div>
          ) : (
            <GetawayDestinationPicker />
          )}

          <div className="pt-1 text-center">
            <Link href="/" className="text-xs font-semibold text-slate-400 hover:text-slate-600">
              ← {t.upgrade.goToCalculator}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
