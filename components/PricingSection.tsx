'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PRICING } from '@/lib/stripe';
import { useTranslation } from '@/contexts/LanguageContext';

// ── Types ─────────────────────────────────────────────────────────────────

type Billing  = 'monthly' | 'annual';
type PlanTier = 'free' | 'pro' | 'fleet';

// Highlight flags (order matches translation feature arrays)
const PRO_HIGHLIGHTS  = [false, true,  true,  false, true,  true,  false, false, false];
const FLEET_HIGHLIGHTS = [false, true,  true,  true,  true,  false, true,  false, false];

// ── Helpers ───────────────────────────────────────────────────────────────

function Check({ highlight }: { highlight?: boolean }) {
  return (
    <svg
      className={`w-4 h-4 flex-shrink-0 mt-0.5 ${highlight ? 'text-amber-500' : 'text-green-500'}`}
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

// ── Plan card ─────────────────────────────────────────────────────────────

interface PlanCardProps {
  name:               string;
  badge?:             string;
  badgeColor?:        string;
  price:              string;
  priceUnit?:         string;
  subline:            string;
  cta:                string;
  ctaStyle:           string;
  features:           { text: string; highlight?: boolean }[];
  popular?:           boolean;
  isCurrent?:         boolean;
  onCta:              () => void;
  loading?:           boolean;
  currentPlanRibbon:  string;
  mostPopular:        string;
  loadingLabel:       string;
  moLabel:            string;
}

function PlanCard({
  name, badge, badgeColor, price, priceUnit, subline, cta, ctaStyle,
  features, popular, isCurrent, onCta, loading,
  currentPlanRibbon, mostPopular, loadingLabel, moLabel,
}: PlanCardProps) {
  return (
    <div className={[
      'relative flex flex-col rounded-3xl p-6 transition-all duration-200',
      popular
        ? 'bg-navy-700 text-white shadow-2xl scale-[1.02] border-2 border-amber-400'
        : 'bg-white border-2 border-slate-200 shadow-card',
      isCurrent && !popular ? 'ring-2 ring-green-400 border-green-300' : '',
    ].join(' ')}>

      {/* Current plan ribbon */}
      {isCurrent && (
        <div className={[
          'absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-black px-4 py-1',
          'rounded-full uppercase tracking-wider whitespace-nowrap shadow-md',
          popular
            ? 'bg-green-400 text-navy-900'
            : 'bg-green-500 text-white',
        ].join(' ')}>
          {currentPlanRibbon}
        </div>
      )}

      {/* Most Popular ribbon — only when not showing current plan ribbon */}
      {popular && !isCurrent && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-navy-900
                        text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider
                        whitespace-nowrap shadow-md">
          {mostPopular}
        </div>
      )}

      {/* Plan name + badge */}
      <div className="mb-4">
        <h3 className={`font-black text-lg ${popular ? 'text-white' : 'text-navy-700'}`}>
          {name}
        </h3>
        {badge && (
          <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>

      {/* Price */}
      <div className="mb-1 flex items-end gap-1">
        <span className={`text-4xl font-black ${popular ? 'text-white' : 'text-navy-700'}`}>
          {price}
        </span>
        <span className={`text-sm mb-1 ${popular ? 'text-white/60' : 'text-slate-400'}`}>
          /{priceUnit ?? moLabel}
        </span>
      </div>
      <p className={`text-xs mb-6 leading-relaxed ${popular ? 'text-white/60' : 'text-slate-400'}`}>
        {subline}
      </p>

      {/* CTA */}
      <button
        onClick={onCta}
        disabled={loading || isCurrent}
        className={`w-full py-3 rounded-2xl text-sm font-black transition-colors mb-6 ${ctaStyle}`}
      >
        {loading ? loadingLabel : cta}
      </button>

      {/* Divider */}
      <div className={`border-t mb-5 ${popular ? 'border-white/20' : 'border-slate-100'}`} />

      {/* Features */}
      <ul className="space-y-2.5 flex-1">
        {features.map((f) => (
          <li key={f.text} className="flex items-start gap-2.5">
            <Check highlight={f.highlight} />
            <span className={`text-sm leading-snug ${
              popular
                ? f.highlight ? 'text-amber-300 font-semibold' : 'text-white/80'
                : f.highlight ? 'text-slate-800 font-semibold' : 'text-slate-500'
            }`}>
              {f.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────

export default function PricingSection() {
  const { data: session } = useSession();
  const router            = useRouter();
  const { t }             = useTranslation();
  const [billing, setBilling] = useState<Billing>('annual');
  const [loading, setLoading] = useState<string | null>(null);

  // Read the user's current plan from the JWT-enriched session
  const userPlan = (session?.user as { plan?: string })?.plan as PlanTier | undefined ?? 'free';

  // Build translated feature arrays with highlight flags
  const FREE_FEATURES  = t.pricing.freeFeatures.map((text) => ({ text }));
  const PRO_FEATURES   = t.pricing.proFeatures.map((text, i) => ({ text, highlight: PRO_HIGHLIGHTS[i] }));
  const FLEET_FEATURES = t.pricing.fleetFeatures.map((text, i) => ({ text, highlight: FLEET_HIGHLIGHTS[i] }));

  async function handleUpgrade(tier: 'pro' | 'fleet') {
    if (!session) {
      router.push('/signin?next=/upgrade');
      return;
    }
    setLoading(tier);
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier, billing }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
    } finally {
      setLoading(null);
    }
  }

  // Computed prices
  const proPrice   = billing === 'annual' ? fmt(PRICING.pro.annualPerMonth)   : fmt(PRICING.pro.monthly);
  const fleetPrice = billing === 'annual' ? fmt(PRICING.fleet.annualPerMonth) : fmt(PRICING.fleet.monthly);

  const proSubline = billing === 'annual'
    ? t.pricing.billedAnnual(fmt(PRICING.pro.annual))
    : t.pricing.billedMonthly;

  const fleetSubline = billing === 'annual'
    ? t.pricing.billedAnnual(fmt(PRICING.fleet.annual))
    : t.pricing.billedMonthly;

  // Per-card CTA text based on user's current plan
  function freeCta()  {
    if (!session)            return t.pricing.getStartedFree;
    if (userPlan === 'free') return t.pricing.yourCurrentPlan;
    return t.pricing.downgradeToFree;
  }
  function proCta()  {
    if (userPlan === 'pro')   return t.pricing.yourCurrentPlan;
    if (userPlan === 'fleet') return t.pricing.downgradeFromFleet;
    return t.pricing.upgradeToPro;
  }
  function fleetCta() {
    if (userPlan === 'fleet') return t.pricing.yourCurrentPlan;
    return t.pricing.startFleetPlan;
  }

  return (
    <section aria-labelledby="pricing-heading" className="mt-10">

      {/* Heading */}
      <h2 id="pricing-heading" className="section-eyebrow">{t.pricing.heading}</h2>
      <p className="text-center text-slate-500 text-sm mb-6 -mt-2 leading-relaxed">
        {t.pricing.sub}
      </p>

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-1 bg-slate-100 rounded-2xl p-1 mb-8 max-w-xs mx-auto">
        <button
          onClick={() => setBilling('monthly')}
          className={[
            'flex-1 py-2 rounded-xl text-xs font-bold transition-all',
            billing === 'monthly'
              ? 'bg-white text-navy-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-600',
          ].join(' ')}
        >
          {t.pricing.monthly}
        </button>
        <button
          onClick={() => setBilling('annual')}
          className={[
            'flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5',
            billing === 'annual'
              ? 'bg-white text-navy-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-600',
          ].join(' ')}
        >
          {t.pricing.annual}
          <span className="bg-green-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
            {t.pricing.twoMonthsFree}
          </span>
        </button>
      </div>

      {/* Cards — stacked on mobile, 3-col on md+ */}
      <div className="grid gap-4 md:grid-cols-3 md:items-start">

        {/* Free */}
        <PlanCard
          name="Free"
          badge={t.pricing.noCCEver}
          badgeColor="bg-green-100 text-green-700"
          price="$0"
          priceUnit={t.pricing.forever}
          subline={t.pricing.freeSub}
          cta={freeCta()}
          ctaStyle={
            userPlan === 'free' && session
              ? 'bg-green-100 text-green-700 cursor-default'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60'
          }
          features={FREE_FEATURES}
          isCurrent={!!session && userPlan === 'free'}
          onCta={() => !session && router.push('/signup')}
          currentPlanRibbon={t.pricing.currentPlanRibbon}
          mostPopular={t.pricing.mostPopular}
          loadingLabel={t.pricing.loading}
          moLabel={t.pricing.mo}
        />

        {/* Pro */}
        <PlanCard
          name="Pro"
          badge={t.pricing.individuals}
          badgeColor="bg-amber-100 text-amber-700"
          price={proPrice}
          subline={proSubline}
          cta={proCta()}
          ctaStyle={
            userPlan === 'pro'
              ? 'bg-green-400 text-white cursor-default'
              : 'bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-50'
          }
          features={PRO_FEATURES}
          popular
          isCurrent={!!session && userPlan === 'pro'}
          onCta={() => userPlan !== 'pro' && handleUpgrade('pro')}
          loading={loading === 'pro'}
          currentPlanRibbon={t.pricing.currentPlanRibbon}
          mostPopular={t.pricing.mostPopular}
          loadingLabel={t.pricing.loading}
          moLabel={t.pricing.mo}
        />

        {/* Fleet */}
        <PlanCard
          name="Fleet"
          badge={t.pricing.householdBiz}
          badgeColor="bg-blue-100 text-blue-700"
          price={fleetPrice}
          subline={fleetSubline}
          cta={fleetCta()}
          ctaStyle={
            userPlan === 'fleet'
              ? 'bg-green-500 text-white cursor-default border-2 border-green-500'
              : 'bg-navy-700 text-white hover:bg-navy-600 disabled:opacity-50 border-2 border-navy-700'
          }
          features={FLEET_FEATURES}
          isCurrent={!!session && userPlan === 'fleet'}
          onCta={() => userPlan !== 'fleet' && handleUpgrade('fleet')}
          loading={loading === 'fleet'}
          currentPlanRibbon={t.pricing.currentPlanRibbon}
          mostPopular={t.pricing.mostPopular}
          loadingLabel={t.pricing.loading}
          moLabel={t.pricing.mo}
        />
      </div>

      {/* Annual savings callout */}
      {billing === 'annual' && (
        <div className="mt-5 text-center animate-fade-in">
          <p className="text-xs text-green-600 font-semibold">
            {t.pricing.annualSavings(fmt(PRICING.pro.monthly * 2), fmt(PRICING.fleet.monthly * 2))}
          </p>
        </div>
      )}

      {/* Trust footnote */}
      <p className="text-center text-xs text-slate-400 mt-6 leading-relaxed">
        {t.pricing.trustNote}
      </p>
    </section>
  );
}
