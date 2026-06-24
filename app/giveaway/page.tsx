'use client';

import { useEffect, useState } from 'react';
import { useSession }          from 'next-auth/react';
import { useRouter }           from 'next/navigation';
import Link                    from 'next/link';
import { useIsNative }         from '@/hooks/useIsNative';
import { useTranslation }      from '@/contexts/LanguageContext';

interface GiveawayEntries {
  month:                    string;
  entryCount:               number;
  baseEntries:              number;
  activeDayCount:           number;
  entryMultiplier:          number;
  streakBonus:              number;
  streak:                   number;
  streakTier:               { minStreak: number; bonus: number; label: string };
  nextStreakTier:           { minStreak: number; bonus: number; label: string } | null;
  eligible:                 boolean;
  earlyUpgradeBonusEntries: number;
  verifyBonusEntries:       number;
  phoneBonusEntries:        number;
  dailyBonusEntries:        number;
  garageBonusEntries:       number;
  garageDaysThisMonth:      number;
  lifetimeBonusEntries:     number;
  lifetimePerksActive:      boolean;
  referralCount:            number;
}

interface DrawRecord {
  id:           string;
  month:        string;
  winnerName:   string;
  drawnAt:      string;
}

function fmtMonth(m: string, names: string[]): string {
  const [y, mo] = m.split('-');
  return `${names[parseInt(mo, 10) - 1]} ${y}`;
}

