'use client';

import { useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PRICING } from '@/lib/stripe';
import { useTranslation } from '@/contexts/LanguageContext';
import { getawayPromoActive, getawayDaysLeft } from '@/lib/getawayPromo';
import BrandBar from '@/components/BrandBar';
import { useIsNative } from '@/hooks/useIsNative';

// ── Feature lists are defined inside UpgradePageInner (need t)

// ── Helpers ───────────────────────────────────────────────────────────────

function Check({ color = 'green' }: { color?: 'green' | 'amber' | 'teal' }) {
  const colors = { green: 'text-green-500', amber: 'text-amber-500', teal: 'text-teal-400' };
  return (
    <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${colors[color]}`}
         viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

function UpgradePageInner() {
  const { data: session } = useSession();
  const { t } = useTranslation();

  const FREE_FEATURES = t.pricing.freeFeatures;
  const PRO_FEATURES  = t.pricing.proFeatures;
  const LIFETIME_EXCLUSIVES = [
    { icon: '⭐', text: t.pricing.exTwoXEntries },
    { icon: '🛡️', text: t.pricing.exStreakShield },
    { icon: '🏅', text: t.pricing.exLifetimeBadge },
  ];

  const searchParams = useSearchParams();
  const coupon = searchParams.get('coupon') ?? undefined;
  const wb     = searchParams.get('wb') === '1'; // win-back $9.99 Lifetime offer
  const isNative = useIsNative();   // no in-app checkout in the native wrappers
  const [loading, setLoading] = useState<'pro-monthly' | 'pro-lifetime' | null>(null);
  const [error,   setError]   = useState('');

  const userPlan      = (session?.user as { plan?: string })?.plan ?? 'free';
  const userInterval  = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const isOnTrial     = !!(session?.user as { isProTrial?: boolean })?.isProTrial;
  const isProMonthly  = !!session && userPlan === 'pro' && userInterval !== 'lifetime' && !isOnTrial;
  const isProLifetime = !!session && userPlan === 'pro' && userInterval === 'lifetime' && !isOnTrial;
  const showGetaway   = getawayPromoActive() && !isProLifetime;
  const getawayDays   = getawayDaysLeft();

  async function handleUpgrade(billing: 'monthly' | 'lifetime') {
    if (!session) { window.location.href = '/signup?next=/upgrade'; return; }
    setLoading(billing === 'lifetime' ? 'pro-lifetime' : 'pro-monthly');
    setError('');
    try {
      // Only apply promo coupon on monthly — lifetime is already a one-time deal
      const applyCoupon = coupon && billing === 'monthly' ? { coupon } : {};
      // Win-back $9.99 Lifetime — request the server-validated discount on lifetime
      const applyWinback = wb && billing === 'lifetime' ? { winbackOffer: true } : {};
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: 'pro', billing, ...applyCoupon, ...applyWinback }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) { window.location.href = data.url; }
      else { setError(data.error ?? 'Something went wrong.'); }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(null);
    }
  }

  // In the native apps we don't run Stripe checkout (App Store / Play require
  // their own billing for digital goods). Pro is managed on the web instead.
  if (isNative) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex flex-col">
        <BrandBar />
        <div className="flex-1 px-4 py-12 max-w-md mx-auto w-full flex flex-col items-center justify-center text-center">
          <div className="bg-white rounded-3xl shadow-card p-8 space-y-4 w-full">
            <p className="text-4xl" aria-hidden="true">🌐</p>
            <h1 className="text-xl font-black text-navy-700">Manage Pro on the web</h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              GasCap™ Pro plans are managed on the web. Sign in at{' '}
              <span className="font-bold text-brand-dark">gascap.app</span> from your browser to
              start or change a plan — anything you unlock is instantly available here in the app.
            </p>
            <Link
              href="/"
              className="block w-full py-3.5 rounded-2xl font-black text-base text-white text-center
                         bg-gradient-to-r from-[#005F4A] to-[#1EB68F] hover:opacity-95 transition-opacity"
            >
              Continue with the free app
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">

      <BrandBar />

      <div className="flex-1 px-4 py-10 max-w-7xl mx-auto w-full">

        {/* Heading */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-navy-700 leading-tight">
            {t.upgrade.title}
          </h1>
          <p className="text-slate-500 mt-2 text-sm">
            {t.upgrade.sub}
          </p>
        </div>

        {/* Pro hero features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <div className="bg-white rounded-2xl border-2 border-amber-300 shadow-sm px-5 py-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">🔮</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-black text-slate-800">Smart Fill-Up Optimizer</p>
                <span className="text-[9px] font-black bg-amber-500 text-white px-2 py-0.5 rounded-full">NEW</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Uses live EIA data for your state to tell you the best time to fill up — with exact dollar savings.
              </p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">🔔</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-800">Gas Price Drop Alerts</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Set a target price per gallon. Get notified the moment your state drops below it.
              </p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">📊</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-800">MPG Trends & Spending Analytics</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Visual charts of your MPG, monthly spend, and national price context.
              </p>
            </div>
          </div>
        </div>

        {/* Early-upgrade bonus */}
        {(session?.user as { isProTrial?: boolean } | undefined)?.isProTrial && (
          <div className="bg-teal-50 border border-teal-300 rounded-2xl px-5 py-4 mb-6 flex items-start gap-3">
            <span className="text-2xl flex-shrink-0" aria-hidden="true">🎰</span>
            <div>
              <p className="text-sm font-black text-teal-800">
                {t.upgrade.trialBonusTitle}
              </p>
              <p className="text-xs text-teal-700 mt-1 leading-relaxed">
                Upgrade before your 30-day trial expires and earn 10 extra entries into the
                monthly gas card giveaway every month you stay on Pro. These stack on top of
                your regular entries from app activity and streaks.
              </p>
            </div>
          </div>
        )}

        {/* Win-back offer notice — $9.99 Lifetime applied at checkout */}
        {wb && (
          <div className="flex items-center justify-center mb-6">
            <div className="bg-teal-50 border border-teal-300 rounded-xl px-5 py-2.5 text-center">
              <p className="text-sm font-black text-teal-800">
                👋 Welcome back! Your 50%-off Lifetime price is locked in.
              </p>
              <p className="text-xs text-teal-700 mt-0.5">
                Choose <span className="font-bold">Pro Lifetime</span> below — $9.99 (reg. $19.99) is applied automatically at checkout.
              </p>
            </div>
          </div>
        )}

        {/* Promo notice */}
        {coupon && (
          <div className="flex items-center justify-center mb-6">
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-2 text-sm font-bold text-amber-800">
              {t.upgrade.promoApplied}
            </div>
          </div>
        )}

        {error && (
          <p className="text-center text-sm text-red-500 mb-4">{error}</p>
        )}

        {/* ── 3-panel pricing cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">

          {/* Free */}
          <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm p-6 flex flex-col">
            <div className="mb-4">
              <span className="inline-block bg-slate-100 text-slate-600 text-[10px] font-black
                               px-2 py-0.5 rounded-full uppercase tracking-wider mb-2">
                {t.upgrade.noCC}
              </span>
              <h2 className="text-xl font-black text-navy-700">Free</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t.upgrade.foreverSub}</p>
            </div>
            <div className="mb-1">
              <span className="text-4xl font-black text-navy-700">$0</span>
            </div>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              {t.upgrade.freeDesc}
            </p>
            <div className="border-t border-slate-100 mb-5" />
            <ul className="space-y-2 flex-1">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                  <Check color="green" /> {f}
                </li>
              ))}
            </ul>
            {!session && (
              <Link href="/signup"
                className="mt-6 block w-full py-3 rounded-2xl bg-slate-100 text-slate-600
                           font-black text-sm text-center hover:bg-slate-200 transition-colors">
                {t.upgrade.getStartedFreeBtn}
              </Link>
            )}
          </div>

          {/* Pro Monthly */}
          <div className="relative bg-white rounded-3xl border-2 border-amber-400 shadow-card p-6 flex flex-col">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-400 text-navy-900
                            text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider
                            whitespace-nowrap shadow-md">
              {t.pricing.mostPopular}
            </div>
            <div className="mb-4 mt-1">
              <span className="inline-block bg-amber-100 text-amber-700 text-[10px] font-black
                               px-2 py-0.5 rounded-full uppercase tracking-wider mb-2">
                {t.upgrade.monthly}
              </span>
              <h2 className="text-xl font-black text-navy-700">Pro</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t.upgrade.cancelAnytime}</p>
            </div>
            <div className="mb-1 flex items-end gap-1">
              <span className="text-4xl font-black text-navy-700">${PRICING.pro.monthly}</span>
              <span className="text-sm mb-1 text-slate-400">/mo</span>
            </div>
            <p className="text-xs text-green-600 font-semibold mb-6 leading-relaxed">
              {t.upgrade.lessThanDime}
            </p>
            <button
              onClick={() => !isProMonthly && !isProLifetime && handleUpgrade('monthly')}
              disabled={loading !== null || isProMonthly || isProLifetime}
              className={`w-full py-3 rounded-2xl font-black text-sm transition-colors mb-5 ${
                isProMonthly
                  ? 'bg-green-500 text-white cursor-default'
                  : isProLifetime
                    ? 'bg-slate-200 text-slate-400 cursor-default'
                    : 'bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-50'
              }`}>
              {loading === 'pro-monthly'
                ? t.upgrade.redirecting
                : isProMonthly
                  ? t.upgrade.currentPlan
                  : isProLifetime
                    ? t.pricing.includedInLifetime
                    : isOnTrial
                      ? `${t.pricing.upgradeFromTrial} — $${PRICING.pro.monthly}/mo`
                      : session ? `${t.upgrade.upgradeBtn} Pro — $${PRICING.pro.monthly}/mo` : t.pricing.startFreeTrial}
            </button>
            <div className="border-t border-slate-100 mb-5" />
            <ul className="space-y-2 flex-1">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <Check color="amber" /> {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Pro Lifetime */}
          <div className="relative bg-navy-700 rounded-3xl border-2 border-teal-400 shadow-card p-6 flex flex-col">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-teal-400 text-navy-900
                            text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider
                            whitespace-nowrap shadow-md">
              ★ {t.pricing.lifetimeRibbon}
            </div>
            <div className="mb-4 mt-1">
              <span className="inline-block bg-teal-400/20 text-teal-300 text-[10px] font-black
                               px-2 py-0.5 rounded-full uppercase tracking-wider mb-2">
                {t.pricing.lifetimeBadge}
              </span>
              <h2 className="text-xl font-black text-white">Pro Lifetime</h2>
              <p className="text-xs text-white/50 mt-0.5">{t.upgrade.noSubscription}</p>
            </div>
            <div className="mb-1 flex items-end gap-1">
              <span className="text-4xl font-black text-white">${PRICING.pro.lifetime}</span>
            </div>
            <p className="text-xs text-teal-300 font-semibold mb-4 leading-relaxed">
              {t.upgrade.onePaymentForever}
            </p>
            {showGetaway && (
              <div className="mb-5 rounded-2xl bg-gradient-to-r from-[#005F4A] to-[#1EB68F] px-3.5 py-3">
                <p className="flex items-center flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300">
                  🏝️ {t.pricing.getawayPill}
                  {getawayDays !== null && (
                    <span className="bg-amber-400 text-navy-900 px-1.5 py-0.5 rounded-full tracking-normal whitespace-nowrap">
                      ⏳ {getawayDays} {getawayDays === 1 ? t.pricing.getawayDayLeft : t.pricing.getawayDaysLeft}
                    </span>
                  )}
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
              className={`w-full py-3 rounded-2xl font-black text-sm transition-colors mb-5 ${
                isProLifetime
                  ? 'bg-green-400 text-navy-900 cursor-default'
                  : 'bg-teal-400 hover:bg-teal-300 text-navy-900 disabled:opacity-50'
              }`}>
              {loading === 'pro-lifetime'
                ? t.upgrade.redirecting
                : isProLifetime
                  ? t.upgrade.currentPlan
                  : isProMonthly
                    ? `${t.pricing.upgradeToLifetime} — $${PRICING.pro.lifetime}`
                    : isOnTrial
                      ? `${t.pricing.upgradeFromTrial} — $${PRICING.pro.lifetime}`
                      : `${t.pricing.getLifetime} — $${PRICING.pro.lifetime}`}
            </button>
            <a href="/gift" className="block text-center text-xs font-semibold text-teal-300 hover:text-teal-200 -mt-3 mb-4">
              🎁 {t.pricing.giftThis ?? 'Gift this to someone'}
            </a>
            <div className="border-t border-white/10 mb-5" />
            {/* Everything in Pro */}
            <ul className="space-y-2">
              <li className="flex items-start gap-2 text-sm text-white/80">
                <Check color="teal" /> {t.pricing.everythingInPro}
              </li>
            </ul>
            {/* Lifetime-exclusive perks */}
            <div className="mt-5 mb-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 border-t border-teal-400/30" />
                <span className="text-[10px] font-black text-teal-300 uppercase tracking-widest whitespace-nowrap">
                  {t.pricing.lifetimeExclusives}
                </span>
                <div className="flex-1 border-t border-teal-400/30" />
              </div>
            </div>
            <ul className="space-y-2 flex-1">
              {LIFETIME_EXCLUSIVES.map((f) => (
                <li key={f.text} className="flex items-start gap-2 text-sm">
                  <span className="flex-shrink-0 mt-0.5">{f.icon}</span>
                  <span className="text-teal-200 font-semibold">{f.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-center text-[11px] text-white/40 leading-relaxed">
              {t.pricing.breakEven}
            </p>
          </div>

        </div>

        {/* Guarantee + refund notes */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">🎯</span>
            <div>
              <p className="text-xs font-black text-amber-800">{t.pricing.guaranteeTitle} <span className="font-normal">{t.pricing.guaranteeMonthly}</span></p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                {t.pricing.guaranteeBody}
              </p>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">🏅</span>
            <div>
              <p className="text-xs font-black text-slate-700">{t.pricing.lifetimeFinal}</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {t.pricing.lifetimeFinalBody}
              </p>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          <Link href="/" className="hover:text-slate-600 underline">{t.upgrade.backLink}</Link>
          {' · '}
          <Link href="/help" className="hover:text-slate-600 underline">{t.upgrade.help}</Link>
          {' · '}
          <Link href="/terms" className="hover:text-slate-600 underline">{t.upgrade.terms}</Link>
          {' · '}
          <Link href="/privacy" className="hover:text-slate-600 underline">{t.upgrade.privacy}</Link>
        </p>
      </div>
    </div>
  );
}

export default function UpgradePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#eef1f7]" />}>
      <UpgradePageInner />
    </Suspense>
  );
}
