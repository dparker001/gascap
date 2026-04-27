'use client';

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useRouter }           from 'next/navigation';
import Link                    from 'next/link';

interface GiveawayEntries {
  month:          string;
  entryCount:     number;
  baseEntries:    number;
  streakBonus:    number;
  streak:         number;
  streakTier:     { minStreak: number; bonus: number; label: string };
  nextStreakTier: { minStreak: number; bonus: number; label: string } | null;
  eligible:       boolean;
}

interface DrawRecord {
  id:           string;
  month:        string;
  winnerName:   string;
  drawnAt:      string;
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-');
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
}

function currentMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function GiveawayPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [entries,  setEntries]  = useState<GiveawayEntries | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [recentWinner, setRecentWinner] = useState<DrawRecord | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/signin?next=/giveaway');
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetch('/api/user/giveaway-entries').then((r) => r.json()),
      fetch('/api/giveaway/history').then((r) => r.json()).catch(() => ({ draws: [] })),
    ]).then(([entriesData, historyData]) => {
      setEntries(entriesData as GiveawayEntries);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draws = (historyData as any).draws as DrawRecord[] ?? [];
      // Only show winner from a previous month, not the current one
      const prev = draws.find((d) => d.month !== currentMonthStr());
      if (prev) setRecentWinner(prev);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [session]);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#005F4A] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white border-t-transparent animate-spin" />
      </div>
    );
  }

  const month          = entries?.month ?? currentMonthStr();
  const entryCount     = entries?.entryCount ?? 0;
  const baseEntries    = entries?.baseEntries ?? 0;
  const streakBonus    = entries?.streakBonus ?? 0;
  const streak         = entries?.streak ?? 0;
  const nextStreakTier = entries?.nextStreakTier ?? null;
  const eligible       = entries?.eligible ?? false;
  const maxDays        = 31;
  const progressPct    = Math.min(100, Math.round((baseEntries / maxDays) * 100));

  return (
    <div className="min-h-screen bg-[#005F4A]">

      {/* Header */}
      <div className="px-5 pt-10 pb-6">
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <Link href="/" className="text-white/50 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </Link>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F]">GasCap™</p>
            <p className="text-white font-black text-lg leading-tight">Monthly Gas Card</p>
          </div>
          <div className="w-5" /> {/* spacer */}
        </div>
      </div>

      <div className="max-w-sm mx-auto px-5 space-y-4 pb-12">

        {/* Gift box hero */}
        <div className="text-center py-4">
          <p className="text-6xl mb-3">🎁</p>
          <p className="text-white text-2xl font-black leading-tight">Win a $25 Gas Card</p>
          <p className="text-white/60 text-sm mt-1">One winner drawn every month</p>
        </div>

        {/* Entry count card */}
        {eligible ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-5 space-y-4 border border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-white/70 text-xs font-bold uppercase tracking-wider">{fmtMonth(month)}</p>
              <span className="text-[10px] font-black bg-[#1EB68F] text-white px-2 py-0.5 rounded-full">ENTERED</span>
            </div>

            {/* Big entry count */}
            <div className="text-center py-2">
              <p className="text-7xl font-black text-white leading-none">{entryCount}</p>
              <p className="text-white/60 text-sm mt-1">
                {entryCount === 1 ? 'entry this month' : 'entries this month'}
              </p>
              {/* Breakdown when streak bonus applies */}
              {streakBonus > 0 && (
                <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                  <span className="text-xs text-white/50 bg-white/10 rounded-full px-2.5 py-0.5">
                    📅 {baseEntries} active days
                  </span>
                  <span className="text-xs text-amber-400 bg-amber-500/20 rounded-full px-2.5 py-0.5 font-semibold">
                    ⚡ +{streakBonus} streak bonus
                  </span>
                </div>
              )}
            </div>

            {/* Active-day progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-white/50">
                <span>Active days this month</span>
                <span>{baseEntries} / {maxDays}</span>
              </div>
              <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${progressPct}%`,
                    background: 'linear-gradient(90deg, #1EB68F, #FA7109)',
                  }}
                />
              </div>
            </div>

            {/* Streak display */}
            <div className="bg-white/5 rounded-2xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <div>
                  <p className="text-white text-xs font-bold">{streak}-day streak</p>
                  <p className="text-white/40 text-[10px]">
                    {streakBonus > 0
                      ? `+${streakBonus} bonus entries active`
                      : nextStreakTier
                        ? `${nextStreakTier.minStreak - streak} more days → +${nextStreakTier.bonus} bonus entries`
                        : 'Keep it up!'}
                  </p>
                </div>
              </div>
              {streakBonus > 0 && (
                <span className="text-xs font-black text-amber-400 bg-amber-500/20 rounded-full px-2 py-0.5">
                  +{streakBonus}
                </span>
              )}
              {streakBonus === 0 && nextStreakTier && (
                <span className="text-[10px] text-white/30 bg-white/5 rounded-full px-2 py-0.5">
                  {nextStreakTier.minStreak - streak}d away
                </span>
              )}
            </div>

            {baseEntries === 0 ? (
              <p className="text-center text-white/60 text-xs leading-relaxed">
                Use GasCap™ today to earn your first entry — every day you open the app counts!
              </p>
            ) : baseEntries < 10 ? (
              <p className="text-center text-white/60 text-xs leading-relaxed">
                Keep it up! Open the app each day to stack more entries. More entries = better odds.
              </p>
            ) : (
              <p className="text-center text-[#1EB68F] text-xs font-semibold leading-relaxed">
                ⚡ You&apos;re building serious odds this month — great work!
              </p>
            )}
          </div>
        ) : (
          /* Not eligible — free plan */
          <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-5 space-y-3 border border-white/10">

            {/* Free entry option */}
            <div className="text-center space-y-1">
              <p className="text-3xl">🎁</p>
              <p className="text-white font-black text-base">You have 1 free entry available</p>
              <p className="text-white/60 text-sm leading-relaxed">
                Any eligible person can enter once per month — no purchase needed.
              </p>
            </div>

            <Link
              href="/amoe"
              className="block w-full py-3 rounded-2xl bg-[#1EB68F] hover:bg-[#17a07f]
                         text-white font-black text-sm text-center transition-colors"
            >
              Submit My Free Entry →
            </Link>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-white/10" />
              <p className="text-white/30 text-[10px] font-bold uppercase tracking-wider">or</p>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Upgrade CTA */}
            <div className="text-center space-y-1.5">
              <p className="text-white/60 text-xs leading-relaxed">
                Upgrade to Pro and earn up to{' '}
                <strong className="text-amber-400">31 entries per month</strong>{' '}
                automatically, plus{' '}
                <strong className="text-amber-400">up to 10 bonus entries</strong>{' '}
                for maintaining a daily streak.
              </p>
              <Link
                href="/upgrade"
                className="block w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400
                           text-white font-black text-sm transition-colors"
              >
                ⭐ Upgrade to Pro — $4.99/mo
              </Link>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-white/8 rounded-3xl p-5 space-y-3 border border-white/10">
          <p className="text-white font-black text-sm">How entries work</p>
          <div className="space-y-2.5">
            {[
              { emoji: '📅', text: 'Each day you open GasCap™ earns 1 entry (up to 31/month)' },
              { emoji: '⚡', text: '7-day streak = +2 bonus entries · 30-day = +5 · 90-day = +10' },
              { emoji: '📈', text: 'More entries = better odds — streaks compound your edge' },
              { emoji: '🏆', text: 'One winner drawn on the 5th of each month' },
              { emoji: '⛽', text: '$25 gas card sent directly to the winner' },
            ].map((item) => (
              <div key={item.text} className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">{item.emoji}</span>
                <p className="text-white/70 text-sm leading-snug">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent winner */}
        {recentWinner && (
          <div className="bg-amber-500/20 border border-amber-400/30 rounded-3xl p-4 text-center space-y-1">
            <p className="text-amber-300 text-[10px] font-black uppercase tracking-wider">
              {fmtMonth(recentWinner.month)} Winner
            </p>
            <p className="text-white font-black">{recentWinner.winnerName}</p>
            <p className="text-white/50 text-xs">
              Drawn {new Date(recentWinner.drawnAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            </p>
          </div>
        )}

        {/* Official rules */}
        <div className="text-center space-y-2 pt-2">
          <Link
            href="/sweepstakes-rules"
            className="text-[11px] text-white/40 hover:text-white/70 underline transition-colors"
          >
            Official Rules & No-Purchase Entry →
          </Link>
          <p className="text-[10px] text-white/25">
            No purchase necessary. A purchase does not improve your odds of winning.
          </p>
        </div>

        {/* Back to wrapped */}
        <div className="text-center pt-1">
          <Link
            href="/wrapped"
            className="text-[11px] text-white/40 hover:text-white/60 transition-colors"
          >
            📊 View your Year in Review →
          </Link>
        </div>

      </div>
    </div>
  );
}
