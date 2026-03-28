'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { PRO_PRICE_MONTHLY_DISPLAY, PRO_PRICE_ANNUAL_DISPLAY } from '@/lib/stripe';

// ── Feature comparison ────────────────────────────────────────────────────

const FREE_FEATURES = [
  '1 saved vehicle',
  'Target Fill calculator',
  'By Budget calculator',
  'EPA vehicle database search',
  'Live gas price lookup',
  'Works offline (PWA)',
  'Badge achievements',
];

const PRO_FEATURES = [
  'Up to 5 saved vehicles',
  'Manual vehicle entry + auto spec lookup',
  'Engine type & tank size auto-detected',
  'All Free features included',
  'Early access to new features',
  'Priority support',
];

// ── Icon helpers ──────────────────────────────────────────────────────────

function Check({ pro }: { pro?: boolean }) {
  return (
    <svg className={`w-4 h-4 flex-shrink-0 ${pro ? 'text-amber-500' : 'text-green-500'}`}
         viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd" />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function UpgradePage() {
  const { data: session } = useSession();
  const [billing,   setBilling]   = useState<'monthly' | 'annual'>('annual');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function handleUpgrade() {
    if (!session) {
      window.location.href = '/signin?next=/upgrade';
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ priceId: billing === 'annual'
          ? process.env.NEXT_PUBLIC_STRIPE_PRICE_ANNUAL
          : process.env.NEXT_PUBLIC_STRIPE_PRICE_MONTHLY }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? 'Something went wrong. Try again.');
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#eef1f7] flex flex-col">

      {/* Brand bar */}
      <div className="bg-navy-700 px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5 w-fit">
          <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
              <rect x="2" y="6" width="11" height="16" rx="1.5" />
              <rect x="4" y="9" width="7" height="4" rx="0.75" />
              <path d="M13 8 L18 8 Q21 8 21 11 L21 16 Q21 18 19 18" />
              <circle cx="18.5" cy="18.5" r="1.5" />
            </svg>
          </div>
          <span className="text-white font-black text-lg">
            GasCap<sup className="text-amber-400 text-xs ml-0.5">™</sup>
          </span>
        </Link>
      </div>

      <div className="flex-1 px-4 py-10 max-w-lg mx-auto w-full">

        {/* Heading */}
        <div className="text-center mb-8">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold
                           px-3 py-1 rounded-full mb-3 uppercase tracking-wider">
            Upgrade
          </span>
          <h1 className="text-3xl font-black text-navy-700 leading-tight">
            GasCap™ <span className="text-amber-500">Pro</span>
          </h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">
            More vehicles, smarter lookups, and exclusive features.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <button
            onClick={() => setBilling('monthly')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              billing === 'monthly'
                ? 'bg-navy-700 text-white shadow'
                : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('annual')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all relative ${
              billing === 'annual'
                ? 'bg-navy-700 text-white shadow'
                : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            Annual
            <span className="absolute -top-2 -right-2 bg-green-500 text-white text-[9px]
                             font-black px-1.5 py-0.5 rounded-full leading-none">
              SAVE 33%
            </span>
          </button>
        </div>

        {/* Price card */}
        <div className="bg-white rounded-3xl shadow-card border-2 border-amber-400 p-6 mb-5">
          <div className="flex items-end gap-1 mb-1">
            <span className="text-4xl font-black text-navy-700">
              {billing === 'annual' ? PRO_PRICE_ANNUAL_DISPLAY : PRO_PRICE_MONTHLY_DISPLAY}
            </span>
            <span className="text-slate-400 text-sm mb-1.5">
              /{billing === 'annual' ? 'year' : 'month'}
            </span>
          </div>
          {billing === 'annual' && (
            <p className="text-xs text-green-600 font-semibold mb-4">
              That&apos;s just $3.33/month — save $20/year vs monthly
            </p>
          )}

          <ul className="space-y-2 mb-6">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                <Check pro /> {f}
              </li>
            ))}
          </ul>

          {error && (
            <p className="text-xs text-red-500 mb-3 text-center">{error}</p>
          )}

          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-amber-500 text-white font-black text-base
                       hover:bg-amber-400 disabled:opacity-50 transition-colors shadow-md"
          >
            {loading
              ? 'Redirecting to checkout…'
              : session
                ? `Upgrade to Pro — ${billing === 'annual' ? PRO_PRICE_ANNUAL_DISPLAY + '/yr' : PRO_PRICE_MONTHLY_DISPLAY + '/mo'}`
                : 'Sign in to Upgrade'}
          </button>

          <p className="text-center text-xs text-slate-400 mt-3">
            Cancel anytime · Powered by Stripe · Secured payment
          </p>
        </div>

        {/* Free tier reminder */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Free plan — always included
          </p>
          <ul className="space-y-2">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
                <Check /> {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          <Link href="/" className="hover:text-slate-600 underline">← Back to calculator</Link>
        </p>
      </div>
    </div>
  );
}
