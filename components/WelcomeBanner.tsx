'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';

// ── Helpers ────────────────────────────────────────────────────────────────

/** localStorage key — per user, so clearing one account doesn't affect another */
function welcomeKey(userId: string) {
  return `gascap_welcome_shown_${userId}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function WelcomeBanner() {
  const { data: session, status } = useSession();
  const { t, locale } = useTranslation();

  const [mounted,       setMounted]       = useState(false);
  const [showWelcome,   setShowWelcome]   = useState(false);   // first-time card
  const [cardDismissed, setCardDismissed] = useState(false);

  const userId        = (session?.user as { id?: string })?.id ?? '';
  const emailVerified = (session?.user as { emailVerified?: boolean })?.emailVerified ?? false;
  const plan          = (session?.user as { plan?: string })?.plan ?? 'free';
  const isProTrial    = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;
  const stripeInterval = (session?.user as { stripeInterval?: string | null })?.stripeInterval ?? null;
  const rawName       = session?.user?.name ?? '';
  const firstName     = rawName.split(' ')[0] || 'there';

  // Time-aware greeting using translations
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t.welcomeBanner.goodMorning;
    if (h < 17) return t.welcomeBanner.goodAfternoon;
    return t.welcomeBanner.goodEvening;
  })();

  const tips = [
    { icon: '⛽', text: t.welcomeBanner.tip1 },
    { icon: '🚗', text: t.welcomeBanner.tip2 },
    { icon: '📋', text: t.welcomeBanner.tip3 },
  ];

  useEffect(() => {
    if (!userId) return;
    setMounted(true);

    // Show the welcome card exactly once — the first time we see an emailVerified session.
    // Skip if FreshSignupBanner already handled this session (avoids double-stacking).
    const freshSignup = (() => { try { return sessionStorage.getItem('gascap_fresh_signup') === '1'; } catch { return false; } })();
    if (emailVerified && !localStorage.getItem(welcomeKey(userId)) && !freshSignup) {
      setShowWelcome(true);
      localStorage.setItem(welcomeKey(userId), '1');
    }
  }, [userId, emailVerified]);

  // Don't render until session is resolved and client is hydrated
  if (status === 'loading' || !session || !mounted) return null;

  const planLabel =
    plan === 'fleet' ? '🚛 Fleet'
    : isProTrial     ? '⭐ Pro Trial'
    : (plan === 'pro' && stripeInterval === 'lifetime') ? '🏅 Pro Lifetime'
    : plan === 'pro' ? '⭐ Pro'
    : null;

  return (
    <section className="px-4 lg:px-0 pt-4 max-w-lg lg:max-w-none mx-auto w-full">

      {/* ── First-time welcome card ── */}
      {showWelcome && !cardDismissed && (
        <div className="mb-3 bg-gradient-to-br from-brand-dark to-[#1a3a5c]
                        rounded-2xl p-4 relative overflow-hidden shadow-sm">

          {/* Decorative arc top-right */}
          <svg className="absolute top-0 right-0 opacity-[0.07] pointer-events-none"
               width="130" height="100" viewBox="0 0 130 100" aria-hidden="true">
            <path d="M 110 95 A 80 80 0 0 0 30 95"
              fill="none" stroke="white" strokeWidth="16" strokeLinecap="round" />
          </svg>

          <div className="relative">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-base font-black text-white leading-tight">
                  {t.welcomeBanner.greeting(firstName)}
                </p>
                <p className="text-white/55 text-[11px] mt-0.5">
                  {t.welcomeBanner.verifiedSub}
                  {planLabel && (
                    <span className="ml-1.5 bg-white/10 text-white/80 text-[10px]
                                     font-bold px-1.5 py-0.5 rounded-full">
                      {planLabel}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setCardDismissed(true)}
                className="flex-shrink-0 text-white/30 hover:text-white/70
                           transition-colors mt-0.5 p-0.5"
                aria-label={t.welcomeBanner.dismissAria}
              >
                <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2l8 8M10 2L2 10" />
                </svg>
              </button>
            </div>

            {/* Quick-start tips */}
            <ul className="space-y-1.5 mb-3.5">
              {tips.map(({ icon, text }) => (
                <li key={icon} className="flex items-start gap-2 text-[11px] text-white/65 leading-snug">
                  <span className="flex-shrink-0 mt-px" aria-hidden="true">{icon}</span>
                  {text}
                </li>
              ))}
            </ul>

            <button
              onClick={() => setCardDismissed(true)}
              className="text-[11px] font-black text-brand-orange hover:text-[#FF9A1A] transition-colors"
            >
              {t.welcomeBanner.gotIt}
            </button>
          </div>
        </div>
      )}

      {/* ── Time-aware greeting line (always visible, even after card is dismissed) ── */}
      <div className="flex items-center gap-2 px-0.5 pb-1">
        <p className="text-[13px] font-bold text-slate-500 dark:text-slate-400">
          {greeting},{' '}
          <span className="text-slate-700 dark:text-slate-200 font-black">{firstName}</span>
          <span className="text-slate-400 dark:text-slate-500"> ·</span>{' '}
          <span className="text-slate-400 dark:text-slate-500 font-normal">
            {new Date().toLocaleDateString(locale === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
        </p>
      </div>

    </section>
  );
}