function currentMonthStr(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function GiveawayPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { t } = useTranslation();
  // Hide Pro price / upgrade CTA inside the native apps (App Store 2.1(b)/3.1.1).
  const isNative = useIsNative();

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

  const month                    = entries?.month ?? currentMonthStr();
  const entryCount               = entries?.entryCount ?? 0;
  const baseEntries              = entries?.baseEntries ?? 0;
  const activeDayCount           = entries?.activeDayCount ?? 0;
  const entryMultiplier          = entries?.entryMultiplier ?? 1;
  const streakBonus              = entries?.streakBonus ?? 0;
  const streak                   = entries?.streak ?? 0;
  const nextStreakTier           = entries?.nextStreakTier ?? null;
  const eligible                 = entries?.eligible ?? false;
  const earlyUpgradeBonusEntries = entries?.earlyUpgradeBonusEntries ?? 0;
  const verifyBonusEntries       = entries?.verifyBonusEntries ?? 0;
  const phoneBonusEntries        = entries?.phoneBonusEntries ?? 0;
  const dailyBonusEntries        = entries?.dailyBonusEntries ?? 0;
  const garageBonusEntries       = entries?.garageBonusEntries ?? 0;
  const garageDaysThisMonth      = entries?.garageDaysThisMonth ?? 0;
  const lifetimeBonusEntries     = entries?.lifetimeBonusEntries ?? 0;
  const lifetimePerksActive      = entries?.lifetimePerksActive ?? false;
  const maxDays                  = 31;
  const progressPct              = Math.min(100, Math.round((activeDayCount / maxDays) * 100));

  // Build the entry breakdown rows — only show rows where entries > 0
  const breakdownRows = [
    {
      key:   'active',
      emoji: '📅',
      label: entryMultiplier > 1
        ? t.giveawayPage.breakdownActiveDaysAmbassador(activeDayCount, entryMultiplier)
        : t.giveawayPage.breakdownActiveDays,
      entries: baseEntries,
    },
    { key: 'streak',   emoji: '⚡', label: t.giveawayPage.breakdownStreak(streak),          entries: streakBonus              },
    { key: 'daily',    emoji: '🎁', label: t.giveawayPage.breakdownDaily,                    entries: dailyBonusEntries        },
    { key: 'garage',   emoji: '🚗', label: t.giveawayPage.breakdownGarage(garageDaysThisMonth), entries: garageBonusEntries   },
    { key: 'verify',   emoji: '✉️', label: t.giveawayPage.breakdownVerify,                  entries: verifyBonusEntries       },
    { key: 'phone',    emoji: '📱', label: t.giveawayPage.breakdownPhone,                   entries: phoneBonusEntries        },
    { key: 'upgrade',  emoji: '⭐', label: t.giveawayPage.breakdownUpgrade,                 entries: earlyUpgradeBonusEntries },
    { key: 'lifetime', emoji: '🏅', label: lifetimePerksActive ? 'Lifetime Perks bonus' : 'Pro Lifetime / Annual bonus', entries: lifetimeBonusEntries },
  ].filter((r) => r.entries > 0);

  return (
    <div className="min-h-screen bg-[#005F4A]">

      {/* Header */}
      <div className="px-5 pt-10 pb-6">
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <Link href="/" aria-label={t.giveawayPage.backToHome} className="text-white/60 hover:text-white transition-colors">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </Link>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#1EB68F]">GasCap™</p>
            <p className="text-white font-black text-lg leading-tight">{t.giveawayPage.headerTitle}</p>
          </div>
          <div className="w-5" /> {/* spacer */}
        </div>
      </div>

      <div className="max-w-sm mx-auto px-5 space-y-4 pb-12">

        {/* Gift box hero */}
        <div className="text-center py-4">
          <p className="text-6xl mb-3">🎁</p>
          <p className="text-white text-2xl font-black leading-tight">{t.giveawayPage.heroTitle}</p>
          <p className="text-white/70 text-sm mt-1">{t.giveawayPage.heroSubtitle}</p>
        </div>

        {/* Entry count card */}
        {eligible ? (
          <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-5 space-y-4 border border-white/10">
            <div className="flex items-center justify-between">
              <p className="text-white/70 text-xs font-bold uppercase tracking-wider">{fmtMonth(month, t.giveawayPage.monthNames)}</p>
              <span className="text-[10px] font-black bg-[#1EB68F] text-white px-2 py-0.5 rounded-full">{t.giveawayPage.enteredBadge}</span>
            </div>

            {/* Big entry count */}
            <div className="text-center py-2">
              <p className="text-7xl font-black text-white leading-none">{entryCount}</p>
              <p className="text-white/70 text-sm mt-1">
                {entryCount === 1 ? t.giveawayPage.entryThisMonth : t.giveawayPage.entriesThisMonth}
              </p>
              {/* Breakdown when streak bonus applies */}
              {streakBonus > 0 && (
                <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                  <span className="text-xs text-white/70 bg-white/10 rounded-full px-2.5 py-0.5">
                    📅 {t.giveawayPage.activeDaysChip(baseEntries)}
                  </span>
                  <span className="text-xs text-amber-400 bg-amber-500/20 rounded-full px-2.5 py-0.5 font-semibold">
                    ⚡ {t.giveawayPage.streakBonusChip(streakBonus)}
                  </span>
                </div>
              )}
            </div>

            {/* Active-day progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-white/70">
                <span>{t.giveawayPage.activeDaysThisMonth}</span>
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
                  <p className="text-white text-xs font-bold">{t.giveawayPage.dayStreak(streak)}</p>
                  <p className="text-white/70 text-[10px]">
                    {streakBonus > 0
                      ? t.giveawayPage.bonusEntriesActive(streakBonus)
                      : nextStreakTier
                        ? t.giveawayPage.nextTierHint(nextStreakTier.minStreak - streak, nextStreakTier.bonus)
                        : t.giveawayPage.keepItUp}
                  </p>
                </div>
              </div>
              {streakBonus > 0 && (
                <span className="text-xs font-black text-amber-400 bg-amber-500/20 rounded-full px-2 py-0.5">
                  +{streakBonus}
                </span>
              )}
              {streakBonus === 0 && nextStreakTier && (
                <span className="text-[10px] text-white/60 bg-white/5 rounded-full px-2 py-0.5">
                  {t.giveawayPage.daysAway(nextStreakTier.minStreak - streak)}
                </span>
              )}
            </div>

            {baseEntries === 0 ? (
              <p className="text-center text-white/70 text-xs leading-relaxed">
                {t.giveawayPage.encourageNone}
              </p>
            ) : baseEntries < 10 ? (
              <p className="text-center text-white/70 text-xs leading-relaxed">
                {t.giveawayPage.encourageSome}
              </p>
            ) : (
              <p className="text-center text-[#1EB68F] text-xs font-semibold leading-relaxed">
                {t.giveawayPage.encourageStrong}
              </p>
            )}
          </div>
        ) : (
          /* Not eligible — free plan */
          <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-5 space-y-3 border border-white/10">

            {/* Free entry option */}
            <div className="text-center space-y-1">
              <p className="text-3xl">🎁</p>
              <p className="text-white font-black text-base">{t.giveawayPage.freeEntryTitle}</p>
              <p className="text-white/70 text-sm leading-relaxed">
                {t.giveawayPage.freeEntryDesc}
              </p>
            </div>

            <Link
              href="/amoe"
              className="block w-full py-3 rounded-2xl bg-[#1EB68F] hover:bg-[#17a07f]
                         text-white font-black text-sm text-center transition-colors"
            >
              {t.giveawayPage.submitFreeEntry}
            </Link>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-white/10" />
              <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider">{t.giveawayPage.or}</p>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Upgrade CTA — web only (no in-app purchase/price in native apps) */}
            {!isNative && (
              <div className="text-center space-y-1.5">
                <p className="text-white/70 text-xs leading-relaxed">
                  {t.giveawayPage.upgradePitchPre}{' '}
                  <strong className="text-amber-400">{t.giveawayPage.upgradePitch31}</strong>{' '}
                  {t.giveawayPage.upgradePitchMid}{' '}
                  <strong className="text-amber-400">{t.giveawayPage.upgradePitch20}</strong>{' '}
                  {t.giveawayPage.upgradePitchPost}
                </p>
                <Link
                  href="/upgrade"
                  className="block w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-400
                             text-white font-black text-sm transition-colors"
                >
                  {t.giveawayPage.upgradeCta}
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Entry breakdown — only shown when eligible and has entries */}
        {eligible && entryCount > 0 && breakdownRows.length > 0 && (
          <div className="bg-white/8 rounded-3xl p-5 space-y-3 border border-white/10">
            <p className="text-white font-black text-sm">{t.giveawayPage.breakdownTitle}</p>
            <div className="space-y-2">
              {breakdownRows.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base flex-shrink-0">{row.emoji}</span>
                    <p className="text-white/70 text-xs leading-snug truncate">{row.label}</p>
                  </div>
                  <span className="text-white font-black text-sm flex-shrink-0 tabular-nums">
                    +{row.entries}
                  </span>
                </div>
              ))}
              {/* Divider + total */}
              <div className="border-t border-white/10 pt-2 flex items-center justify-between">
                <p className="text-white/70 text-xs font-bold uppercase tracking-wider">{t.giveawayPage.total}</p>
                <p className="text-[#1EB68F] font-black text-sm tabular-nums">{t.giveawayPage.totalEntries(entryCount)}</p>
              </div>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-white/8 rounded-3xl p-5 space-y-3 border border-white/10">
          <p className="text-white font-black text-sm">{t.giveawayPage.howItWorksTitle}</p>
          <div className="space-y-2.5">
            {[
              { emoji: '📅', text: t.giveawayPage.howItWorks1 },
              { emoji: '⚡', text: t.giveawayPage.howItWorks2 },
              { emoji: '📈', text: t.giveawayPage.howItWorks3 },
              { emoji: '🏆', text: t.giveawayPage.howItWorks4 },
              { emoji: '⛽', text: t.giveawayPage.howItWorks5 },
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
              {t.giveawayPage.winnerLabel(fmtMonth(recentWinner.month, t.giveawayPage.monthNames))}
            </p>
            <p className="text-white font-black">{recentWinner.winnerName}</p>
            <p className="text-white/60 text-xs">
              {t.giveawayPage.drawnOn(new Date(recentWinner.drawnAt).toLocaleDateString(t.giveawayPage.dateLocale, { month: 'long', day: 'numeric' }))}
            </p>
          </div>
        )}

        {/* Official rules */}
        <div className="text-center space-y-2 pt-2">
          <Link
            href="/sweepstakes-rules"
            className="text-[11px] text-white/60 hover:text-white/80 underline transition-colors"
          >
            {t.giveawayPage.officialRules}
          </Link>
          <p className="text-[10px] text-white/60">
            {t.giveawayPage.noPurchaseNote}
          </p>
        </div>

        {/* Back to wrapped */}
        <div className="text-center pt-1">
          <Link
            href="/wrapped"
            className="text-[11px] text-white/60 hover:text-white/80 transition-colors"
          >
            {t.giveawayPage.viewWrapped}
          </Link>
        </div>

      </div>
    </div>
  );
}
