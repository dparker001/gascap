'use client';

import { useState, useEffect } from 'react';
import { useSession }          from 'next-auth/react';
import AdSenseBanner           from '@/components/AdSenseBanner';
import Header                  from '@/components/Header';
import CalculatorTabs          from '@/components/CalculatorTabs';
import ToolsPanel              from '@/components/ToolsPanel';
import PricingSection          from '@/components/PricingSection';
import EmailVerificationBanner from '@/components/EmailVerificationBanner';
import ReviewsMarquee          from '@/components/ReviewsMarquee';
import OnboardingModal         from '@/components/OnboardingModal';
import GasPriceAlertBanner     from '@/components/GasPriceAlertBanner';

// ── JSON-LD Schema Markup ────────────────────────────────────────────────────

function SchemaMarkup() {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'How does GasCap calculate how much gas I need?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'GasCap uses your current fuel level, your vehicle\'s tank size, and your target fill level to calculate the exact number of gallons needed. It then multiplies that by your local gas price — fetched automatically using live EIA data — to show you the exact cost before you reach the pump.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is GasCap free to use?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes — GasCap is free forever with no credit card required. The free plan includes the full fuel calculator, live gas prices, and offline access. Pro ($4.99/mo) and Fleet ($19.99/mo) plans add fill-up history, MPG tracking, AI advisor, PDF export, and more.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need to download an app from the App Store?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No app store needed. GasCap is a Progressive Web App (PWA) — just visit gascap.app on your phone and tap "Add to Home Screen" to install it like a native app. It works on iPhone, Android, and any browser.',
        },
      },
      {
        '@type': 'Question',
        name: 'What is Rental Car Return Mode?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Rental Car Return Mode is a GasCap feature that helps you avoid expensive refueling fees at car rental drop-off. Rental companies charge up to $12/gallon if you return with less than a full tank. Enter the rental company\'s rate and GasCap shows you exactly how many gallons to buy at the pump — and exactly how much you\'ll save.',
        },
      },
      {
        '@type': 'Question',
        name: 'How accurate are the gas prices?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'GasCap pulls weekly gas price data directly from the U.S. Energy Information Administration (EIA) — the same government source used by major news outlets. Prices are localized to your state using your device\'s GPS.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does GasCap work offline?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Once installed as a PWA, the core calculator works completely offline using your last-known gas price and saved vehicles. Live gas price lookup and AI features require an internet connection.',
        },
      },
      {
        '@type': 'Question',
        name: 'What vehicles does GasCap support?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'GasCap supports any gasoline or diesel vehicle. You can manually enter your tank size, or choose from hundreds of presets including economy cars, midsize sedans, SUVs, trucks, minivans, and rental car classes. Pro users can save up to 3 vehicles; Fleet users can save unlimited vehicles.',
        },
      },
      {
        '@type': 'Question',
        name: 'How is GasCap different from a road trip fuel cost calculator?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Road trip calculators estimate fuel cost for a journey based on distance. GasCap solves a different problem: it tells you exactly how much it will cost to fill your tank right now, based on your current fuel level and local prices. It\'s the tool you use at the pump — not while planning a route.',
        },
      },
    ],
  };

  const appSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'GasCap™',
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web, iOS, Android',
    description: 'Free fuel calculator that tells you exactly how much gas you need and what it will cost — before you pull up to the pump. Live local gas prices, MPG tracking, rental car return mode, and AI fuel advisor.',
    url: 'https://gascap.app',
    offers: [
      { '@type': 'Offer', price: '0', priceCurrency: 'USD', name: 'Free Plan' },
      { '@type': 'Offer', price: '4.99', priceCurrency: 'USD', name: 'Pro Plan', billingPeriod: 'Monthly' },
      { '@type': 'Offer', price: '19.99', priceCurrency: 'USD', name: 'Fleet Plan', billingPeriod: 'Monthly' },
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '5.0',
      ratingCount: '47',
      bestRating: '5',
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />
    </>
  );
}

// ── Guest Hero (above the calculator) ───────────────────────────────────────

