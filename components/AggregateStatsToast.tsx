'use client';

/**
 * AggregateStatsToast
 * Light social-proof toast showing anonymized, aggregate community activity
 * (no names, no per-user data) — e.g. "1,240 fill-ups logged this week."
 * Shown once per day per device, for signed-in users only, staggered a few
 * seconds after mount so it doesn't collide with GiveawayEntryToast.
 */

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';

const STORAGE_KEY = 'gascap_stats_toast';
const SHOW_DELAY_MS = 6000;  // stagger after GiveawayEntryToast
const SHOW_MS        = 9000;
const EXIT_MS         = 350;

interface AggregateStats {
  fillupsThisWeek: number;
  priceReportsThisWeek: number;
  dollarsTrackedThisMonth: number;
}

function pickMessage(s: AggregateStats): string | null {
  const candidates: string[] = [];
  if (s.fillupsThisWeek > 0) {
    candidates.push(`⛽ ${s.fillupsThisWeek.toLocaleString()} fill-ups logged by GasCap™ drivers this week.`);
  }
  if (s.priceReportsThisWeek > 0) {
    candidates.push(`📍 ${s.priceReportsThisWeek.toLocaleString()} local price reports shared by drivers this week.`);
  }
  if (s.dollarsTrackedThisMonth > 0) {
    candidates.push(`💰 $${s.dollarsTrackedThisMonth.toLocaleString()} in fuel tracked by GasCap™ users this month.`);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export default function AggregateStatsToast() {
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!session) return;

    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(STORAGE_KEY) === today) return;

    const showTimer = setTimeout(() => {
      fetch('/api/stats/aggregate')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((s: AggregateStats) => {
          const msg = pickMessage(s);
          if (!msg) return;
          setMessage(msg);
          localStorage.setItem(STORAGE_KEY, today);
        })
        .catch(() => {});
    }, SHOW_DELAY_MS);

    return () => clearTimeout(showTimer);
  }, [session]);

  // Auto-dismiss
  useEffect(() => {
    if (!message) return;
    const dismissTimer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => setMessage(null), EXIT_MS);
    }, SHOW_MS);
    return () => clearTimeout(dismissTimer);
  }, [message]);

  function dismiss() {
    setExiting(true);
    setTimeout(() => setMessage(null), EXIT_MS);
  }

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={dismiss}
      className={[
        'fixed bottom-24 left-1/2 z-[9999]', // offset from GiveawayEntryToast (bottom-8) to avoid stacking
        'flex items-center gap-3',
        'max-w-[90vw] w-max rounded-2xl px-5 py-3.5',
        'bg-navy-700 text-white shadow-2xl',
        'text-sm font-semibold leading-snug',
        'cursor-pointer select-none',
        exiting ? 'animate-toast-exit' : 'animate-toast-enter',
      ].join(' ')}
    >
      <span className="flex-1">{message}</span>
      <span
        className="flex-shrink-0 text-white/40 hover:text-white/80 transition-colors text-xs ml-1"
        aria-hidden="true"
      >
        ✕
      </span>
    </div>
  );
}
