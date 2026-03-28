'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PRICING } from '@/lib/stripe';

// ── Types ─────────────────────────────────────────────────────────────────

type Billing  = 'monthly' | 'annual';
type PlanTier = 'free' | 'pro' | 'fleet';

// ── Feature lists ─────────────────────────────────────────────────────────

const FREE_FEATURES = [
  { text: '1 saved vehicle',              pro: false },
  { text: 'Target Fill calculator',       pro: false },
  { text: 'By Budget calculator',         pro: false },
  { text: 'EPA vehicle database search',  pro: false },
  { text: 'Live gas price lookup',        pro: false },
  { text: 'Badge achievements',           pro: false },
  { text: 'Works offline (PWA)',          pro: false },
];

const PRO_FEATURES = [
  { text: 'Everything in Free',                       highlight: false },
  { text: 'Up to 5 saved vehicles',                   highlight: true  },
  { text: 'Manual entry + auto spec lookup',          highlight: true  },
  { text: 'Engine type & tank size auto-detected',    highlight: false },
  { text: 'MPG trending chart',                       highlight: true  },
  { text: 'Fuel cost PDF export',                     highlight: true  },
  { text: 'Monthly fuel budget tracker',              highlight: false },
  { text: 'Weekly push notification digest',          highlight: false },
  { text: 'Priority support',                         highlight: false },
];

const FLEET_FEATURES = [
  { text: 'Everything in Pro',                        highlight: false },
  { text: 'Unlimited vehicles',                       highlight: true  },
  { text: 'Up to 10 drivers per fleet',               highlight: true  },
  { text: 'Shared fleet garage',                      highlight: true  },
  { text: 'Fleet cost dashboard',                     highlight: true  },
  { text: 'Per-vehicle spending breakdown',           highlight: false },
  { text: 'CSV export for accounting',                highlight: true  },
  { text: 'Trip cost estimator',                      highlight: false },
  { text: 'Dedicated support',                        highlight: false },
];

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
  name:        string;
  badge?:      string;
  badgeColor?: string;
  price:       string;
  priceUnit?:  string;   // replaces "/mo" when set (e.g. "forever")
  subline:     string;
  cta:         string;
  ctaStyle:    string;
  features:    { text: string; highlight?: boolean }[];
  popular?:    boolean;
  isCurrent?:  boolean;
  onCta:       () => void;
  loading?:    boolean;
}

function PlanCard({
  name, badge, badgeColor, price, priceUnit, subline, cta, ctaStyle,
  features, popular, isCurrent, onCta, loading,
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
          ✓ Your Current Plan
        </div>
      )}

      {/* Most Popular ribbon — only when not showing current plan ribbon */}
      {popular && !isCurrent && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-navy-900
                        text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider
                        whitespace-nowrap shadow-md">
          ⭐ Most Popular
        </div>
      )}

      {/* Plan name + badge */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className={`font-black text-lg ${popular ? 'text-white' : 'text-navy-700'}`}>
          {name}
        </h3>
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
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
          /{priceUnit ?? 'mo'}
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
        {loading ? 'Loading…' : cta}
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
  const [billing, setBilling] = useState<Billing>('annual');
  const [loading, setLoading] = useState<string | null>(null);

  // Read the user's current plan from the JWT-enriched session
  const userPlan = (session?.user as { plan?: string })?.plan as PlanTier | undefined ?? 'free';

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
    ? `Billed ${fmt(PRICING.pro.annual)}/yr — 2 months FREE`
    : 'Billed monthly · cancel anytime';

  const fleetSubline = billing === 'annual'
    ? `Billed ${fmt(PRICING.fleet.annual)}/yr — 2 months FREE`
    : 'Billed monthly · cancel anytime';

  // Per-card CTA text based on user's current plan
  function freeCta()  {
    if (!session)            return 'Get started free →';
    if (userPlan === 'free') return '✓ Your current plan';
    return 'Downgrade to Free';
  }
  function proCta()  {
    if (userPlan === 'pro')   return '✓ Your current plan';
    if (userPlan === 'fleet') return 'Downgrade to Pro';
    return 'Upgrade to Pro →';
  }
  function fleetCta() {
    if (userPlan === 'fleet') return '✓ Your current plan';
    return 'Start Fleet Plan →';
  }

  return (
    <section aria-labelledby="pricing-heading" className="mt-10">

      {/* Heading */}
      <h2 id="pricing-heading" className="section-eyebrow">Plans & Pricing</h2>
      <p className="text-center text-slate-500 text-sm mb-6 -mt-2 leading-relaxed">
        Start free. Upgrade when you&apos;re ready. No surprises.
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
          Monthly
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
          Annual
          <span className="bg-green-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
            2 MO FREE
          </span>
        </button>
      </div>

      {/* Cards — stacked on mobile, 3-col on md+ */}
      <div className="grid gap-4 md:grid-cols-3 md:items-start">

        {/* Free */}
        <PlanCard
          name="Free"
          badge="No CC Ever"
          badgeColor="bg-green-100 text-green-700"
          price="$0"
          priceUnit="forever"
          subline="Full calculator · gas prices · offline PWA · no catch"
          cta={freeCta()}
          ctaStyle={
            userPlan === 'free' && session
              ? 'bg-green-100 text-green-700 cursor-default'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60'
          }
          features={FREE_FEATURES}
          isCurrent={!!session && userPlan === 'free'}
          onCta={() => !session && router.push('/signup')}
        />

        {/* Pro */}
        <PlanCard
          name="Pro"
          badge="Individual"
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
        />

        {/* Fleet */}
        <PlanCard
          name="Fleet"
          badge="Business"
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
        />
      </div>

      {/* Annual savings callout */}
      {billing === 'annual' && (
        <div className="mt-5 text-center animate-fade-in">
          <p className="text-xs text-green-600 font-semibold">
            🎉 You save <strong>{fmt(PRICING.pro.monthly * 2)}</strong> on Pro
            and <strong>{fmt(PRICING.fleet.monthly * 2)}</strong> on Fleet by paying annually
          </p>
        </div>
      )}

      {/* Trust footnote */}
      <p className="text-center text-xs text-slate-400 mt-6 leading-relaxed">
        Payments processed securely by Stripe · Cancel anytime · No hidden fees
      </p>
    </section>
  );
}
