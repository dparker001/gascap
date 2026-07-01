'use client';

/**
 * RewardsTab — native "Rewards" hub. Leads with the monthly gas-card giveaway,
 * then the engagement rewards that drive daily entries (streaks, referral credits),
 * plus a Kard card-linked cash-back teaser ("coming soon").
 *
 * Visible to guests as a teaser (giveaway + sign-in CTA) — an acquisition surface,
 * not a hard lock. Signed-in users see their live streak/referral rewards.
 * Kard cash-back lands here once live — see memory [[card-linked-rewards]].
 */

import Link            from 'next/link';
import { useSession }  from 'next-auth/react';
import { useEffect, useState } from 'react';
import StreakRewards   from '@/components/StreakRewards';
import ReferralCard    from '@/components/ReferralCard';
import { useTranslation } from '@/contexts/LanguageContext';

export default function RewardsTab() {
  const { data: session, status } = useSession();
  const { t } = useTranslation();
  const isGuest = status === 'unauthenticated';
  const [entryCount, setEntryCount] = useState<number | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch('/api/user/giveaway-entries')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { entryCount?: number } | null) => {
        if (d?.entryCount != null) setEntryCount(d.entryCount);
      })
      .catch(() => {});
    const handler = () => {
      fetch('/api/user/giveaway-entries')
        .then((r) => r.ok ? r.json() : null)
        .then((d: { entryCount?: number } | null) => {
          if (d?.entryCount != null) setEntryCount(d.entryCount);
        })
        .catch(() => {});
    };
    window.addEventListener('gascap:entries-earned', handler);
    return () => window.removeEventListener('gascap:entries-earned', handler);
  }, [session]);

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
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-tight">{t.rewardsHub.giveawayTitle}</h2>
            <p className="text-sm text-white/85 mt-0.5">
              {t.rewardsHub.giveawaySub}
            </p>
          </div>
          {!isGuest && entryCount != null && (
            <div className="shrink-0 text-right">
              <p className="text-2xl font-black leading-none">{entryCount}</p>
              <p className="text-xs text-white/80 mt-0.5 font-medium">entries</p>
            </div>
          )}
        </div>
      </Link>

      {/* Guest CTA — turn the empty signed-out state into a sign-up pitch */}
      {isGuest && (
        <div className="rounded-2xl border border-teal-200 dark:border-teal-900 bg-teal-50
                        dark:bg-teal-900/20 p-5 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t.rewardsHub.guestTitle}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {t.rewardsHub.guestSub}
          </p>
          <Link
            href="/signup"
            className="inline-block mt-3 px-5 py-2.5 rounded-xl bg-[#005F4A] text-white text-sm
                       font-bold active:opacity-90 transition-opacity"
          >
            {t.gate.createAccount}
          </Link>
        </div>
      )}

      {/* Signed-in engagement rewards — each renders its own state.
          (DailyBonus is a global floating launcher, not mounted inline here.) */}
      {!isGuest && (
        <>
          <StreakRewards />
          <ReferralCard />
        </>
      )}

      {/* Kard card-linked cash-back — roadmap teaser (informational only, no dead-end) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white
                      dark:bg-slate-800/50 p-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">💳</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t.rewardsHub.cashTitle}</h3>
              <span className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full
                               bg-amber-100 text-amber-700 border border-amber-200">{t.rewardsHub.comingSoon}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {t.rewardsHub.cashSub}
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
