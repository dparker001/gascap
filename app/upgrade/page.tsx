'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { PRICING } from '@/lib/stripe';
import { useTranslation } from '@/contexts/LanguageContext';

// ── Feature lists ─────────────────────────────────────────────────────────

const FREE_FEATURES = [
  '1 saved vehicle',
  'Target Fill calculator',
  'By Budget calculator',
  'EPA vehicle database search',
  'Live local gas price lookup',
  'Works offline (PWA)',
  'Badge achievements',
];

const PRO_FEATURES = [
  'Up to 3 saved vehicles',
  'VIN photo scan — auto-decode vehicle',
  'Manual entry + auto spec lookup',
  'Fill-up history & MPG tracking',
  'Receipt photo scan (AI-powered)',
  'Referral rewards',
  'All Free features included',
  'Priority support',
];

const FLEET_FEATURES = [
  'Unlimited vehicles',
  'Household & multi-vehicle use',
  'Fleet-wide fuel dashboard',
  'Per-vehicle spending breakdown',
  'Annual tax report (PDF)',
  'Bulk vehicle import',
  'CSV export for accounting',
  'Referral rewards',
  'All Pro features included',
  'Multi-driver sub-accounts (coming soon)',
  'Dedicated fleet support',
];

// ── Helpers ───────────────────────────────────────────────────────────────

