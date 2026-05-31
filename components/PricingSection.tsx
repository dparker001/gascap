'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PRICING } from '@/lib/stripe';
import { useTranslation } from '@/contexts/LanguageContext';

// ── Types ─────────────────────────────────────────────────────────────────

type PlanTier = 'free' | 'pro';

// Highlight flags (order matches translation feature arrays)
const PRO_HIGHLIGHTS = [false, true, true, false, true, true, false, false, false, false];

const LIFETIME_EXCLUSIVES = [
  { icon: '⭐', text: '2× giveaway entries every month' },
  { icon: '🛡️', text: 'Streak Shield — 1 grace day/month' },
  { icon: '🏅', text: 'Founding Member badge (limited)' },
];

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

  const userPlan = (session?.user as { plan?: string })?.plan as PlanTier | undefined ?? 'free';

  const FREE_FEATURES = t.pricing.freeFeatures.map((text) => ({ text }));
  const PRO_FEATURES  = t.pricing.proFeatures.map((text, i) => ({ text, highlight: PRO_HIGHLIGHTS[i] }));

  async function handleUpgrade(billing: 'monthly' | 'lifetime') {
    if (!session) {
      router.push('/signin?next=/upgrade');
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

  const isPro = !!session && userPlan === 'pro';

  return (
    <section aria-labelledby="pricing-heading" className="mt-10">

      {/* Heading */}
      <h2 id="pricing-heading" className="section-eyebrow">{t.pricing.heading}</h2>
      <p className="text-center text-slate-500 text-sm mb-8 -mt-2 leading-relaxed">
        {t.pricing.sub}
      </p>

      {/* ── 3-panel cards ──────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3 md:items-stretch max-w-5xl mx-auto">

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
                             bg-green-100 text-green-700 whitespace-nowrap">
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
          isPro
            ? 'bg-navy-700 border-green-400 ring-2 ring-green-400'
            : 'bg-navy-700 border-amber-400 scale-[1.02]',
        ].join(' ')}>

          <div className={[
            'absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-black px-4 py-1',
            'rounded-full uppercase tracking-wider whitespace-nowrap shadow-md',
            isPro ? 'bg-green-400 text-navy-900' : 'bg-amber-400 text-navy-900',
          ].join(' ')}>
            {isPro ? t.pricing.currentPlanRibbon : t.pricing.mostPopular}
          </div>

          <div className="mb-4 mt-1">
            <h3 className="font-black text-lg text-white">Pro</h3>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full
                             bg-amber-400/20 text-amber-300 whitespace-nowrap">
              {t.pricing.individuals ?? 'Monthly'}
            </span>
          </div>

          <div className="mb-1 flex items-end gap-1">
            <span className="text-4xl font-black text-white">{fmt(PRICING.pro.monthly)}</span>
            <span className="text-sm mb-1 text-white/60">/{t.pricing.mo}</span>
          </div>
          <p className="text-xs mb-6 leading-relaxed text-white/60">{t.pricing.billedMonthly}</p>

          <button
            onClick={() => !isPro && handleUpgrade('monthly')}
            disabled={loading !== null || isPro}
            className={`w-full py-3 rounded-2xl text-sm font-black transition-colors mb-6 ${
              isPro
                ? 'bg-green-400 text-navy-900 cursor-default'
                : 'bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-50'
            }`}
          >
            {loading === 'monthly'
              ? t.pricing.loading
              : isPro
                ? t.pricing.yourCurrentPlan
                : t.pricing.upgradeToPro}
          </button>

          <div className="border-t border-white/20 mb-5" />
          <ul className="space-y-2.5 flex-1">
            {PRO_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5">
                <Check highlight={f.highlight} dark />
                <span className={`text-sm leading-snug ${
                  f.highlight ? 'text-amber-300 font-semibold' : 'text-white/80'
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
            ★ Best Value
          </div>

          <div className="mb-4 mt-1">
            <h3 className="font-black text-lg text-navy-700">Pro Lifetime</h3>
            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full
                             bg-teal-100 text-teal-700 whitespace-nowrap">
              {t.pricing.billedOnce ?? 'One-time payment'}
            </span>
          </div>

          <div className="mb-1 flex items-end gap-1">
            <span className="text-4xl font-black text-navy-700">${PRICING.pro.lifetime}</span>
          </div>
          <p className="text-xs mb-6 leading-relaxed text-teal-600 font-semibold">
            Own GasCap™ Pro forever — no recurring charges
          </p>

          <button
            onClick={() => !isPro && handleUpgrade('lifetime')}
            disabled={loading !== null || isPro}
            className={`w-full py-3 rounded-2xl text-sm font-black transition-colors mb-6 ${
              isPro
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'bg-teal-500 text-white hover:bg-teal-400 disabled:opacity-50'
            }`}
          >
            {loading === 'lifetime'
              ? t.pricing.loading
              : isPro
                ? t.pricing.yourCurrentPlan
                : `Get Lifetime — $${PRICING.pro.lifetime}`}
          </button>

          <div className="border-t border-slate-100 mb-5" />
          {/* All Pro features */}
          <ul className="space-y-2.5">
            {PRO_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-2.5">
                <Check highlight={f.highlight} />
                <span className={`text-sm leading-snug ${
                  f.highlight ? 'text-slate-800 font-semibold' : 'text-slate-500'
                }`}>{f.text}</span>
              </li>
            ))}
          </ul>
          {/* Lifetime-exclusive perks */}
          <div className="mt-5 mb-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-teal-200" />
              <span className="text-[10px] font-black text-teal-600 uppercase tracking-widest whitespace-nowrap">
                Lifetime exclusives
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
            Less than 7 months of monthly — break even instantly.
          </p>
        </div>

      </div>

      {/* 30-day money-back guarantee */}
      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5
                      flex items-start gap-3 max-w-5xl mx-auto">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">🎯</span>
        <div>
          <p className="text-xs font-black text-amber-800">30-Day Satisfaction Guarantee</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            If GasCap Pro doesn&apos;t help you save more than $2.99 in your first month,
            contact us and we&apos;ll refund your first payment — no questions asked.
          </p>
        </div>
      </div>

      {/* Trust footnote */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <span>🔒</span> We never sell your data
        </span>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <span>💳</span> Secured by Stripe
        </span>
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <span>✓</span> Cancel anytime
        </span>
      </div>
    </section>
  );
}
