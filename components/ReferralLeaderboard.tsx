'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ReferralData {
  code:           string;
  referralCount:  number;
  reachedCap:     boolean;
  activeCredits:  number;
}

interface Milestone {
  count:  number;
  label:  string;
  icon:   string;
  reward: string;
}

const MILESTONES: Milestone[] = [
  { count: 1,  icon: '🎯', label: 'First Recruit',    reward: '1 free month' },
  { count: 3,  icon: '⛽', label: 'Fuel Evangelist',  reward: '3 free months' },
  { count: 5,  icon: '🏆', label: 'Gas Guru',         reward: '5 free months' },
  { count: 10, icon: '👑', label: 'GasCap Legend',    reward: '10 free months' },
];

export default function ReferralLeaderboard() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch('/api/referral', { credentials: 'include' })
      .then(r => r.json())
      .then((d: ReferralData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  if (!session || loading || !data) return null;

  const count       = data.referralCount ?? 0;
  const nextMilestone = MILESTONES.find(m => m.count > count);
  const toNext        = nextMilestone ? nextMilestone.count - count : 0;
  const prevMilestone = [...MILESTONES].reverse().find(m => m.count <= count);
  const pct = nextMilestone
    ? Math.round(((count - (prevMilestone?.count ?? 0)) / (nextMilestone.count - (prevMilestone?.count ?? 0))) * 100)
    : 100;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Referral Milestones
        </h3>
        <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          {count} referral{count !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Progress to next milestone */}
      {nextMilestone && (
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <p className="text-[11px] text-slate-500">
              <span className="font-bold text-slate-700">{toNext} more</span> to unlock {nextMilestone.icon} {nextMilestone.label}
            </p>
            <p className="text-[11px] text-slate-400">{pct}%</p>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      {!nextMilestone && (
        <p className="text-xs font-black text-amber-600 text-center">
          👑 You&apos;ve unlocked all milestones!
        </p>
      )}

      {/* Milestone badges */}
      <div className="grid grid-cols-4 gap-2">
        {MILESTONES.map(m => {
          const earned = count >= m.count;
          return (
            <div
              key={m.count}
              className={`flex flex-col items-center gap-1 rounded-xl p-2 border transition-all ${
                earned
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-slate-50 border-slate-100 opacity-40'
              }`}
            >
              <span className="text-xl">{m.icon}</span>
              <p className="text-[9px] font-black text-center text-slate-600 leading-tight">
                {m.label}
              </p>
              <p className="text-[9px] text-center text-slate-400 leading-tight">
                {m.count} referral{m.count !== 1 ? 's' : ''}
              </p>
            </div>
          );
        })}
      </div>

      {data.activeCredits > 0 && (
        <p className="text-[11px] text-center text-green-600 font-semibold bg-green-50 rounded-xl py-2 px-3">
          🎁 You have {data.activeCredits} free month{data.activeCredits !== 1 ? 's' : ''} banked — redeem in billing settings
        </p>
      )}
    </div>
  );
}
