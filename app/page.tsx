'use client';

import { useState, useEffect } from 'react';
import { useSession }   from 'next-auth/react';
import AdSenseBanner    from '@/components/AdSenseBanner';
import Header                    from '@/components/Header';
import CalculatorTabs            from '@/components/CalculatorTabs';
import ToolsPanel                from '@/components/ToolsPanel';
import PricingSection            from '@/components/PricingSection';
import EmailVerificationBanner   from '@/components/EmailVerificationBanner';
import ReviewsMarquee            from '@/components/ReviewsMarquee';

// ── Guest landing — features + social proof shown to non-signed-in visitors ──

function LandingFeatures() {
  return (
    <section className="px-4 pt-2 pb-6 max-w-lg mx-auto w-full">

      {/* Section label */}
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">🚀</span>
        <h2 className="text-sm font-black text-slate-700 uppercase tracking-wider">
          Why GasCap?
        </h2>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Feature grid — 2×2 */}
      <div className="grid grid-cols-2 gap-3">

        <div className="bg-white rounded-2xl p-4 shadow-card border border-slate-100">
          <span className="text-2xl">⛽</span>
          <h3 className="text-sm font-black text-navy-700 mt-2 leading-tight">Live gas prices</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Real-time local prices pulled automatically — no more guessing what it costs in your area.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-card border border-slate-100">
          <span className="text-2xl">📡</span>
          <h3 className="text-sm font-black text-navy-700 mt-2 leading-tight">Works offline</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Install it like an app. Spotty signal? No problem — your tank data is always available.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-card border border-slate-100">
          <span className="text-2xl">📊</span>
          <h3 className="text-sm font-black text-navy-700 mt-2 leading-tight">MPG & spend tracking</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Log every fillup. See your MPG trend, monthly spend, and vehicle efficiency over time.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-card border border-slate-100">
          <span className="text-2xl">🤖</span>
          <h3 className="text-sm font-black text-navy-700 mt-2 leading-tight">AI fuel advisor</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Ask anything — best fill strategy, gas grade for your car, ways to improve your MPG.
          </p>
        </div>

      </div>

      {/* Trust badges row */}
      <div className="flex items-center justify-center gap-4 mt-5 flex-wrap">
        {[
          { icon: '🔒', label: 'No CC needed' },
          { icon: '✓',  label: 'Free forever' },
          { icon: '⚡', label: 'Instant results' },
        ].map(({ icon, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="text-xs text-amber-500">{icon}</span>
            <span className="text-xs text-slate-500 font-semibold">{label}</span>
          </div>
        ))}
      </div>

    </section>
  );
}

// ── Final CTA banner for guests ──────────────────────────────────────────────

