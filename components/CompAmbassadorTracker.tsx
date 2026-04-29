'use client';

/**
 * CompAmbassadorTracker
 *
 * Private rewards tracker visible only to Comp Ambassador members
 * (ambassadorProForLife === true). Shows gas card milestone progress
 * based on paying referral count.
 *
 * Milestones:
 *   10 paying referrals → $25 gas card
 *   25 paying referrals → $50 gas card
 *   50 paying referrals → $100 gas card
 *
 * This component is intentionally not surfaced in public docs or marketing.
 * It renders nothing for non-comped users.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

interface ReferralData {
  referralCount:        number;
  ambassadorProForLife: boolean;
}

interface Milestone {
  threshold: number;
  reward:    string;
  label:     string;
}

const MILESTONES: Milestone[] = [
  { threshold: 10, reward: '$25 gas card', label: 'Starter Reward'  },
  { threshold: 25, reward: '$50 gas card', label: 'Growth Reward'   },
  { threshold: 50, reward: '$100 gas card', label: 'Elite Reward'   },
];

function MilestoneBar({ milestone, count }: { milestone: Milestone; count: number }) {
  const achieved = count >= milestone.threshold;
  const prev     = MILESTONES.find((m) => m.threshold < milestone.threshold);
  const prevThreshold = prev?.threshold ?? 0;
  const raw  = Math.min(count - prevThreshold, milestone.threshold - prevThreshold);
  const pct  = achieved
    ? 100
    : Math.max(0, Math.round((raw / (milestone.threshold - prevThreshold)) * 100));
  const remaining = Math.max(0, milestone.threshold - count);

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      achieved
        ? 'border-teal-300 bg-teal-50'
        : 'border-gray-200 bg-white'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{achieved ? '🎉' : '⛽'}</span>
          <div>
            <p className={`text-sm font-semibold ${achieved ? 'text-teal-800' : 'text-gray-800'}`}>
              {milestone.reward}
            </p>
            <p className="text-xs text-gray-500">{milestone.label}</p>
          </div>
        </div>
        <div className="text-right">
          {achieved ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white">
              ✓ Earned
            </span>
          ) : (
            <span className="text-xs text-gray-500">
              {remaining} more to go
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            achieved ? 'bg-teal-500' : 'bg-orange-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between text-xs text-gray-400">
        <span>{prevThreshold}</span>
        <span className={achieved ? 'text-teal-600 font-medium' : ''}>
          {count >= prevThreshold ? Math.min(count, milestone.threshold) : prevThreshold} / {milestone.threshold} referrals
        </span>
        <span>{milestone.threshold}</span>
      </div>
    </div>
  );
}

export default function CompAmbassadorTracker() {
  const { data: session } = useSession();
  const [data,    setData]    = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) return;
    fetch('/api/referral')
      .then((r) => r.json())
      .then((d: ReferralData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);

  // Not logged in, loading, or not a comp member — render nothing
  if (!session?.user || loading || !data?.ambassadorProForLife) return null;

  const count       = data.referralCount ?? 0;
  const earned      = MILESTONES.filter((m) => count >= m.threshold);
  const nextMilestone = MILESTONES.find((m) => count < m.threshold);
  const allEarned   = earned.length === MILESTONES.length;

  return (
    <div className="rounded-2xl border border-teal-200 bg-gradient-to-b from-teal-50 to-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xl">🏅</span>
        <div>
          <h3 className="text-sm font-bold text-teal-800">Ambassador Rewards</h3>
          <p className="text-xs text-teal-600">
            {count} paying referral{count !== 1 ? 's' : ''} · Comp Pro for Life
          </p>
        </div>
        <div className="ml-auto">
          <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            ♾ Pro for Life
          </span>
        </div>
      </div>

      {/* Milestone bars */}
      <div className="space-y-3">
        {MILESTONES.map((m) => (
          <MilestoneBar key={m.threshold} milestone={m} count={count} />
        ))}
      </div>

      {/* Footer message */}
      <div className="mt-4 rounded-lg bg-teal-50 border border-teal-100 px-3 py-2.5 text-xs text-teal-700">
        {allEarned ? (
          <p>
            🎊 <strong>You've earned all three gas card rewards!</strong> We'll reach out to deliver your cards. Thank you for being a top ambassador.
          </p>
        ) : nextMilestone ? (
          <p>
            ⛽ Earn a <strong>{nextMilestone.reward}</strong> when you reach{' '}
            <strong>{nextMilestone.threshold} paying referrals</strong>. Only{' '}
            {Math.max(0, nextMilestone.threshold - count)} away — keep sharing!
          </p>
        ) : null}
      </div>

      {/* How paying referrals work */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
          How are paying referrals counted?
        </summary>
        <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
          A referral is counted when someone you referred upgrades to GasCap™ Pro
          and makes their first payment. Free sign-ups don't count toward gas card milestones.
          Gas cards are delivered manually — we'll contact you when you hit a milestone.
        </p>
      </details>
    </div>
  );
}