function GuestHero() {
  return (
    <section className="px-4 pt-2 pb-5 max-w-lg mx-auto w-full text-center">
      {/* Eyebrow badge */}
      <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200
                      rounded-full px-3 py-1 mb-4">
        <span className="text-amber-500 text-xs">⭐</span>
        <span className="text-amber-700 text-[11px] font-bold">Free · No app store · Works offline</span>
      </div>

      {/* Headline */}
      <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 leading-tight mb-3">
        Know exactly how much gas you need —{' '}
        <span className="text-amber-500">before you pull up.</span>
      </h1>

      {/* Subheadline */}
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-5 max-w-sm mx-auto">
        GasCap calculates your exact fill-up cost using live local gas prices.
        No more guessing, no more overpaying — especially on rental car returns.
      </p>

      {/* Trust pills */}
      <div className="flex items-center justify-center gap-3 flex-wrap mb-2">
        {[
          { icon: '⛽', label: 'Live local prices' },
          { icon: '🚗', label: 'Rental car mode' },
          { icon: '📊', label: 'MPG tracking' },
          { icon: '🤖', label: 'AI advisor' },
        ].map(({ icon, label }) => (
          <span key={label}
            className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800
                       border border-slate-200 dark:border-slate-700
                       rounded-full px-3 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            <span>{icon}</span>{label}
          </span>
        ))}
      </div>
    </section>
  );
}

// ── Problem / Solution strip ─────────────────────────────────────────────────

