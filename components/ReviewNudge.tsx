'use client';

/**
 * ReviewNudge — asks engaged native-app users to rate GasCap on the App Store /
 * Play Store. App Store ratings are the #1 ASO lever (social proof → installs) and
 * the app currently has zero, so this seeds them.
 *
 * Targets ENGAGED users, not just paying ones (free users leave great reviews too):
 * shown only on native, to signed-in users who have opened the app on ≥2 separate
 * days (a real "came back" signal), once, after a short delay so it never interrupts.
 *
 * Two-step "love it / not yet" fork protects the rating: happy users go to the store,
 * unhappy users are routed to feedback instead.
 *
 * No rebuild: links to the public write-review URL (opens the store app from the
 * webview) rather than the native StoreKit prompt (which would need a plugin).
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useNativePlatform } from '@/hooks/useIsNative';

const DONE_KEY = 'gc_review_nudge_done';
const DAYS_KEY = 'gc_open_days';
const MIN_DAYS = 2;

const REVIEW_URL: Record<string, string> = {
  ios:     'https://apps.apple.com/app/id6761315915?action=write-review',
  android: 'https://play.google.com/store/apps/details?id=app.gascap.mobile',
};

type Phase = 'hidden' | 'ask' | 'love' | 'sad';

export default function ReviewNudge() {
  const { status } = useSession();
  const platform = useNativePlatform();
  const [phase, setPhase] = useState<Phase>('hidden');

  useEffect(() => {
    if (!platform || status !== 'authenticated') return;
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
      const days: string[] = JSON.parse(localStorage.getItem(DAYS_KEY) || '[]');
      const today = new Date().toISOString().slice(0, 10);
      if (!days.includes(today)) {
        days.push(today);
        localStorage.setItem(DAYS_KEY, JSON.stringify(days.slice(-14)));
      }
      if (days.length < MIN_DAYS) return;
    } catch { return; }
    const t = setTimeout(() => setPhase('ask'), 4000); // let them settle in first
    return () => clearTimeout(t);
  }, [platform, status]);

  function finish() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
    setPhase('hidden');
  }

  function openStore() {
    const url = REVIEW_URL[platform ?? 'ios'] ?? REVIEW_URL.ios;
    try { window.open(url, '_blank'); } catch { /* ignore */ }
    finish();
  }

  if (phase === 'hidden') return null;

  return (
    <div
      className="fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 shadow-lg
                      border border-slate-200 dark:border-slate-700 p-4">
        {phase === 'ask' && (
          <>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Enjoying GasCap?</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setPhase('love')}
                className="flex-1 py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-bold active:opacity-90">
                Love it 😄
              </button>
              <button onClick={() => setPhase('sad')}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-sm font-semibold">
                Not yet
              </button>
            </div>
          </>
        )}

        {phase === 'love' && (
          <>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Awesome — would you rate us? ⭐</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              A quick rating helps other drivers find GasCap. Takes 10 seconds.
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={openStore}
                className="flex-1 py-2.5 rounded-xl bg-brand-orange text-white text-sm font-bold active:opacity-90">
                Rate GasCap
              </button>
              <button onClick={finish}
                className="px-4 py-2.5 rounded-xl text-slate-400 text-sm font-semibold">Maybe later</button>
            </div>
          </>
        )}

        {phase === 'sad' && (
          <>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Sorry to hear that 🙏</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              Tell us what would make GasCap better — we read every message.
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/contact" onClick={finish}
                className="flex-1 text-center py-2.5 rounded-xl bg-[#005F4A] text-white text-sm font-bold active:opacity-90">
                Send feedback
              </Link>
              <button onClick={finish}
                className="px-4 py-2.5 rounded-xl text-slate-400 text-sm font-semibold">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
