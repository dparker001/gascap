'use client';

/**
 * RewardsTab — native "Rewards" hub. Leads with the monthly gas-card giveaway,
 * then the engagement rewards that drive daily entries (streaks, daily bonus,
 * referral credits). Reuses existing components — no rewrites.
 *
 * Later: Kard card-linked cash-back slots in here (web-first, native-gated until
 * vetted) — see memory [[card-linked-rewards]].
 */

import Link            from 'next/link';
import StreakRewards   from '@/components/StreakRewards';
import DailyBonus      from '@/components/DailyBonus';
import ReferralCard    from '@/components/ReferralCard';

export default function RewardsTab() {
  return (
    <div className="px-4 pt-4 pb-2 max-w-lg mx-auto w-full space-y-4">

      {/* Giveaway hero — the headline reason to come back */}
      <Link
        href="/giveaway"
        className="block rounded-2xl p-5 bg-gradient-to-br from-teal-600 to-emerald-700
                   text-white shadow-sm active:opacity-90 transition-opacity"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl" aria-hidden="true">🎁</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">Monthly Gas Card Giveaway</h2>
            <p className="text-sm text-white/85 mt-0.5">
              Every active day earns an entry. Tap to view this month&apos;s prize &amp; rules →
            </p>
          </div>
        </div>
      </Link>

      {/* Engagement rewards — each renders its own state / sign-in prompt */}
      <StreakRewards />
      <DailyBonus />
      <ReferralCard />

    </div>
  );
}
