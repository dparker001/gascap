'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslation } from '@/contexts/LanguageContext';

// ── Per-plan content ────────────────────────────────────────────────────────

// Full Pro feature list — used on the monthly success page
const PRO_FEATURES = [
  '🚗  Unlimited saved vehicles',
  '🔍  VIN photo scan — auto-decode any vehicle',
  '📊  Fill-up history & MPG tracking',
  '🧾  Receipt photo scan (AI-powered)',
  '🔮  Smart Fill-Up Optimizer',
  '🔔  Gas Price Drop Alerts',
  '🎁  Monthly gas card giveaway entries',
  '🤖  AI Fuel Advisor',
];

// Lifetime Pro section — giveaway entry omitted since 2× version is in exclusives
const PRO_FEATURES_LIFETIME = [
  '🚗  Unlimited saved vehicles',
  '🔍  VIN photo scan — auto-decode any vehicle',
  '📊  Fill-up history & MPG tracking',
  '🧾  Receipt photo scan (AI-powered)',
  '🔮  Smart Fill-Up Optimizer',
  '🔔  Gas Price Drop Alerts',
  '🤖  AI Fuel Advisor',
];

const LIFETIME_EXCLUSIVES = [
  '⭐  2× giveaway entries every month',
  '🛡️  Streak Shield — 1 grace day/month',
  '🏅  Lifetime Member badge',
];

const PLANS = {
  'pro-monthly': {
    headline:   "You're Pro! 🎉",
    label:      'GasCap™ Pro',
    color:      'amber',
    intro:      'Your Pro subscription is active. Here\'s what\'s now unlocked:',
    perks:      PRO_FEATURES,
    exclusives: null,
  },
  'pro-lifetime': {
    headline:   "You're a Lifetime Member! 🏅",
    label:      'GasCap™ Pro Lifetime',
    color:      'teal',
    intro:      'One payment. Pro forever. Everything below is now unlocked:',
    perks:      PRO_FEATURES_LIFETIME,
    exclusives: LIFETIME_EXCLUSIVES,
  },
  'fleet': {
    headline:   "You're Fleet! 🎉",
    label:      'GasCap™ Fleet',
    color:      'blue',
    intro:      'Your Fleet plan is active. Here\'s what\'s now unlocked:',
    perks: [
      '🚗  Unlimited vehicles',
      '👥  Multi-driver access (up to 10 drivers)',
      '📊  Fleet cost dashboard',
      '📄  Annual tax report (PDF)',
      '📥  Bulk vehicle import',
      '🎁  Monthly gas card giveaway entries',
    ],
    exclusives: null,
  },
} as const;

type PlanKey = keyof typeof PLANS;

// ── Color helpers ────────────────────────────────────────────────────────────

function ctaClass(color: string) {
  if (color === 'teal') return 'bg-teal-500 hover:bg-teal-400 text-white';
  if (color === 'blue') return 'bg-blue-600 hover:bg-blue-500 text-white';
  return 'bg-amber-500 hover:bg-amber-400 text-white';
}
function iconBgClass(color: string) {
  if (color === 'teal') return 'bg-teal-100';
  if (color === 'blue') return 'bg-blue-100';
  return 'bg-amber-100';
}
function iconColorClass(color: string) {
  if (color === 'teal') return 'text-teal-500';
  if (color === 'blue') return 'text-blue-600';
  return 'text-amber-500';
}
function labelColorClass(color: string) {
  if (color === 'teal') return 'text-teal-600';
  if (color === 'blue') return 'text-blue-700';
  return 'text-amber-600';
}

// ── Main content ─────────────────────────────────────────────────────────────

