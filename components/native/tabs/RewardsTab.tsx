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
  // Null until loaded, so the nudge never flashes before we know the answer.
  const [phoneBonusEntries, setPhoneBonusEntries] = useState<number | null>(null);
  const [phoneVerified,     setPhoneVerified]     = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) return;
    const load = (d: { entryCount?: number; phoneBonusEntries?: number; phoneVerified?: boolean } | null) => {
      if (d?.entryCount != null) setEntryCount(d.entryCount);
      if (d?.phoneBonusEntries != null) setPhoneBonusEntries(d.phoneBonusEntries);
      if (d?.phoneVerified     != null) setPhoneVerified(d.phoneVerified);
    };
    fetch('/api/user/giveaway-entries')
      .then((r) => r.ok ? r.json() : null)
      .then(load)
      .catch(() => {});
    const handler = () => {
      fetch('/api/user/giveaway-entries')
        .then((r) => r.ok ? r.json() : null)
        .then(load)
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

      {/* Phone-verification nudge — the +25 bonus was only ever surfaced as a
          passive line item in the /giveaway breakdown, so just 4 of 172 users
          with a phone on file had ever claimed it. Shown only to signed-in
          users who haven't claimed it yet; disappears permanently once they do. */}
      {/* Gated on VERIFICATION, not on whether the +25 was paid.
          phoneBonusEntries === 0 was the wrong proxy: the award had a second
          condition (no phone previously on file), so 145 users who had
          verified were told, permanently, to verify. Someone who has verified
          never sees this again, whether or not the bonus reached them. */}
      {!isGuest && phoneVerified === false && (
        <Link
          href="/settings#phone"
          className="block rounded-2xl border border-emerald-200 dark:border-emerald-900
                     bg-emerald-50 dark:bg-emerald-900/20 p-4 active:opacity-90 transition-opacity"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl shrink-0" aria-hidden="true">📱</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200 leading-tight">
                {t.rewardsHub.phoneNudgeTitle}
              </p>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-0.5 leading-snug">
                {t.rewardsHub.phoneNudgeSub}
              </p>
            </div>
            <span className="shrink-0 text-emerald-700 dark:text-emerald-300 text-lg" aria-hidden="true">›</span>
          </div>
        </Link>
      )}

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
