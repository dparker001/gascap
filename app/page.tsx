'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession }                    from 'next-auth/react';
import { useSearchParams, useRouter }    from 'next/navigation';
import { useTranslation }      from '@/contexts/LanguageContext';
import AdSenseBanner           from '@/components/AdSenseBanner';
import Header                  from '@/components/Header';
import CalculatorTabs          from '@/components/CalculatorTabs';
import ToolsPanel              from '@/components/ToolsPanel';
import PricingSection          from '@/components/PricingSection';
import EmailVerificationBanner from '@/components/EmailVerificationBanner';
import TrialExpiryBanner      from '@/components/TrialExpiryBanner';
import AnnouncementToast      from '@/components/AnnouncementToast';
import ReviewsMarquee          from '@/components/ReviewsMarquee';
import OnboardingModal         from '@/components/OnboardingModal';
import SetupChecklist          from '@/components/SetupChecklist';
import GasPriceAlertBanner     from '@/components/GasPriceAlertBanner';
import StreakCounter           from '@/components/StreakCounter';
import CampaignTracker         from '@/components/CampaignTracker';
import FeaturedStation         from '@/components/FeaturedStation';
import EngagementNudge        from '@/components/EngagementNudge';

// ── JSON-LD Schema Markup ────────────────────────────────────────────────────

function SchemaMarkup() {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'How does GasCap™ calculate how much gas I need?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'GasCap™ uses your current fuel level, your vehicle\'s tank size, and your target fill level to calculate the exact number of gallons needed. It then multiplies that by your local gas price — fetched automatically using live EIA data — to show you the exact cost before you reach the pump.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is GasCap™ free to use?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes — GasCap™ is free forever with no credit card required. The free plan includes the full fuel calculator, live gas prices, and offline access. Pro ($4.99/mo) and Fleet ($19.99/mo) plans add fill-up history, MPG tracking, AI advisor, PDF export, and more.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need to download an app from the App Store?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No app store needed. GasCap™ is a Progressive Web App (PWA) — just visit gascap.app on your phone and tap "Add to Home Screen" to install it like a native app. It works on iPhone, Android, and any browser.',
        },
      },
      {
        '@type': 'Question',
        name: 'What is Rental Car Return Mode?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Rental Car Return Mode is a GasCap™ feature that helps you avoid expensive refueling fees at car rental drop-off. Rental companies charge up to $12/gallon if you return with less than a full tank. Enter the rental company\'s rate and GasCap™ shows you exactly how many gallons to buy at the pump — and exactly how much you\'ll save.',
        },
      },
      {
        '@type': 'Question',
        name: 'How accurate are the gas prices?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'GasCap™ pulls weekly gas price data directly from the U.S. Energy Information Administration (EIA) — the same government source used by major news outlets. Prices are localized to your state using your device\'s GPS.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does GasCap™ work offline?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Once installed as a PWA, the core calculator works completely offline using your last-known gas price and saved vehicles. Live gas price lookup and AI features require an internet connection.',
        },
      },
      {
        '@type': 'Question',
        name: 'What vehicles does GasCap™ support?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'GasCap™ supports any gasoline or diesel vehicle. You can manually enter your tank size, or choose from hundreds of presets including economy cars, midsize sedans, SUVs, trucks, minivans, and rental car classes. Pro users can save up to 3 vehicles; Fleet users can save unlimited vehicles.',
        },
      },
      {
        '@type': 'Question',
        name: 'How is GasCap™ different from a road trip fuel cost calculator?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Road trip calculators estimate fuel cost for a journey based on distance. GasCap™ solves a different problem: it tells you exactly how much it will cost to fill your tank right now, based on your current fuel level and local prices. It\'s the tool you use at the pump — not while planning a route.',
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
  const { t } = useTranslation();
  const pills = [
    { icon: '⛽', label: t.hero.pill_prices  },
    { icon: '🚗', label: t.hero.pill_rental  },
    { icon: '📊', label: t.hero.pill_mpg     },
    { icon: '🤖', label: t.hero.pill_ai      },
    { icon: '🏎️', label: t.hero.pill_garage  },
    { icon: '📋', label: t.hero.pill_fillups },
  ];
  return (
    <section className="relative w-full overflow-hidden">
      {/* ── Background video ──────────────────────────────────────────────── */}
      <video
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/videos/hero-bg.mp4" type="video/mp4" />
      </video>

      {/* ── Semi-transparent overlay so text stays readable ───────────────── */}
      <div className="absolute inset-0 bg-slate-900/65" />

      {/* ── Hero content ─────────────────────────────────────────────────── */}
      <div className="relative z-10 px-4 pt-6 pb-6 max-w-lg mx-auto w-full text-center">
        {/* Headline */}
        <h1 className="text-3xl font-black text-white leading-tight mb-3 drop-shadow-lg">
          {t.hero.headline}{' '}
          <span className="text-brand-orange">{t.hero.headlineAccent}</span>
        </h1>

        {/* Subheadline */}
        <p className="text-sm text-slate-300 leading-relaxed mb-4 max-w-sm mx-auto drop-shadow">
          {t.hero.sub}
        </p>

        {/* Trust pills */}
        <div className="flex items-center justify-center gap-3 flex-wrap mb-4">
          {pills.map(({ icon, label }) => (
            <span key={label}
              className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur-sm
                         border border-white/20
                         rounded-full px-3 py-1 text-[11px] font-semibold text-white/90">
              <span>{icon}</span>{label}
            </span>
          ))}
        </div>

        {/* 30-day Pro offer strip — orange background CTA */}
        <a href="/signup"
           className="block w-full max-w-sm mx-auto bg-orange-500 hover:bg-orange-600
                      transition-colors rounded-2xl px-4 py-3
                      flex items-center gap-3">
          <span className="text-xl flex-shrink-0">🎁</span>
          <div>
            <p className="text-sm font-bold text-white leading-tight">{t.hero.offerStrip}</p>
            <p className="text-orange-100 text-[10px] mt-0.5">{t.hero.offerStripSub}</p>
          </div>
        </a>
      </div>
    </section>
  );
}

