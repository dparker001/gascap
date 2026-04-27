'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface StreakCredit {
  id:        string;
  milestone: number;
  earnedAt:  string;
  expiresAt: string;
}

interface ActivityResp {
  streak:              number;
  streakMilestonesHit: number[];
  streakCredits:       StreakCredit[];
}

const MILESTONES = [
  { days: 30,  emoji: '⭐', label: '30-Day Streak',  reward: '1 free Pro month' },
  { days: 90,  emoji: '🏆', label: '90-Day Streak',  reward: '1 free Pro month' },
  { days: 180, emoji: '💎', label: '180-Day Streak', reward: '1 free Pro month' },
  { days: 365, emoji: '👑', label: '1-Year Streak',  reward: '1 free Pro month + Legend status' },
];

export default function StreakRewards() {
  const { data: session } = useSession();
  const [streak,       setStreak]       = useState<number>(0);
  const [milestonesHit, setMilestonesHit] = useState<number[]>([]);
  const [credits,      setCredits]      = useState<StreakCredit[]>([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/activity', { credentials: 'include' })
      .then((r) => r.ok ? r.json() as Promise<ActivityResp> : Promise.reject())
      .then((d) => {
        setStreak(d.streak ?? 0);
        setMilestonesHit(d.streakMilestonesHit ?? []);
        setCredits(d.streakCredits ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  if (!session || loading) return null;

  // Next unearned milestone (day-count based)
  const nextMilestone = MILESTONES.find((m) => !milestonesHit.includes(m.days));
  const daysToNext    = nextMilestone ? Math.max(0, nextMilestone.days - streak) : 0;
  const progressPct   = nextMilestone
    ? Math.min(100, Math.round((streak / nextMilestone.days) * 100))
    : 100;

  const allEarned = !nextMilestone;

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 space-y-4">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-black text-navy-700">⚡ Streak Rewards</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Maintain your daily streak to earn free Pro months
          </p>
        </div>
        <div className="bg-amber-500 rounded-xl px-3 py-1.5 text-center min-w-[52px]">
          <p className="text-xl font-black text-white leading-none">{streak}</p>
          <p className="text-[9px] text-white/70 font-bold uppercase tracking-wide mt-0.5">
            {streak === 1 ? 'day' : 'days'}
          </p>
        </div>
      </div>

      {/* Progress bar to next milestone */}
      {nextMilestone && (
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <p className="text-[10px] text-slate-500 font-semibold">
              Progress to {nextMilestone.label}
            </p>
            <p className="text-[10px] font-black text-amber-600">
              {daysToNext === 0
                ? '🎉 Reward ready!'
                : `${daysToNext} day${daysToNext !== 1 ? 's' : ''} to go`}
            </p>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
              }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <p className="text-[9px] text-slate-400">{streak} days</p>
            <p className="text-[9px] text-slate-400">
              {nextMilestone.days} days → {nextMilestone.reward}
            </p>
          </div>
        </div>
      )}

      {allEarned && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
          <p className="text-xs font-black text-amber-700">
            👑 You've hit every streak milestone — legendary!
          </p>
        </div>
      )}

      {/* Milestone timeline */}
      <div className="space-y-2">
        {MILESTONES.map((m) => {
          const hit    = milestonesHit.includes(m.days);
          const isNext = nextMilestone?.days === m.days;
          return (
            <div
              key={m.days}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors',
                hit    ? 'bg-green-50 border-green-100'
                : isNext ? 'bg-amber-50 border-amber-200'
                : 'bg-slate-50 border-slate-100',
              ].join(' ')}
            >
              <span className="text-xl flex-shrink-0">{hit ? '✅' : m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-black leading-tight ${
                  hit    ? 'text-green-700'
                  : isNext ? 'text-amber-700'
                  : 'text-slate-500'
                }`}>
                  {m.label}
                </p>
                <p className={`text-[10px] leading-tight mt-0.5 ${
                  hit ? 'text-green-600' : 'text-slate-400'
                }`}>
                  🎁 {m.reward}
                </p>
              </div>
              {hit && (
                <span className="flex-shrink-0 text-[10px] font-black text-green-700
                                 bg-green-100 rounded-lg px-2 py-0.5">
                  Earned
                </span>
              )}
              {isNext && !hit && (
                <span className="flex-shrink-0 text-[10px] font-black text-amber-700
                                 bg-amber-100 rounded-lg px-2 py-0.5">
                  Next
                </span>
              )}
              {!hit && !isNext && (
                <span className="flex-shrink-0 text-[10px] font-bold text-slate-400">
                  {m.days - streak > 0 ? `${m.days - streak}d away` : 'Locked'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Banked credits CTA */}
      {credits.length > 0 ? (
        <div className="bg-navy-700 rounded-2xl px-4 py-3 space-y-1">
          <p className="text-sm font-black text-amber-400">
            🎁 {credits.length} free Pro month{credits.length !== 1 ? 's' : ''} banked!
          </p>
          <p className="text-[10px] text-white/60 leading-snug">
            Email{' '}
            <a href="mailto:info@gascap.app" className="text-amber-400 underline underline-offset-2">
              info@gascap.app
            </a>{' '}
            to redeem your free month{credits.length !== 1 ? 's' : ''} toward your subscription.
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-slate-400 text-center leading-snug pb-1">
          💡 Open GasCap every single day to grow your streak. Missing a day resets it to zero!
        </p>
      )}
    </div>
  );
}
