'use client';

/**
 * GiveawayNudge — compact strip that surfaces the monthly giveaway.
 *
 * Sits below the streak counter on the home page. Fetches the user's current
 * entry count from /api/user/giveaway-entries and renders one of three states:
 *
 *  1. Eligible + entries  → entry count + drawing date (+ urgency if ≤7 days)
 *  2. Eligible + 0 entries → "use the calculator to earn entries" nudge
 *  3. Not eligible (free)  → upgrade pitch with entry preview
 *
 * Clicking anywhere navigates to /giveaway.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession }         from 'next-auth/react';

// ── Types ──────────────────────────────────────────────────────────────────

interface EntryData {
  entryCount:    number;
  eligible:      boolean;
  alwaysEligible: boolean;
  month:         string;
}

// ── Date helpers ───────────────────────────────────────────────────────────

/** 5th of next month — the actual drawing date — e.g. "Jun 5" */
function drawDateLabel(): string {
  const now   = new Date();
  const fifth = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  return fifth.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Full days remaining until the 5th of next month at midnight */
function daysUntilDraw(): number {
  const now   = new Date();
  const fifth = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  fifth.setHours(23, 59, 59, 999);
  return Math.max(0, Math.ceil((fifth.getTime() - now.getTime()) / 86_400_000));
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GiveawayNudge() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<EntryData | null>(null);
  const [loading, setLoading] = useState(true);

  // Pro-trial users are effectively eligible even if plan is still "free"
  const isProTrial = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/user/giveaway-entries')
      .then((r) => r.json())
      .then((d: EntryData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [session]);

  // Don't render until we have data
  if (!session?.user || loading || !data) return null;

  const drawDate    = drawDateLabel();
  const daysLeft    = daysUntilDraw();
  const isUrgent    = daysLeft <= 7;
  const canEnter    = data.eligible || data.alwaysEligible || isProTrial;
  const entryCount  = data.entryCount;

  // ── State 3: Free user — upgrade pitch ──────────────────────────────────
  if (!canEnter) {
    return (
      <Link
        href="/giveaway"
        className="group flex items-center gap-3 mx-4 lg:mx-0 mb-3
                   bg-[#1E2D4A] hover:bg-[#253d5e] transition-colors
                   rounded-2xl px-4 py-3"
        aria-label="Learn about the monthly giveaway"
      >
        <span className="text-xl flex-shrink-0" aria-hidden="true">🎟️</span>

        <div className="flex-1 min-w-0">
          <p className="text-white text-[13px] font-black leading-tight">
            Monthly $100 Giveaway
          </p>
          <p className="text-white/50 text-[11px] mt-0.5 leading-snug">
            {entryCount > 0
              ? `You've earned ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} — upgrade to Pro to enter`
              : 'Upgrade to Pro and earn entries with every calculation'}
          </p>
        </div>

        <svg viewBox="0 0 12 12" className="w-4 h-4 flex-shrink-0 text-white/30
                                            group-hover:text-white/60 transition-colors"
             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
             aria-hidden="true">
          <path d="M2 6h8M6 2l4 4-4 4"/>
        </svg>
      </Link>
    );
  }

  // ── State 2: Eligible but 0 entries yet ─────────────────────────────────
  if (entryCount === 0) {
    return (
      <Link
        href="/giveaway"
        className="group flex items-center gap-3 mx-4 lg:mx-0 mb-3
                   bg-amber-50 border border-amber-200 hover:border-amber-300
                   transition-colors rounded-2xl px-4 py-3"
        aria-label="View the monthly giveaway"
      >
        <span className="text-xl flex-shrink-0" aria-hidden="true">🎟️</span>

        <div className="flex-1 min-w-0">
          <p className="text-amber-900 text-[13px] font-black leading-tight">
            Monthly $100 Drawing · {drawDate}
          </p>
          <p className="text-amber-700/70 text-[11px] mt-0.5">
            Use the calculator today to earn your first entries
          </p>
        </div>

        <svg viewBox="0 0 12 12" className="w-4 h-4 flex-shrink-0 text-amber-400
                                            group-hover:text-amber-600 transition-colors"
             fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
             aria-hidden="true">
          <path d="M2 6h8M6 2l4 4-4 4"/>
        </svg>
      </Link>
    );
  }

  // ── State 1: Eligible with entries ──────────────────────────────────────
  return (
    <Link
      href="/giveaway"
      className="group flex items-center gap-3 mx-4 lg:mx-0 mb-3
                 bg-gradient-to-r from-amber-500 to-[#FA7109]
                 hover:from-amber-600 hover:to-[#e06508]
                 transition-colors rounded-2xl px-4 py-3 shadow-sm"
      aria-label={`You have ${entryCount} giveaway entries. View the monthly drawing.`}
    >
      <span className="text-xl flex-shrink-0" aria-hidden="true">🎟️</span>

      <div className="flex-1 min-w-0">
        <p className="text-white text-[13px] font-black leading-tight">
          <span className="text-lg">{entryCount.toLocaleString()}</span>
          {' '}
          {entryCount === 1 ? 'entry' : 'entries'} this month
        </p>
        <p className="text-white/80 text-[11px] mt-0.5">
          Drawing {drawDate}
          {isUrgent && (
            <span className="ml-1.5 bg-white/20 text-white text-[10px]
                             font-bold px-1.5 py-0.5 rounded-full">
              {daysLeft === 0 ? 'Today!' : `${daysLeft}d left`}
            </span>
          )}
        </p>
      </div>

      <svg viewBox="0 0 12 12" className="w-4 h-4 flex-shrink-0 text-white/60
                                          group-hover:text-white transition-colors"
           fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
           aria-hidden="true">
        <path d="M2 6h8M6 2l4 4-4 4"/>
      </svg>
    </Link>
  );
}
