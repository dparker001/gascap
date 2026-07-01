/**
 * GET /api/user/giveaway-entries
 * Returns the current user's entry breakdown for the current draw period.
 * Includes base entries (active days) + streak bonus entries.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  activeDaysInPeriod,
  currentPeriod,
  streakBonusEntries,
  streakTierForStreak,
  nextStreakTier,
  LIFETIME_BONUS_ENTRIES,
  LIFETIME_BASE_BONUS_ENTRIES,
  ANNUAL_BONUS_ENTRIES,
  REFERRAL_BONUS_ENTRIES,
} from '@/lib/giveaway';
import {
  getAmbassadorTier,
  ambassadorEntryMultiplier,
  isAlwaysEligible,
} from '@/lib/ambassador';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as { id?: string })?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: {
      activeDays: true,
      plan: true,
      stripeInterval: true,
      lifetimePerksUntil: true,
      streak: true,
      referralCount: true,
      earlyUpgradeBonusEntries: true,
      garageBonusDays: true,
      verifyReminderBonusEntries: true,
      phoneBonusEntries: true,
      dailyBonusEntries: true,
      firstCalcBonusEntries: true,
      emailVerified: true,
      priceReportEntries: true,
      gigLogEntries: true,
    },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const period         = currentPeriod();
  const refCount       = user.referralCount ?? 0;
  const multiplier     = ambassadorEntryMultiplier(refCount);
  const activeDayCount = activeDaysInPeriod(user.activeDays ?? [], period);
  const baseEntries    = activeDayCount * multiplier;   // multiplier on active days
  const streak         = user.streak ?? 0;
  const streakBonus    = streakBonusEntries(streak);
  const bonusEntries           = user.earlyUpgradeBonusEntries   ?? 0;
  const verifyBonusEntries     = user.verifyReminderBonusEntries ?? 0;
  const phoneBonusEntries      = user.phoneBonusEntries          ?? 0;
  const dailyBonusEntries      = user.dailyBonusEntries          ?? 0;
  const firstCalcBonusEntries  = user.firstCalcBonusEntries      ?? 0;
  const priceReportEntries     = user.priceReportEntries         ?? 0;
  const gigLogEntries          = user.gigLogEntries              ?? 0;
  const garageDaysThisMonth = activeDaysInPeriod(user.garageBonusDays ?? [], period);
  const garageBonusEntries  = garageDaysThisMonth * 10;
  const perksActive = user.stripeInterval === 'lifetime'
    && user.lifetimePerksUntil != null
    && new Date(user.lifetimePerksUntil) > new Date();
  const lifetimeBonusEntries = user.stripeInterval === 'lifetime'
    ? (perksActive ? LIFETIME_BONUS_ENTRIES : LIFETIME_BASE_BONUS_ENTRIES)
    : user.stripeInterval === 'annual'
    ? ANNUAL_BONUS_ENTRIES
    : 0;
  const referralBonusEntries = refCount * REFERRAL_BONUS_ENTRIES;
  const entryCount     = baseEntries + streakBonus + bonusEntries + garageBonusEntries
                         + verifyBonusEntries + phoneBonusEntries + dailyBonusEntries
                         + firstCalcBonusEntries + lifetimeBonusEntries + referralBonusEntries
                         + priceReportEntries
                         + gigLogEntries;
  const eligible       = user.plan === 'pro' || user.plan === 'fleet';
  const emailVerified  = user.emailVerified ?? false;

  return NextResponse.json({
    period,
    month: period,   // backward-compat alias (GreetingStrip + other clients may read this)
    entryCount,
    baseEntries,
    activeDayCount,   // raw days before multiplier — useful for UI display
    entryMultiplier:  multiplier,
    streakBonus,
    streak,
    streakTier:       streakTierForStreak(streak),
    nextStreakTier:   nextStreakTier(streak),
    eligible,
    emailVerified,                // false = entries won't count in the draw
    ambassadorTier:   getAmbassadorTier(refCount),
    alwaysEligible:   isAlwaysEligible(refCount),
    referralCount:    refCount,
    earlyUpgradeBonusEntries: bonusEntries,
    verifyBonusEntries,
    phoneBonusEntries,
    dailyBonusEntries,
    firstCalcBonusEntries,
    garageBonusEntries,
    garageDaysThisMonth,
    lifetimeBonusEntries,
    referralBonusEntries,
    priceReportEntries,
    gigLogEntries,
    lifetimePerksActive: perksActive,
    lifetimePerksUntil:  user.lifetimePerksUntil?.toISOString() ?? null,
  });
}