function ProblemSolution() {
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100
                      dark:border-slate-700 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-sm font-black text-slate-700 dark:text-slate-200">
            Stop guessing at the pump
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            GasCap solves the three most frustrating gas station moments.
          </p>
        </div>

        {/* Rows */}
        {[
          {
            before: 'Wondering if you have enough cash to fill up',
            after:  'Know the exact cost before you swipe your card',
            icon:   '💳',
          },
          {
            before: 'Returning a rental car on empty — $12/gallon fees',
            after:  'Calculate exactly how many gallons to buy first',
            icon:   '🚗',
          },
          {
            before: 'No idea what you\'re spending on gas each month',
            after:  'MPG trends and monthly spend tracked automatically',
            icon:   '📊',
          },
        ].map(({ before, after, icon }, i) => (
          <div key={i} className="px-5 py-4 flex items-start gap-4
                                  border-b border-slate-50 dark:border-slate-700/50 last:border-0">
            <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-xs text-slate-400 line-through leading-relaxed">{before}</p>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-relaxed">
                ✓ {after}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Feature showcase ─────────────────────────────────────────────────────────

function Features() {
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">⚡</span>
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          Everything in one free app
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Feature grid 2×2 */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[
          {
            icon: '⛽',
            title: 'Live gas prices',
            body: 'Real-time local prices from the U.S. EIA — automatically localized to your state.',
          },
          {
            icon: '📡',
            title: 'Works offline',
            body: 'Install it like an app. No signal? The calculator always works with your saved data.',
          },
          {
            icon: '📊',
            title: 'MPG & spend tracking',
            body: 'Log every fill-up. See your efficiency trends, monthly spend, and fuel cost per mile.',
          },
          {
            icon: '🤖',
            title: 'AI fuel advisor',
            body: 'Ask anything — best fill strategy, octane grade, or how to improve your MPG.',
          },
        ].map(({ icon, title, body }) => (
          <div key={title}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm
                       border border-slate-100 dark:border-slate-700">
            <span className="text-2xl">{icon}</span>
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mt-2 leading-tight">
              {title}
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>

      {/* Rental car — full width feature card */}
      <div className="bg-blue-700 rounded-2xl p-4 shadow-sm flex items-start gap-3.5">
        <span className="text-3xl flex-shrink-0 mt-0.5" aria-hidden="true">🚗</span>
        <div>
          <h3 className="text-sm font-black text-white leading-tight">
            Renting a car? Never overpay at drop-off.
          </h3>
          <p className="text-xs text-blue-200 mt-1 leading-relaxed">
            Rental companies charge up to $12/gal if you return empty.
            GasCap™ Rental Car Return Mode tells you exactly how many gallons
            to buy — and shows your exact savings vs. letting them fill it.
          </p>
          <p className="text-[10px] text-blue-300/70 mt-2 font-semibold">
            Toggle "🚗 Rental Car Return?" in the calculator above.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Use cases ────────────────────────────────────────────────────────────────

function UseCases() {
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">👤</span>
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          Who uses GasCap™
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          {
            emoji: '🚘',
            who: 'Daily Drivers',
            what: 'Know your fill-up cost every time. Budget your gas spend to the dollar.',
          },
          {
            emoji: '✈️',
            who: 'Frequent Travelers',
            what: 'Use Rental Car Return Mode to skip the $12/gal refueling trap every trip.',
          },
          {
            emoji: '🗺️',
            who: 'Road Trippers',
            what: 'Plan your fuel budget stop by stop. Know costs before you leave the driveway.',
          },
          {
            emoji: '🚛',
            who: 'Fleet Managers',
            what: 'Track fuel costs across your entire fleet. Export reports. Control spending.',
          },
        ].map(({ emoji, who, what }) => (
          <div key={who}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm
                       border border-slate-100 dark:border-slate-700">
            <span className="text-2xl">{emoji}</span>
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mt-2">{who}</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{what}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar() {
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="bg-navy-700 rounded-2xl px-5 py-4 grid grid-cols-3 gap-4 text-center">
        {[
          { value: 'Free', label: 'Forever — no catch' },
          { value: '5.0★', label: 'Average rating' },
          { value: '<2s', label: 'Typical calculation' },
        ].map(({ value, label }) => (
          <div key={label}>
            <p className="text-lg font-black text-amber-400">{value}</p>
            <p className="text-[10px] text-white/50 mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── FAQ section (SEO) ────────────────────────────────────────────────────────

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);

  const faqs = [
    {
      q: 'How does GasCap calculate how much gas I need?',
      a: 'Enter your current fuel level (or drag the gauge), pick your vehicle, and set your target fill level. GasCap multiplies the gallons needed by your live local gas price — fetched automatically from the U.S. EIA — and shows you the exact cost in seconds.',
    },
    {
      q: 'Is GasCap free?',
      a: 'Yes — the core calculator, live gas prices, and offline access are free forever with no credit card required. Pro ($4.99/mo) adds fill-up history, MPG charts, AI advisor, and PDF export. Fleet ($19.99/mo) adds unlimited vehicles and fleet reporting.',
    },
    {
      q: 'Do I need to download it from the App Store?',
      a: 'No. GasCap is a Progressive Web App (PWA). Visit gascap.app on your phone, tap the Share button, then "Add to Home Screen." It installs like a native app — no App Store or Google Play required.',
    },
    {
      q: 'What is Rental Car Return Mode?',
      a: 'It\'s a special mode that helps you avoid rental company refueling fees. Rental agencies charge up to $12/gallon if you return with less than a full tank. Toggle "Rental Car Return?" in the calculator, enter the rental rate, and GasCap shows your exact savings vs. letting them fill it.',
    },
    {
      q: 'How accurate are the gas prices?',
      a: 'Very accurate. GasCap pulls weekly data directly from the U.S. Energy Information Administration (EIA) — the official government source. Prices are localized to your state automatically using your device\'s location.',
    },
    {
      q: 'Does it work offline?',
      a: 'Yes. Once installed as a PWA, the calculator works offline using your last-known gas price and saved vehicles. Live gas price lookup, gauge scanning, and AI features require a connection.',
    },
    {
      q: 'How is this different from a road trip fuel calculator?',
      a: 'Road trip calculators estimate fuel cost for a journey by distance. GasCap solves a different problem: it tells you exactly what it costs to fill your tank right now, based on your current level and local price. It\'s the tool you use at the pump — not while planning a route.',
    },
    {
      q: 'Can GasCap scan my gas gauge?',
      a: 'Yes — Pro users can tap "Scan Gauge" to take a photo of their dashboard. GasCap\'s AI reads the needle position and automatically sets your current fuel level. Supports arc, horizontal, and vertical sweep gauges.',
    },
  ];

  return (
    <section className="px-4 pb-8 max-w-lg mx-auto w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">❓</span>
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          Frequently Asked Questions
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="space-y-2">
        {faqs.map((faq, i) => (
          <div key={i}
            className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100
                       dark:border-slate-700 overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left"
              aria-expanded={open === i}
            >
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-snug">
                {faq.q}
              </span>
              <svg
                className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform duration-200
                            ${open === i ? 'rotate-180' : ''}`}
                viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" aria-hidden="true"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {open === i && (
              <div className="px-4 pb-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{faq.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Final CTA ────────────────────────────────────────────────────────────────

function GuestCtaBanner() {
  return (
    <section className="px-4 py-6 max-w-lg mx-auto w-full">
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

  // Scroll to top when session loads
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [session]);

  return (
    <main className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">

      {/* ── SEO Schema (guests only — no point injecting for auth'd users) ── */}
      {isGuest && <SchemaMarkup />}

      {/* Onboarding — shown once to new visitors */}
      {isGuest && <OnboardingModal />}

      {/* Email verification prompt */}
      <EmailVerificationBanner />

      {/* Gas price drop alert — Pro users */}
      <GasPriceAlertBanner />

      {/* Brand header */}
      <Header />

      {/* ── Guest hero — SEO headline above the calculator ────────────── */}
      {isGuest && <GuestHero />}

      {/* Calculator */}
      <section className="flex-1 px-4 pt-5 pb-4 max-w-lg mx-auto w-full">
        <CalculatorTabs />
      </section>

      {/* Guest — save nudge */}
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

      {/* AdSense — free + guest users */}
      {(isGuest || userPlan === 'free') && (
        <AdSenseBanner slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ID} />
      )}

      {/* Tools & Insights */}
      <section className="px-4 pb-6 max-w-lg mx-auto w-full">
        <ToolsPanel />
      </section>

      {/* ── Guest-only landing content ─────────────────────────────────── */}
      {isGuest && (
        <>
          <ProblemSolution />
          <Features />
          <UseCases />
          <StatsBar />
          <ReviewsMarquee />
          <FaqSection />
          <GuestCtaBanner />
        </>
      )}

      {/* Separator between tools and pricing for logged-in users */}
      {!isGuest && (
        <div className="max-w-lg mx-auto w-full px-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
            <span className="text-[10px] font-black uppercase tracking-widest
                             text-slate-300 dark:text-slate-600">More</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      )}

      {/* Pricing */}
      <section className="px-4 pb-12 max-w-2xl mx-auto w-full">
        <button
          onClick={() => setShowPricing((v) => !v)}
          className="w-full flex items-center justify-between py-3 px-4 bg-white dark:bg-slate-800
                     rounded-2xl border border-slate-100 dark:border-slate-700
                     shadow-sm hover:border-amber-200 transition-colors mb-2"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⭐</span>
            <div className="text-left">
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">Plans &amp; Pricing</p>
              <p className="text-[10px] text-slate-400">Free · Pro $4.99/mo · Fleet $19.99/mo</p>
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showPricing ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true"
          >
            <path d="M 4 6l4 4 4-4" />
          </svg>
        </button>
        {showPricing && <PricingSection />}
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800
                         bg-white dark:bg-slate-900 py-8 pb-24 px-4 text-center space-y-3">
        <p className="font-black text-slate-700 dark:text-slate-200">
          GasCap<sup className="text-amber-500 text-[10px] font-bold">™</sup>
        </p>
        <p className="text-xs text-slate-400">Gas Capacity — Know before you go.</p>
        <p className="text-[10px] text-slate-500">© {new Date().getFullYear()} GasCap™ — All rights reserved.</p>

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
        <p className="text-[10px] text-slate-500">
          Share your digital business card with anyone, anywhere.
        </p>

        {/* Legal links */}
        <div className="flex items-center justify-center gap-4 pt-1">
          <a href="/help"    className="text-[11px] text-slate-500 hover:text-amber-500 transition-colors">Help &amp; Support</a>
          <span className="text-slate-400">·</span>
          <a href="/terms"   className="text-[11px] text-slate-500 hover:text-amber-500 transition-colors">Terms of Service</a>
          <span className="text-slate-400">·</span>
          <a href="/privacy" className="text-[11px] text-slate-500 hover:text-amber-500 transition-colors">Privacy Policy</a>
        </div>
      </footer>
    </main>
  );
}
