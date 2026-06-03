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
import GetawayDestinationPicker from '@/components/GetawayDestinationPicker';
import BrandBar from '@/components/BrandBar';

export default function GetawayPage() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();

  const interval   = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const isLifetime = !!session && interval === 'lifetime';
  const promoOn    = getawayPromoActive();

  return (
    <div className="min-h-screen bg-[#eef1f7]">
      <BrandBar />
      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="bg-white rounded-3xl shadow-card p-7 max-w-md w-full space-y-4">
          <div className="text-center">
            <div className="text-4xl mb-1" aria-hidden="true">🏝️</div>
            <h1 className="text-xl font-black text-navy-700">{t.pricing.getawayPickerHeadline}</h1>
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