function GuestCtaBanner() {
  return (
    <section className="px-4 py-8 max-w-lg mx-auto w-full">
      <div className="bg-navy-700 rounded-3xl px-6 py-8 text-center relative overflow-hidden">
        {/* Decorative arc */}
        <svg className="absolute top-0 right-0 opacity-[0.07] pointer-events-none"
             width="180" height="140" viewBox="0 0 180 140" aria-hidden="true">
          <path d="M 150 135 A 125 125 0 0 0 25 135"
            fill="none" stroke="white" strokeWidth="28" strokeLinecap="round" />
        </svg>

        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-3 py-1 mb-4">
            <span className="text-amber-400 text-xs">⭐</span>
            <span className="text-white/80 text-[11px] font-bold">Free — no credit card ever</span>
          </div>
          <h2 className="text-2xl font-black text-white leading-tight mb-2">
            Know before<br />you pull up.
          </h2>
          <p className="text-white/60 text-sm leading-relaxed mb-6 max-w-[260px] mx-auto">
            Save your vehicles, track your MPG, and stop over-paying at the pump.
          </p>
          <a
            href="/signup"
            className="inline-block w-full max-w-xs py-3.5 bg-amber-500 hover:bg-amber-400
                       text-white text-sm font-black rounded-2xl transition-colors shadow-amber"
          >
            Create free account →
          </a>
          <p className="text-white/30 text-[10px] mt-3">
            Already have an account?{' '}
            <a href="/signin" className="text-white/50 hover:text-white/80 underline transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [showPricing, setShowPricing] = useState(false);
  const { data: session, status } = useSession();
  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';
  const isGuest  = !session;

  // Auto-expand pricing for guests once session is resolved
  useEffect(() => {
    if (status !== 'loading' && isGuest) setShowPricing(true);
  }, [status, isGuest]);

  // Scroll to top when session loads (prevents AI Advisor from pulling page down)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [session]);

  return (
    <main className="min-h-screen flex flex-col bg-slate-50">
      {/* Email verification prompt — shown when signed in but unverified */}
      <EmailVerificationBanner />

      {/* Hero / Brand Header */}
      <Header />

      {/* Calculator */}
      <section className="flex-1 px-4 pt-5 pb-4 max-w-lg mx-auto w-full">
        <CalculatorTabs />
      </section>

      {/* Guest nudge — sign up to save calculations */}
      {isGuest && (
        <section className="px-4 -mt-2 pb-2 max-w-lg mx-auto w-full">
          <div className="bg-navy-700 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl flex-shrink-0">💾</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-white">Save your calculations</p>
              <p className="text-[10px] text-white/60 mt-0.5">Free account — no credit card ever.</p>
            </div>
            <a
              href="/signup"
              className="flex-shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-400
                         text-white text-xs font-black rounded-xl transition-colors whitespace-nowrap"
            >
              Sign up free
            </a>
          </div>
        </section>
      )}

      {/* AdSense — free users only */}
      {(isGuest || userPlan === 'free') && (
        <AdSenseBanner slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ID} />
      )}

      {/* Tools & Insights — tabbed panel */}
      <section className="px-4 pb-6 max-w-lg mx-auto w-full">
        <ToolsPanel />
      </section>

      {/* ── Guest-only landing content ───────────────────────────────── */}
      {isGuest && (
        <>
          {/* Features grid */}
          <LandingFeatures />

          {/* Reviews marquee — full bleed */}
          <ReviewsMarquee />

          {/* Sign-up CTA */}
          <GuestCtaBanner />
        </>
      )}

      {/* Pricing — collapsible for logged-in, auto-expanded for guests */}
      <section className="px-4 pb-12 max-w-2xl mx-auto w-full">
        <button
          onClick={() => setShowPricing((v) => !v)}
          className="w-full flex items-center justify-between py-3 px-4 bg-white rounded-2xl
                     border border-slate-100 shadow-sm hover:border-amber-200 transition-colors mb-2"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⭐</span>
            <div className="text-left">
              <p className="text-sm font-black text-slate-700">Plans &amp; Pricing</p>
              <p className="text-[10px] text-slate-400">Free · Pro $4.99/mo · Fleet $19.99/mo</p>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showPricing ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M 4 6l4 4 4-4" />
          </svg>
        </button>
        {showPricing && <PricingSection />}
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 bg-white py-8 pb-24 px-4 text-center space-y-3">
        <p className="font-black text-slate-700">
          GasCap<sup className="text-amber-500 text-[10px] font-bold">™</sup>
        </p>
        <p className="text-xs text-slate-400">Gas Capacity — Know before you go.</p>
        <p className="text-[10px] text-slate-300">© {new Date().getFullYear()} GasCap™ — All rights reserved.</p>

        {/* VNetCard lead magnet */}
        <a
          href="https://vnetcard.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-full
                     bg-navy-700 hover:bg-navy-600 transition-colors group"
        >
          <span className="text-[10px] text-white/50 font-medium">Powered by</span>
          <span className="text-[11px] font-black text-amber-400 group-hover:text-amber-300 transition-colors">
            VNetCard™
          </span>
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white/30 group-hover:text-white/50 transition-colors"
               fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M2 6h8M6 2l4 4-4 4"/>
          </svg>
        </a>
        <p className="text-[10px] text-slate-300">
          Share your digital business card with anyone, anywhere.
        </p>
        {/* Legal links */}
        <div className="flex items-center justify-center gap-4 pt-1">
          <a href="/help"    className="text-[11px] text-slate-300 hover:text-amber-500 transition-colors">Help &amp; Support</a>
          <span className="text-slate-200">·</span>
          <a href="/terms"   className="text-[11px] text-slate-300 hover:text-amber-500 transition-colors">Terms of Service</a>
          <span className="text-slate-200">·</span>
          <a href="/privacy" className="text-[11px] text-slate-300 hover:text-amber-500 transition-colors">Privacy Policy</a>
        </div>
      </footer>
    </main>
  );
}
