'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PRICING } from '@/lib/stripe';
import { useTranslation } from '@/contexts/LanguageContext';
import { getawayPromoActive } from '@/lib/getawayPromo';

// ── Types ─────────────────────────────────────────────────────────────────

type PlanTier = 'free' | 'pro';

// Highlight flags (order matches translation feature arrays)
const PRO_HIGHLIGHTS = [false, true, true, false, true, true, false, false, false, false];

// ── Helpers ───────────────────────────────────────────────────────────────

function Check({ highlight, dark }: { highlight?: boolean; dark?: boolean }) {
  return (
    <svg
      className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
        dark
          ? highlight ? 'text-teal-400' : 'text-white/50'
          : highlight ? 'text-amber-500' : 'text-green-500'
      }`}
      viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
    >
      <path fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd" />
    </svg>
  );
}

function fmt(n: number) {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

// ── Main section ──────────────────────────────────────────────────────────

export default function PricingSection() {
  const { data: session } = useSession();
  const router            = useRouter();
  const { t }             = useTranslation();
  const [loading, setLoading] = useState<string | null>(null);

  const userPlan     = (session?.user as { plan?: string })?.plan as PlanTier | undefined ?? 'free';
  const userInterval = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const isOnTrial    = !!(session?.user as { isProTrial?: boolean })?.isProTrial;

  const FREE_FEATURES = t.pricing.freeFeatures.map((text) => ({ text }));
  const PRO_FEATURES  = t.pricing.proFeatures.map((text, i) => ({ text, highlight: PRO_HIGHLIGHTS[i] }));

  const LIFETIME_EXCLUSIVES = [
    { icon: '⭐', text: '2× giveaway entries every month' },
    { icon: '🛡️', text: 'Streak Shield — 1 grace day/month' },
    { icon: '🏅', text: 'Lifetime Member badge' },
  ];

  async function handleUpgrade(billing: 'monthly' | 'lifetime') {
    if (!session) {
      // New visitors sign up first (free trial auto-activates), then return to upgrade
      router.push('/signup?next=/upgrade');
      return;
    }
    setLoading(billing);
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: 'pro', billing }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
    } finally {
      setLoading(null);
    }
  }

  const isProMonthly  = !!session && userPlan === 'pro' && userInterval !== 'lifetime' && !isOnTrial;
  const isProLifetime = !!session && userPlan === 'pro' && userInterval === 'lifetime' && !isOnTrial;
  const isPro         = isProMonthly || isProLifetime; // paid Pro (not trial)

  // Getaway promo: Lifetime buyers get a complimentary resort getaway. Show the
  // bonus callout on the Lifetime card (hidden once you already own Lifetime).
  const showGetaway   = getawayPromoActive() && !isProLifetime;

  return (
    <section aria-labelledby="pricing-heading" className="mt-10">

      {/* Heading */}
      <h2 id="pricing-heading" className="text-center text-2xl font-black text-navy-700 mb-2">
        {t.pricing.heading}
      </h2>
      <p className="text-center text-slate-500 text-sm mb-8 leading-relaxed">
        {t.pricing.sub}
      </p>

      {/* ── 3-panel cards ──────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3 md:items-stretch max-w-7xl mx-auto">

        {/* Free */}
        <div className={[
          'relative flex flex-col rounded-3xl p-6 border-2 transition-all',
          !!session && userPlan === 'free'
            ? 'bg-white border-green-300 ring-2 ring-green-400 shadow-card'
            : 'bg-white border-slate-200 shadow-sm',
        ].join(' ')}>

          {!!session && userPlan === 'free' && (
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-green-500 text-white
                            text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider
                            whitespace-nowrap shadow-md">
              {t.pricing.currentPlanRibbon}
            </div>
          )}

          <div className="mb-4">
            <h3 className="font-black text-lg text-navy-700">Free</h3>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full
                             bg-slate-100 text-slate-600 whitespace-nowrap">
              {t.pricing.noCCEver}
            </span>
          </div>

          <div className="mb-1 flex items-end gap-1">
            <span className="text-4xl font-black text-navy-700">$0</span>
            <span className="text-sm mb-1 text-slate-400">/{t.pricing.forever}</span>
          </div>
          <p className="text-xs mb-6 leading-relaxed text-slate-400">{t.pricing.freeSub}</p>

          <button
            onClick={() => !session && router.push('/signup')}
            disabled={!!session && userPlan === 'free'}
            className={`w-full py-3 rounded-2xl text-sm font-black transition-colors mb-6 ${
              !!session && userPlan === 'free'
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {!!session && userPlan === 'free'
              ? t.pricing.yourCurrentPlan
              : !session
                ? t.pricing.getStartedFree
                : t.pricing.downgradeToFree}
          </button>

          <div className="border-t border-slate-100 mb-5" />
          <ul className="space-y-2.5 flex-1">
            {FREE_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5">
                <Check />
                <span className="text-sm leading-snug text-slate-500">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pro Monthly */}
        <div className={[
          'relative flex flex-col rounded-3xl p-6 border-2 transition-all shadow-2xl',
          isProMonthly
            ? 'bg-navy-700 border-green-400 ring-2 ring-green-400'
            : 'bg-navy-700 border-amber-400 scale-[1.02]',
        ].join(' ')}>

          <div className={[
            'absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-black px-4 py-1',
            'rounded-full uppercase tracking-wider whitespace-nowrap shadow-md',
            isProMonthly ? 'bg-green-400 text-navy-900' : 'bg-amber-400 text-navy-900',
          ].join(' ')}>
            {isProMonthly ? t.pricing.currentPlanRibbon : t.pricing.mostPopular}
          </div>

          <div className="mb-4 mt-1">
            <h3 className="font-black text-lg text-white">Pro</h3>
            <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                             isProMonthly ? 'bg-green-400/20 text-green-300' : 'bg-amber-400/20 text-amber-300'}`}>
              {t.pricing.individuals ?? 'Monthly'}
            </span>
          </div>

          <div className="mb-1 flex items-end gap-1">
            <span className="text-4xl font-black text-white">{fmt(PRICING.pro.monthly)}</span>
            <span className="text-sm mb-1 text-white/60">/{t.pricing.mo}</span>
          </div>
          <p className="text-xs mb-6 leading-relaxed text-white/60">{t.pricing.billedMonthly}</p>

          <button
            onClick={() => !isProMonthly && !isProLifetime && handleUpgrade('monthly')}
            disabled={loading !== null || isProMonthly || isProLifetime}
            className={`w-full py-3 rounded-2xl text-sm font-black transition-colors mb-6 ${
              isProMonthly
                ? 'bg-green-400 text-navy-900 cursor-default'
                : isProLifetime
                  ? 'bg-white/20 text-white/50 cursor-default'
                  : 'bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-50'
            }`}
          >
            {loading === 'monthly'
              ? t.pricing.loading
              : isProMonthly
                ? t.pricing.yourCurrentPlan
                : isProLifetime
                  ? t.pricing.includedInLifetime
                  : isOnTrial
                    ? `${t.pricing.upgradeFromTrial} — $${PRICING.pro.monthly}/mo`
                    : !session
                      ? t.pricing.startFreeTrial
                      : t.pricing.upgradeToPro}
          </button>

          <div className="border-t border-white/20 mb-5" />
          <ul className="space-y-2.5 flex-1">
            {PRO_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5">
                <Check highlight={f.highlight} dark />
                <span className={`text-sm leading-snug ${
                  f.highlight
                    ? (isProMonthly ? 'text-green-300 font-semibold' : 'text-amber-300 font-semibold')
                    : 'text-white/80'
                }`}>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pro Lifetime */}
        <div className="relative flex flex-col rounded-3xl p-6 border-2 border-teal-400 bg-white shadow-card transition-all">

          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-teal-400 text-navy-900
                          text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider
                          whitespace-nowrap shadow-md">
            ★ {t.pricing.lifetimeRibbon}
          </div>

          <div className="mb-4 mt-1">
            <h3 className="font-black text-lg text-navy-700">Pro Lifetime</h3>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full
                             bg-teal-100 text-teal-700 whitespace-nowrap">
              {t.pricing.lifetimeBadge}
            </span>
          </div>

          <div className="mb-1 flex items-end gap-1">
            <span className="text-4xl font-black text-navy-700">${PRICING.pro.lifetime}</span>
          </div>
          <p className="text-xs mb-4 leading-relaxed text-teal-600 font-semibold">
            {t.pricing.lifetimeSubline}
          </p>

          {showGetaway && (
            <div className="mb-5 rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                🏝️ {t.pricing.getawayPill}
              </p>
              <p className="text-white text-[12px] font-bold leading-snug mt-1">
                {t.pricing.getawayCardMsg}
              </p>
              <p className="text-white/55 text-[9px] leading-snug mt-1">
                {t.pricing.getawayDisclosure}
              </p>
            </div>
          )}

          <button
            onClick={() => !isProLifetime && handleUpgrade('lifetime')}
            disabled={loading !== null || isProLifetime}
            className={`w-full py-3 rounded-2xl text-sm font-black transition-colors mb-6 ${
              isProLifetime
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-50'
            }`}
          >
            {loading === 'lifetime'
              ? t.pricing.loading
              : isProLifetime
                ? t.pricing.yourCurrentPlan
                : isProMonthly
                  ? `${t.pricing.upgradeToLifetime} — $${PRICING.pro.lifetime}`
                  : isOnTrial
                    ? `${t.pricing.upgradeFromTrial} — $${PRICING.pro.lifetime}`
                    : `${t.pricing.getLifetime} — $${PRICING.pro.lifetime}`}
          </button>
          <a href="/gift" className="block text-center text-xs font-semibold text-teal-600 hover:text-teal-500 -mt-4 mb-4">
            🎁 {t.pricing.giftThis ?? 'Gift this to someone'}
          </a>

          <div className="border-t border-slate-100 mb-5" />
          {/* Everything in Pro */}
          <ul className="space-y-2.5">
            <li className="flex items-start gap-2.5">
              <Check />
              <span className="text-sm leading-snug text-slate-500">{t.pricing.everythingInPro}</span>
            </li>
          </ul>
          {/* Lifetime-exclusive perks */}
          <div className="mt-5 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-teal-200" />
              <span className="text-[10px] font-black text-teal-600 uppercase tracking-widest whitespace-nowrap">
                {t.pricing.lifetimeExclusives}
              </span>
              <div className="flex-1 border-t border-teal-200" />
            </div>
          </div>
          <ul className="space-y-2.5 flex-1">
            {LIFETIME_EXCLUSIVES.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 mt-0.5 text-base">{f.icon}</span>
                <span className="text-sm leading-snug text-teal-700 font-semibold">{f.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-[11px] text-slate-400 leading-relaxed">
            {t.pricing.breakEven}
          </p>
        </div>

      </div>

      {/* Guarantee + refund notes */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-7xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5 flex items-start gap-3">
          <span className="text-xl flex-shrink-0" aria-hidden="true">🎯</span>
          <div>
            <p className="text-xs font-black text-amber-800">{t.pricing.guaranteeTitle} <span className="font-normal">{t.pricing.guaranteeMonthly}</span></p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              {t.pricing.guaranteeBody}
            </p>
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 flex items-start gap-3">
          <span className="text-xl flex-shrink-0" aria-hidden="true">🏅</span>
          <div>
            <p className="text-xs font-black text-slate-700">{t.pricing.lifetimeFinal}</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {t.pricing.lifetimeFinalBody}
            </p>
          </div>
        </div>
      </div>

      {/* Trust footnote */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <span>🔒</span> {t.pricing.trustNoSell}
        </span>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <span>💳</span> {t.pricing.trustStripe}
        </span>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <span>✓</span> {t.pricing.trustCancel}
        </span>
      </div>
    </section>
  );
}
