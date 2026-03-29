'use client';

import { useState } from 'react';
import { useSession }   from 'next-auth/react';
import AdSenseBanner    from '@/components/AdSenseBanner';
import Header                    from '@/components/Header';
import CalculatorTabs            from '@/components/CalculatorTabs';
import ToolsPanel                from '@/components/ToolsPanel';
import PricingSection            from '@/components/PricingSection';
import EmailVerificationBanner   from '@/components/EmailVerificationBanner';

export default function Home() {
  const [showPricing, setShowPricing] = useState(false);
  const { data: session } = useSession();
  const userPlan = (session?.user as { plan?: string })?.plan ?? 'free';
  const isGuest  = !session;

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

      {/* Pricing — collapsible */}
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
            <path d="M4 6l4 4 4-4" />
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