function SuccessContent() {
  const params    = useSearchParams();
  const router    = useRouter();
  const { update: refreshSession } = useSession();
  const { t } = useTranslation();
  const sessionId = params.get('session_id');
  const tier      = params.get('tier') ?? 'pro';
  const billing   = params.get('billing') ?? 'monthly';
  const [ready, setReady] = useState(false);

  // Wait for webhook to fire, then refresh the JWT so the session reflects
  // the upgraded plan (clears isProTrial, sets stripeInterval, etc.)
  useEffect(() => {
    const t = setTimeout(async () => {
      await refreshSession(); // pulls fresh user data from DB into JWT
      setReady(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [refreshSession]);

  // Resolve which plan content to show
  let planKey: PlanKey;
  if (tier === 'fleet') {
    planKey = 'fleet';
  } else if (billing === 'lifetime') {
    planKey = 'pro-lifetime';
  } else {
    planKey = 'pro-monthly';
  }

  const plan = PLANS[planKey];

  return (
    <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center space-y-5">

      {/* Animated checkmark */}
      <div className={`w-20 h-20 rounded-full ${iconBgClass(plan.color)} flex items-center justify-center mx-auto`}>
        <svg className={`w-10 h-10 ${iconColorClass(plan.color)}`} viewBox="0 0 24 24"
             fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 className="text-2xl font-black text-navy-700">{plan.headline}</h1>

      <p className="text-slate-500 text-sm leading-relaxed">
        Welcome to{' '}
        <span className={`font-bold ${labelColorClass(plan.color)}`}>{plan.label}</span>.
        {' '}{plan.intro}
      </p>

      {/* Pro features */}
      <ul className="text-left space-y-2">
        {plan.perks.map((perk) => (
          <li key={perk} className="text-sm text-slate-700 leading-snug">{perk}</li>
        ))}
      </ul>

      {/* Lifetime exclusives — visually distinct section */}
      {plan.exclusives && (
        <>
          <div className="flex items-center gap-2 py-1">
            <div className="flex-1 border-t border-teal-200" />
            <span className="text-[10px] font-black text-teal-600 uppercase tracking-widest whitespace-nowrap">
              Lifetime exclusives
            </span>
            <div className="flex-1 border-t border-teal-200" />
          </div>
          <ul className="text-left space-y-2">
            {plan.exclusives.map((perk) => (
              <li key={perk} className="text-sm text-teal-700 font-semibold leading-snug">{perk}</li>
            ))}
          </ul>
        </>
      )}

      {sessionId && (
        <p className="text-[11px] text-slate-300 font-mono break-all">
          Ref: {sessionId.slice(-12)}
        </p>
      )}

      {/* GasCaptains™ community invite — Pro only */}
      {tier !== 'fleet' && (
        <a
          href={process.env.NEXT_PUBLIC_GASCAPTAINS_URL ?? 'https://www.facebook.com/groups/gascaptains'}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full rounded-2xl border-2 border-[#1EB68F] bg-[#f0fdf9] px-4 py-3.5
                     text-left hover:bg-[#e6faf5] transition-colors"
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F] mb-0.5">
            🏴 Members Only
          </p>
          <p className="text-sm font-black text-[#005F4A] leading-tight">
            Join GasCaptains™ →
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            The official private community for GasCap™ Pro members.
          </p>
        </a>
      )}

      {ready ? (
        <button
          onClick={() => router.push('/')}
          className={`block w-full py-3.5 rounded-2xl font-black text-base transition-colors text-center ${ctaClass(plan.color)}`}
        >
          {t.upgrade.goToCalculator}
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".25"/>
            <path d="M21 12a9 9 0 00-9-9" />
          </svg>
          {t.upgrade.activatingAccount}
        </div>
      )}
    </div>
  );
}

export default function UpgradeSuccessPage() {
  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col items-center justify-center px-4">
      <Suspense fallback={
        <div className="bg-white rounded-3xl shadow-card p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-400 animate-spin" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity=".25"/>
              <path d="M21 12a9 9 0 00-9-9" />
            </svg>
          </div>
          <p className="text-slate-400 text-sm">Loading…</p>
        </div>
      }>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