// ── Problem / Solution strip ─────────────────────────────────────────────────

function ProblemSolution() {
  const { t } = useTranslation();
  const icons = ['💳', '🚗', '📊'];
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100
                      dark:border-slate-700 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-sm font-black text-slate-700 dark:text-slate-200">
            {t.problem.heading}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {t.problem.sub}
          </p>
        </div>

        {/* Rows */}
        {t.problem.rows.map(({ before, after }, i) => (
          <div key={i} className="px-5 py-4 flex items-start gap-4
                                  border-b border-slate-50 dark:border-slate-700/50 last:border-0">
            <span className="text-xl flex-shrink-0 mt-0.5">{icons[i]}</span>
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

const FEATURE_ICONS = ['⛽', '📍', '📡', '📊', '🤖', '📄'];

function Features() {
  const { t } = useTranslation();
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">⚡</span>
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          {t.features.heading}
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* Feature grid 2×3 */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {t.features.items.map(({ title, body, badge }, i) => {
          const isPro      = badge === 'Pro';
          const isFreeAcct = badge === 'Free account';
          return (
            <div key={title}
              className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm
                         border border-slate-100 dark:border-slate-700 flex flex-col">
              <div className="flex items-start justify-between gap-1 mb-2">
                <span className="text-2xl">{FEATURE_ICONS[i]}</span>
                {badge && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap
                    ${isPro      ? 'bg-amber-100 text-amber-700'
                    : isFreeAcct ? 'bg-blue-50 text-blue-600'
                    :              'bg-emerald-50 text-emerald-700'}`}>
                    {isPro ? '⭐ Pro' : isFreeAcct ? '🔑 Free acct' : '✓ Free'}
                  </span>
                )}
              </div>
              <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 leading-tight">
                {title}
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{body}</p>
            </div>
          );
        })}
      </div>

      {/* Rental car — full width feature card */}
      <div className="bg-blue-700 rounded-2xl p-4 shadow-sm flex items-start gap-3.5">
        <span className="text-3xl flex-shrink-0 mt-0.5" aria-hidden="true">🚗</span>
        <div>
          <h3 className="text-sm font-black text-white leading-tight">
            {t.features.rentalTitle}
          </h3>
          <p className="text-xs text-blue-200 mt-1 leading-relaxed">
            {t.features.rentalBody}
          </p>
          <p className="text-[10px] text-blue-300/70 mt-2 font-semibold">
            {t.features.rentalHint}
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Use cases ────────────────────────────────────────────────────────────────

const USE_CASE_EMOJIS = ['🚘', '✈️', '🗺️', '🚛'];

function UseCases() {
  const { t } = useTranslation();
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">👤</span>
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          {t.useCases.heading}
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {t.useCases.items.map(({ who, what }, i) => (
          <div key={who}
            className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm
                       border border-slate-100 dark:border-slate-700">
            <span className="text-2xl">{USE_CASE_EMOJIS[i]}</span>
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
  const { t } = useTranslation();
  return (
    <section className="px-4 pb-6 max-w-lg mx-auto w-full">
      <div className="bg-brand-dark rounded-2xl px-5 py-4 grid grid-cols-3 gap-4 text-center">
        {t.stats.map(({ value, label }) => (
          <div key={label}>
            <p className="text-lg font-black text-brand-orange">{value}</p>
            <p className="text-[10px] text-white/50 mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── FAQ section (SEO) ────────────────────────────────────────────────────────

function FaqSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="px-4 pb-8 max-w-lg mx-auto w-full">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="text-base">❓</span>
        <h2 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          {t.faq.heading}
        </h2>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="space-y-2">
        {t.faq.items.map((faq, i) => (
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
  const { t } = useTranslation();
  return (
    <section className="px-4 py-6 max-w-lg mx-auto w-full">
      <div className="bg-brand-dark rounded-3xl px-6 py-8 text-center relative overflow-hidden">
        {/* Decorative arc */}
        <svg className="absolute top-0 right-0 opacity-[0.07] pointer-events-none"
             width="180" height="140" viewBox="0 0 180 140" aria-hidden="true">
          <path d="M 150 135 A 125 125 0 0 0 25 135"
            fill="none" stroke="white" strokeWidth="28" strokeLinecap="round" />
        </svg>

        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-3 py-1 mb-4">
            <span className="text-brand-orange text-xs">⭐</span>
            <span className="text-white/80 text-[11px] font-bold">{t.cta.badge}</span>
          </div>
          <h2 className="text-2xl font-black text-white leading-tight mb-2">
            {t.cta.headline.split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </h2>
          <p className="text-white/60 text-sm leading-relaxed mb-6 max-w-[260px] mx-auto">
            {t.cta.sub}
          </p>
          <a
            href="/signup"
            className="inline-block w-full max-w-xs py-3.5 bg-brand-orange hover:bg-[#FF9A1A]
                       text-white text-sm font-black rounded-2xl transition-colors shadow-brand"
          >
            {t.cta.createAccount}
          </a>
          <p className="text-white/30 text-[10px] mt-3">
            {t.cta.alreadyHave}{' '}
            <a href="/signin" className="text-white/50 hover:text-white/80 underline transition-colors">
              {t.cta.signIn}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Email-verified success toast ──────────────────────────────────────────────
// Shown briefly when the user lands on / after clicking their verify link.

function VerifiedSuccessToast() {
  const params  = useSearchParams();
  const router  = useRouter();

  const verified = params.get('verified');
  const errMsg   = params.get('msg') ?? '';
  const isSuccess = verified === 'success';
  const isError   = verified === 'error' || verified === 'invalid';

  const [show, setShow] = useState(isSuccess || isError);

  useEffect(() => {
    if (!show) return;
    // Strip the query params from the URL without a page reload
    router.replace('/', { scroll: false });
    const t = setTimeout(() => setShow(false), isSuccess ? 6000 : 10000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!show) return null;

  if (isError) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm
                      bg-red-600 text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3
                      animate-fade-in">
        <span className="text-lg flex-shrink-0">❌</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black">Verification failed</p>
          <p className="text-xs text-red-100 mt-0.5">
            {decodeURIComponent(errMsg) || 'The link may be invalid or expired. Use the banner below to resend.'}
          </p>
        </div>
        <button onClick={() => setShow(false)} className="flex-shrink-0 text-red-200 hover:text-white" aria-label="Dismiss">✕</button>
      </div>
    );
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm
                    bg-green-600 text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3
                    animate-fade-in">
      <span className="text-lg flex-shrink-0">✅</span>
      <div>
        <p className="text-sm font-black">Email verified!</p>
        <p className="text-xs text-green-100 mt-0.5">You're all set. Welcome to GasCap™.</p>
      </div>
      <button onClick={() => setShow(false)} className="ml-auto text-green-200 hover:text-white" aria-label="Dismiss">✕</button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [showPricing, setShowPricing] = useState(false);
  const { data: session, status } = useSession();
  const { t } = useTranslation();
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

      {/* Email verified toast — shown after clicking the verify link */}
      <Suspense fallback={null}>
        <VerifiedSuccessToast />
      </Suspense>

      {/* QR placard pilot — silently tracks attribution if visitor came from /q/<code> */}
      <CampaignTracker />

      {/* ── SEO Schema (guests only — no point injecting for auth'd users) ── */}
      {isGuest && <SchemaMarkup />}

      {/* Onboarding — shown once to new visitors */}
      {isGuest && <OnboardingModal />}

      {/* Email verification prompt */}
      <EmailVerificationBanner />

      {/* Trial expiry nudge — shown when ≤ 5 days remain on a Pro trial */}
      <TrialExpiryBanner />

      {/* Announcement toasts — driven by data/announcements.json */}
      <AnnouncementToast />

      {/* Gas price drop alert — Pro users */}
      <GasPriceAlertBanner />

      {/* Brand header */}
      <Header />

      {/* ── Guest hero — SEO headline above the calculator ────────────── */}
      {isGuest && <GuestHero />}

      {/* Streak counter — logged-in users only */}
      {session && <StreakCounter />}

      {/* Setup checklist — shown once to new signed-in users until all steps are complete */}
      {session && (
        <section className="px-4 max-w-lg mx-auto w-full">
          <SetupChecklist />
        </section>
      )}

      {/* Calculator */}
      <section id="gascap-calculator" className="flex-1 px-4 pt-5 pb-4 max-w-lg mx-auto w-full">
        <CalculatorTabs />
      </section>

      {/* Guest — save nudge */}
      {isGuest && (
        <section className="px-4 -mt-2 pb-2 max-w-lg mx-auto w-full">
          <div className="bg-brand-dark rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl flex-shrink-0">💾</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-white">{t.saveNudge.heading}</p>
              <p className="text-[10px] text-white/60 mt-0.5">{t.saveNudge.sub}</p>
            </div>
            <a
              href="/signup"
              className="flex-shrink-0 px-3 py-1.5 bg-brand-orange hover:bg-[#FF9A1A]
                         text-white text-xs font-black rounded-xl transition-colors whitespace-nowrap"
            >
              {t.saveNudge.button}
            </a>
          </div>
        </section>
      )}

      {/* AdSense — free + guest users */}
      {(isGuest || userPlan === 'free') && (
        <AdSenseBanner slotId={process.env.NEXT_PUBLIC_ADSENSE_SLOT_ID} />
      )}

      {/* Partner Station — shown when a featured partner is in the user's city */}
      <section className="px-4 pb-3 max-w-lg mx-auto w-full">
        <FeaturedStation />
      </section>

      {/* Engagement nudge — fixed bottom toast, contextual, dismissible */}
      <EngagementNudge />

      {/* Tools & Insights */}
      <section id="gascap-tools" className="px-4 pb-6 max-w-lg mx-auto w-full">
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
                     shadow-sm hover:border-brand-teal/30 transition-colors mb-2"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⭐</span>
            <div className="text-left">
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">{t.pricing.toggleLabel}</p>
              <p className="text-[10px] text-slate-400">{t.pricing.toggleSub}</p>
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
          GasCap<sup className="text-brand-orange text-[10px] font-bold">™</sup>
        </p>
        <p className="text-xs text-slate-400">{t.footer.tagline}</p>
        <p className="text-[10px] text-slate-500">{t.footer.copyright(new Date().getFullYear())}</p>

        {/* VNetCard lead magnet */}
        <a
          href="https://vnetcard.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-full
                     bg-brand-dark hover:bg-[#006B54] transition-colors group"
        >
          <span className="text-[10px] text-white/50 font-medium">{t.footer.poweredBy}</span>
          <span className="text-[11px] font-black text-brand-teal group-hover:text-brand-orange transition-colors">
            VNetCard™
          </span>
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white/30 group-hover:text-white/50 transition-colors"
               fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M2 6h8M6 2l4 4-4 4"/>
          </svg>
        </a>
        <p className="text-[10px] text-slate-500">
          {t.footer.vnetCardDesc}
        </p>

        {/* Legal links */}
        <div className="flex items-center justify-center gap-4 pt-1">
          <a href="/help"    className="text-[11px] text-slate-500 hover:text-brand-orange transition-colors">{t.footer.help}</a>
          <span className="text-slate-400">·</span>
          <a href="/terms"   className="text-[11px] text-slate-500 hover:text-brand-orange transition-colors">{t.footer.terms}</a>
          <span className="text-slate-400">·</span>
          <a href="/privacy" className="text-[11px] text-slate-500 hover:text-brand-orange transition-colors">{t.footer.privacy}</a>
        </div>
      </footer>
    </main>
  );
}
