'use client';

/**
 * MobileEngagementRow — compact side-by-side streak + giveaway cards for mobile.
 *
 * Replaces the two stacked full-width cards (StreakCounter + GiveawayNudge) on
 * mobile so the Fill-Up Calculator sits closer to the top. Desktop is unchanged —
 * it shows these in the header via HeroEngagementPanel. (`lg:hidden` here.)
 *
 * Reuses useEntryCountUp so the entry count still ticks up + flashes when the
 * daily gift box is opened.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useTranslation }      from '@/contexts/LanguageContext';
import { useEntryCountUp }     from '@/hooks/useEntryCountUp';

interface EntryData { entryCount: number; eligible: boolean; alwaysEligible: boolean; }

export default function MobileEngagementRow() {
  const { data: session } = useSession();
  const { t } = useTranslation();

  const [streak,  setStreak]  = useState<number | null>(null);
  const [entries, setEntries] = useState<EntryData | null>(null);

  const isProTrial = (session?.user as { isProTrial?: boolean })?.isProTrial ?? false;

  useEffect(() => {
    if (!session?.user) return;
    const localDate = new Date().toLocaleDateString('en-CA');
    fetch('/api/activity', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'visit', localDate }),
    })
      .then((r) => (r.ok ? r.json() as Promise<{ streak: number }> : Promise.reject()))
      .then((d) => setStreak(d.streak ?? 0))
      .catch(() => setStreak(0));

    fetch('/api/user/giveaway-entries')
      .then((r) => r.json())
      .then((d: EntryData) => setEntries(d))
      .catch(() => {});
  }, [session]);

  const { count: liveCount, flash } = useEntryCountUp(entries?.entryCount ?? null);

  if (!session?.user) return null;

  const hasStreak  = streak !== null && streak >= 2;
  const canEnter   = entries ? (entries.eligible || entries.alwaysEligible || isProTrial) : false;
  const entryCount = liveCount ?? entries?.entryCount ?? 0;
  const hasEntries = canEnter && entryCount > 0;

  return (
    <div className="lg:hidden flex gap-2 px-4 pt-3 pb-1 max-w-lg mx-auto w-full">

      {/* ── Streak ── */}
      <div className="flex-1 basis-0 min-w-0 bg-navy-700 rounded-2xl px-3 py-2.5 flex items-center gap-2">
        <span className="text-lg flex-shrink-0" aria-hidden="true">⚡</span>
        <div className="flex-1 min-w-0">
          {streak === null ? (
            <div className="h-3 bg-white/10 rounded animate-pulse w-16" />
          ) : hasStreak ? (
            <p className="text-amber-400 text-[12px] font-black leading-tight">{t.streak.active(streak)}</p>
          ) : (
            <p className="text-white text-[12px] font-black leading-tight">{t.streak.start}</p>
          )}
        </div>
      </div>

      {/* ── Giveaway ── */}
      <Link
        href="/giveaway"
        aria-label={`${entryCount} giveaway entries. View the monthly drawing.`}
        className={`flex-1 basis-0 min-w-0 rounded-2xl px-3 py-2.5 flex items-center gap-2 transition-all ${
          hasEntries ? 'bg-gradient-to-r from-amber-500 to-[#FA7109]' : 'bg-navy-700'
        } ${flash ? 'ring-2 ring-yellow-300 scale-[1.03]' : ''}`}
      >
        <span className="text-lg flex-shrink-0" aria-hidden="true">🎟️</span>
        <div className="flex-1 min-w-0">
          {entries === null ? (
            <div className="h-3 bg-white/10 rounded animate-pulse w-16" />
          ) : hasEntries ? (
            <p className="text-white text-[12px] font-black leading-tight">
              <span className={`inline-block transition-transform duration-300 ${flash ? 'scale-125 text-yellow-100' : ''}`}>
                {entryCount.toLocaleString()}
              </span>{' '}
              {entryCount === 1 ? 'entry' : 'entries'}
            </p>
          ) : canEnter ? (
            <p className="text-white text-[12px] font-black leading-tight">Earn entries</p>
          ) : (
            <p className="text-white text-[12px] font-black leading-tight">$25 Giveaway</p>
          )}
        </div>
      </Link>

    </div>
  );
}