function Check({ color = 'green' }: { color?: 'green' | 'amber' | 'blue' }) {
  const colors = { green: 'text-green-500', amber: 'text-amber-500', blue: 'text-blue-500' };
  return (
    <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${colors[color]}`}
         viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd" />
    </svg>
  );
}

function GasPumpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
      <rect x="2" y="6" width="11" height="16" rx="1.5" />
      <rect x="4" y="9" width="7" height="4" rx="0.75" />
      <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
      <circle cx="18.5" cy="18.5" r="1.5" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function UpgradePage() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('annual');
  const [loading, setLoading] = useState<'pro' | 'fleet' | null>(null);
  const [error,   setError]   = useState('');

  async function handleUpgrade(tier: 'pro' | 'fleet') {
    if (!session) { window.location.href = '/signin?next=/upgrade'; return; }
    setLoading(tier);
    setError('');
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier, billing }),
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

  const proPrice   = billing === 'annual' ? `$${PRICING.pro.annual}/yr`   : `$${PRICING.pro.monthly}/mo`;
  const fleetPrice = billing === 'annual' ? `$${PRICING.fleet.annual}/yr` : `$${PRICING.fleet.monthly}/mo`;
  const proSub     = billing === 'annual' ? `$${PRICING.pro.annualPerMonth}/mo billed annually` : '';
  const fleetSub   = billing === 'annual' ? `$${PRICING.fleet.annualPerMonth}/mo billed annually` : '';

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">

      {/* Brand bar */}
      <div className="bg-brand-dark px-5 py-4">
        <Link href="/" className="flex items-center w-fit">
          <div className="bg-white rounded-xl px-3 py-1.5">
            <img src="/logo-lockup-green.png" alt="GasCap" className="h-7 w-auto" />
          </div>
        </Link>
      </div>

      <div className="flex-1 px-4 py-10 max-w-2xl mx-auto w-full">

        {/* Heading */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-black text-navy-700 leading-tight">
            {t.upgrade.title}
          </h1>
          <p className="text-slate-500 mt-2 text-sm">
            {t.upgrade.sub}
          </p>
        </div>

        {/* Pro hero features — visual upsell before pricing cards */}
        <div className="grid grid-cols-1 gap-3 mb-8">
          {/* Smart Fill-Up Optimizer */}
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
                Uses live EIA government data for your state to tell you the best time to fill up this week —
                with an exact dollar amount you could save. Personalized to your actual fill-up size.
              </p>
            </div>
          </div>
          {/* Gas Price Alerts */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">🔔</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-800">Gas Price Drop Alerts</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Set a target price per gallon. Get a push notification the moment your state average
                drops below it — so you never miss a cheap fill-up window.
              </p>
            </div>
          </div>
          {/* Charts */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <span className="text-xl">📊</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-slate-800">MPG Trends & Spending Analytics</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Visual charts of your MPG over time, monthly spend comparisons, per-vehicle breakdowns,
                and national price context — all in one place.
              </p>
            </div>
          </div>
        </div>

        {/* Early-upgrade bonus callout — shown only during trial */}
        {(session?.user as { isProTrial?: boolean } | undefined)?.isProTrial && (
          <div className="bg-teal-50 border border-teal-300 rounded-2xl px-5 py-4 mb-6 flex items-start gap-3">
            <span className="text-2xl flex-shrink-0" aria-hidden="true">🎰</span>
            <div>
              <p className="text-sm font-black text-teal-800">
                Upgrade during your trial → +10 bonus draw entries/month, forever
              </p>
              <p className="text-xs text-teal-700 mt-1 leading-relaxed">
                Upgrade before your 30-day trial expires and earn 10 extra entries into the
                monthly gas card giveaway <em>every</em> month you stay on Pro or Fleet.
                These stack on top of your regular entries from app activity and streaks.
              </p>
            </div>
          </div>
        )}

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <button onClick={() => setBilling('monthly')}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${
              billing === 'monthly' ? 'bg-navy-700 text-white shadow' : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}>
            {t.upgrade.monthly}
          </button>
          <button onClick={() => setBilling('annual')}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all relative ${
              billing === 'annual' ? 'bg-navy-700 text-white shadow' : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}>
            {t.upgrade.annual}
            <span className="absolute -top-2 -right-2 bg-green-500 text-white text-[9px]
                             font-black px-1.5 py-0.5 rounded-full leading-none">
              {t.upgrade.saveBadge}
            </span>
          </button>
        </div>

        {error && (
          <p className="text-center text-sm text-red-500 mb-4">{error}</p>
        )}

        {/* Plan cards */}
        <div className="space-y-4">

          {/* ── Pro ── */}
          <div id="pro" className="bg-white rounded-3xl shadow-card border-2 border-amber-400 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="inline-block bg-amber-100 text-amber-700 text-[10px] font-black
                                 px-2 py-0.5 rounded-full uppercase tracking-wider mb-1">
                  {t.upgrade.mostPopular}
                </span>
                <h2 className="text-xl font-black text-navy-700">Pro</h2>
                <p className="text-xs text-slate-400 mt-0.5">{t.upgrade.proFor}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-navy-700">{proPrice}</p>
                {proSub && <p className="text-[11px] text-green-600 font-semibold">{proSub}</p>}
              </div>
            </div>

            <ul className="space-y-2 mb-5">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <Check color="amber" /> {f}
                </li>
              ))}
            </ul>

            <button onClick={() => handleUpgrade('pro')} disabled={loading !== null}
              className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-white
                         font-black text-sm disabled:opacity-50 transition-colors">
              {loading === 'pro' ? t.upgrade.redirecting : session ? `${t.upgrade.upgradeBtn} Pro — ${proPrice}` : t.upgrade.signInToUp}
            </button>
          </div>

          {/* ── Fleet ── */}
          <div id="fleet" className="bg-white rounded-3xl shadow-card border-2 border-blue-400 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="inline-block bg-blue-100 text-blue-700 text-[10px] font-black
                                 px-2 py-0.5 rounded-full uppercase tracking-wider mb-1">
                  {t.upgrade.houseAndBiz}
                </span>
                <h2 className="text-xl font-black text-navy-700">Fleet</h2>
                <p className="text-xs text-slate-400 mt-0.5">{t.upgrade.fleetFor}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-navy-700">{fleetPrice}</p>
                {fleetSub && <p className="text-[11px] text-green-600 font-semibold">{fleetSub}</p>}
              </div>
            </div>

            <ul className="space-y-2 mb-5">
              {FLEET_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <Check color="blue" /> {f}
                </li>
              ))}
            </ul>

            <button onClick={() => handleUpgrade('fleet')} disabled={loading !== null}
              className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white
                         font-black text-sm disabled:opacity-50 transition-colors">
              {loading === 'fleet' ? t.upgrade.redirecting : session ? `${t.upgrade.upgradeBtn} Fleet — ${fleetPrice}` : t.upgrade.signInToUp}
            </button>

            <p className="text-center text-[11px] text-slate-400 mt-2">
              {t.upgrade.enterprise}{' '}
              <a href="mailto:support@gascap.app" className="text-blue-500 hover:underline font-semibold">
                {t.upgrade.contactUs}
              </a>
            </p>
          </div>

          {/* ── Free ── */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-black text-navy-700">Free</h2>
              <span className="text-sm font-black text-slate-400">{t.upgrade.freeForever}</span>
            </div>
            <ul className="space-y-2">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                  <Check color="green" /> {f}
                </li>
              ))}
            </ul>
          </div>

        </div>

        {/* Safeguard note */}
        <div className="mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-bold text-slate-600 mb-1">{t.upgrade.safeguardTitle}</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            {t.upgrade.safeguardBody}
          </p>
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
