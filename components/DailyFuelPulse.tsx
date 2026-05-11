'use client';

/**
 * DailyFuelPulse — home-screen widget
 *
 * Fetches /api/gas-price/pulse (cached 6 h server-side) and renders:
 *  • Current US national average + week-over-week trend arrow + delta
 *  • Today's rotating fuel-saving tip
 *  • For Pro/Fleet users with no price alert set: one-click nudge to /settings
 *
 * Dismissed state is stored in sessionStorage so it hides once per session
 * without annoying users who deliberately close it.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import Link                    from 'next/link';
import { useTranslation }      from '@/contexts/LanguageContext';

interface PulseData {
  available:  boolean;
  current?:   number;
  previous?:  number | null;
  delta?:     number | null;
  trend?:     'up' | 'down' | 'flat' | 'unknown';
  tip?:       string;
  period?:    string | null;
  noApiKey?:  boolean;
}

const DISMISSED_KEY = 'gascap_pulse_dismissed';

export default function DailyFuelPulse() {
  const { data: session } = useSession();
  const { t } = useTranslation();
  const [pulse,     setPulse]     = useState<PulseData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [hasAlert,  setHasAlert]  = useState<boolean | null>(null); // null = unknown

  const plan   = (session?.user as { plan?: string })?.plan ?? 'free';
  const isPro  = plan === 'pro' || plan === 'fleet';

  // Check sessionStorage dismissal on mount
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISSED_KEY) === '1') setDismissed(true);
    } catch {}
  }, []);

  // Fetch pulse data
  useEffect(() => {
    fetch('/api/gas-price/pulse')
      .then((r) => r.json())
      .then((d: PulseData) => setPulse(d))
      .catch(() => setPulse(null))
      .finally(() => setLoading(false));
  }, []);

  // For Pro users: check if a price alert threshold is already set
  useEffect(() => {
    if (!session || !isPro) { setHasAlert(true); return; } // guests / free: suppress nudge
    fetch('/api/user/price-alert')
      .then((r) => r.json())
      .then((d: { threshold?: number | null }) => setHasAlert(!!d.threshold))
      .catch(() => setHasAlert(true)); // on error, don't show nudge
  }, [session, isPro]);

  function dismiss() {
    try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch {}
    setDismissed(true);
  }

  // Don't render anything while data is loading or if dismissed
  if (dismissed) return null;

  // Loading skeleton
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-lg lg:max-w-none px-4 lg:px-0 mt-3 mb-1">
        <div className="animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800 h-[88px]" />
      </div>
    );
  }

  // No data (API key missing or fetch failed) — silently hide
  if (!pulse || !pulse.available) return null;

  const { current, delta, trend, tip } = pulse;

  // Trend display
  const trendConfig: Record<string, { arrow: string; color: string; label: string }> = {
    up:      { arrow: '↑', color: 'text-rose-500',    label: t.dailyFuelPulse.upFromLastWeek   },
    down:    { arrow: '↓', color: 'text-emerald-500', label: t.dailyFuelPulse.downFromLastWeek },
    flat:    { arrow: '→', color: 'text-slate-400',   label: t.dailyFuelPulse.sameAsLastWeek   },
    unknown: { arrow: '—', color: 'text-slate-400',   label: ''                                },
  };
  const tc = trendConfig[trend ?? 'unknown'];

  const showAlertNudge = isPro && hasAlert === false;

  return (
    <div
      className="mx-auto w-full max-w-lg lg:max-w-none px-4 lg:px-0 mt-3 mb-1"
      role="region"
      aria-label={t.dailyFuelPulse.regionAria}
    >
      <div className="relative rounded-2xl border border-[#1EB68F]/30 bg-gradient-to-br
                      from-[#005F4A]/5 via-white to-[#1EB68F]/5
                      dark:from-[#005F4A]/20 dark:via-slate-900 dark:to-[#1EB68F]/10
                      shadow-sm overflow-hidden">

        {/* Dismiss button */}
        <button
          onClick={dismiss}
          className="absolute top-2.5 right-2.5 text-slate-300 hover:text-slate-500
                     dark:text-slate-600 dark:hover:text-slate-400 transition-colors p-0.5 z-10"
          aria-label={t.dailyFuelPulse.dismissAria}
        >
          <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>

        <div className="px-4 py-3">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base flex-shrink-0" aria-hidden="true">⛽</span>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#005F4A]
                          dark:text-[#1EB68F]">
              {t.dailyFuelPulse.heading}
            </p>
          </div>

          {/* Price + trend row */}
          <div className="flex items-end gap-3 mb-2.5">
            <div>
              <p className="text-2xl font-black text-[#1E2D4A] dark:text-white leading-none">
                ${current?.toFixed(3)}
                <span className="text-sm font-semibold text-slate-400 ml-1">/gal</span>
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">{t.dailyFuelPulse.national}</p>
            </div>

            {trend && trend !== 'unknown' && delta !== null && delta !== undefined && (
              <div className={`flex items-center gap-1 pb-0.5 ${tc.color}`}>
                <span className="text-lg font-black leading-none" aria-hidden="true">{tc.arrow}</span>
                <div>
                  <p className="text-xs font-black leading-none">
                    {Math.abs(delta).toFixed(2)}¢
                  </p>
                  <p className="text-[9px] leading-tight opacity-80">{tc.label}</p>
                </div>
              </div>
            )}
          </div>

          {/* Rotating fuel tip */}
          {tip && (
            <div className="flex items-start gap-2 bg-[#005F4A]/5 dark:bg-[#1EB68F]/10
                            rounded-xl px-3 py-2 mb-2">
              <span className="text-sm flex-shrink-0 mt-0.5" aria-hidden="true">💡</span>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{tip}</p>
            </div>
          )}

          {/* Pro alert nudge */}
          {showAlertNudge && (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 flex-1">
                {t.dailyFuelPulse.alertNudge}
              </p>
              <Link
                href="/settings?tab=alerts"
                className="flex-shrink-0 text-[10px] font-black bg-[#1EB68F] text-white
                           px-2.5 py-1 rounded-lg hover:bg-[#17a07e] transition-colors
                           whitespace-nowrap"
              >
                {t.dailyFuelPulse.setAlert}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
