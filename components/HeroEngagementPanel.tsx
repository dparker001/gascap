'use client';

/**
 * HeroEngagementPanel — compact streak + giveaway cards for the header center.
 *
 * Desktop-only (`hidden lg:flex`). Fills the empty center column of the header
 * tagline row so the streak counter and giveaway nudge are always visible above
 * the fold without occupying space in the left content column.
 *
 * The mobile layout is unchanged — StreakCounter and GiveawayNudge continue to
 * render normally in the left column on sm/md breakpoints.
 *
 * Data strategy: POST /api/activity (idempotent — same-day dedup on server) and
 * GET /api/user/giveaway-entries. Both calls match what StreakCounter and
 * GiveawayNudge do individually.
 */

import Link       from 'next/link';
import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useEntryCountUp }     from '@/hooks/useEntryCountUp';

interface StreakData { streak: number; }
interface EntryData  { entryCount: number; eligible: boolean; alwaysEligible: boolean; }

/** 5th of next month — drawing date — "Jun 5" */
function drawDate(): string {
  const now   = new Date();
  const fifth = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return fifth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HeroEngagementPanel() {
  const { data: session } = useSession();

  const [streak,  setStreak]  = useState<number | null>(null);
  const [entries, setEntries] = useState<EntryData | null>(null);

  const isProTrial = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;

  useEffect(() => {
    if (!session?.user) return;

    const localDate = new Date().toLocaleDateString('en-CA');
    fetch('/api/activity', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'visit', localDate }),
    })
      .then(r => r.ok ? r.json() as Promise<StreakData> : Promise.reject())
      .then(d => setStreak(d.streak ?? 0))
      .catch(() => setStreak(0));

    fetch('/api/user/giveaway-entries')
      .then(r => r.json())
      .then((d: EntryData) => setEntries(d))
      .catch(() => {});
  }, [session]);

  // Animated entry count — ticks up when the daily gift box is opened.
  const { count: liveCount, flash } = useEntryCountUp(entries?.entryCount ?? null);

  // Only renders on desktop — if no session, nothing to show
  if (!session?.user) return null;

  const canEnter   = entries ? (entries.eligible || entries.alwaysEligible || isProTrial) : false;
  const entryCount = liveCount ?? entries?.entryCount ?? 0;
  const hasStreak  = streak !== null && streak >= 2;
  const draw       = drawDate();

  return (
    <div className="hidden lg:flex flex-row gap-2 flex-1 max-w-lg mx-6">

      {/* ── Streak card ───────────────────────────────────────────────────── */}
      <div className="flex-1 basis-0 min-w-0 bg-white/10 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
        <span className="text-lg flex-shrink-0" aria-hidden="true">⚡</span>

        <div className="flex-1 min-w-0">
          {streak === null ? (
            <div className="h-3 bg-white/10 rounded animate-pulse w-20 mb-1" />
          ) : hasStreak ? (
            <p className="text-amber-400 text-xs font-black leading-none">
              {streak}-day streak! 🔥
            </p>
          ) : (
            <p className="text-white/60 text-xs font-semibold leading-none">
              Start your streak today
            </p>
          )}
          <p className="text-white/35 text-[10px] mt-0.5">Open daily to keep it going</p>
        </div>

        {streak !== null && (
          <div className="flex-shrink-0 bg-white/15 rounded-lg px-2 py-1 text-center min-w-[36px]">
            <p className="text-white font-black text-sm leading-none">{streak}</p>
            <p className="text-white/50 text-[8px] font-bold uppercase tracking-wide">days</p>
          </div>
        )}
      </div>

      {/* ── Giveaway card ─────────────────────────────────────────────────── */}
      <Link
        href="/giveaway"
        aria-label={`${entryCount} giveaway entries. View monthly drawing.`}
        className={[
          'flex-1 basis-0 min-w-0 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 transition-all group',
          canEnter && entryCount > 0
            ? 'bg-gradient-to-r from-amber-500 to-[#FA7109] hover:from-amber-600 hover:to-[#e06508]'
            : 'bg-white/10 hover:bg-white/15',
          flash ? 'ring-2 ring-yellow-300 scale-[1.03]' : '',
        ].join(' ')}
      >
        <span className="text-lg flex-shrink-0" aria-hidden="true">🎟️</span>

        <div className="flex-1 min-w-0">
          {entries === null ? (
            <div className="h-3 bg-white/10 rounded animate-pulse w-24 mb-1" />
          ) : canEnter && entryCount > 0 ? (
            <p className="text-white text-xs font-black leading-none">
              <span className={`text-sm inline-block transition-transform duration-300 ${flash ? 'scale-125 text-yellow-100' : ''}`}>{entryCount.toLocaleString()}</span>{' '}
              {entryCount === 1 ? 'entry' : 'entries'} this month
            </p>
          ) : canEnter ? (
            <p className="text-white/80 text-xs font-black leading-none">
              Earn entries with the calculator
            </p>
          ) : (
            <p className="text-white/80 text-xs font-black leading-none">
              Monthly $25 Giveaway
            </p>
          )}
          <p className="text-white/50 text-[10px] mt-0.5">Drawing {draw}</p>
        </div>

        <svg viewBox="0 0 12 12"
             className="w-3 h-3 flex-shrink-0 text-white/30 group-hover:text-white/70 transition-colors"
             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
             aria-hidden="true">
          <path d="M2 6h8M6 2l4 4-4 4"/>
        </svg>
      </Link>

    </div>
  );
}
