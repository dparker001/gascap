/**
 * Monthly Gas Card Giveaway
 *
 * Entries are derived from activeDays — each day a Pro/Fleet user is
 * active in the current calendar month counts as one entry (max ~31/month).
 * A streak bonus adds extra entries based on the user's current login streak,
 * rewarding daily engagement independent of whether they can win this month.
 * No separate entry counter is stored; everything is computed at draw time.
 *
 * Prize tiers scale automatically with the paying subscriber base.
 * Add a new row to PRIZE_TIERS (keep sorted by minSubscribers) to unlock
 * the next tier — no other code changes needed.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getAmbassadorTier, ambassadorEntryMultiplier, isAlwaysEligible, type AmbassadorTier } from '@/lib/ambassador';

// ─── Prize Tiers ─────────────────────────────────────────────────────────────

export interface PrizeTier {
  minSubscribers: number;
  prize:          string;   // display string, e.g. "$25"
  label:          string;   // internal name shown in admin UI
}

/**
 * Prize ladder — sorted ascending by minSubscribers.
 * The highest tier whose minSubscribers ≤ current count is active.
 *
 * To unlock the next tier, add a row here and redeploy.
 */
export const PRIZE_TIERS: PrizeTier[] = [
  { minSubscribers:   0, prize: '$25',  label: 'Starter' },
  { minSubscribers: 500, prize: '$50',  label: 'Growth'  },
  // { minSubscribers: 1000, prize: '$100', label: 'Scale' },  // ← unlock when ready
];

// ─── Streak Bonus Tiers ───────────────────────────────────────────────────────

export interface StreakBonusTier {
  minStreak: number;
  bonus:     number;
  label:     string;   // shown in UI / admin
}

/**
 * Bonus draw entries awarded based on the user's current login streak.
 * Sorted ascending by minStreak; highest matching tier wins.
 *
 * Streak bonus:
 *  – Keeps daily engagement rewarding even during ineligible months
 *  – Max +10 entries on top of the ~31 active-day entries
 *  – Requires ≥1 active day this month to qualify for the draw at all
 */
export const STREAK_BONUS_TIERS: StreakBonusTier[] = [
  { minStreak:   0, bonus:  0, label: 'No bonus'        },
  { minStreak:   7, bonus:  2, label: '1-week streak'   },
  { minStreak:  30, bonus:  5, label: '1-month streak'  },
  { minStreak:  90, bonus: 10, label: '3-month streak'  },
  { minStreak: 180, bonus: 15, label: '6-month streak'  },
  { minStreak: 365, bonus: 20, label: '1-year streak'   },
];

/**
 * Return the bonus entries for a given streak length.
 * e.g. streak 45 → 5 bonus entries (1-month tier)
 */
export function streakBonusEntries(streak: number): number {
  let bonus = 0;
  for (const tier of STREAK_BONUS_TIERS) {
    if (streak >= tier.minStreak) bonus = tier.bonus;
  }
  return bonus;
}

/** Return the streak bonus tier object for a given streak length */
export function streakTierForStreak(streak: number): StreakBonusTier {
  let active = STREAK_BONUS_TIERS[0];
  for (const tier of STREAK_BONUS_TIERS) {
    if (streak >= tier.minStreak) active = tier;
  }
  return active;
}

/** Return the next streak bonus tier above the current streak, or null if at max */
export function nextStreakTier(streak: number): StreakBonusTier | null {
  return STREAK_BONUS_TIERS.find((t) => t.minStreak > streak) ?? null;
}

/** Count of currently active paying Pro + Fleet subscribers */
export async function countPayingSubscribers(): Promise<number> {
  return prisma.user.count({
    where: { plan: { in: ['pro', 'fleet'] } },
  });
}

/** Return the highest tier whose threshold the given count meets */
export function tierForCount(count: number): PrizeTier {
  let active = PRIZE_TIERS[0];
  for (const tier of PRIZE_TIERS) {
    if (count >= tier.minSubscribers) active = tier;
  }
  return active;
}

/** Return the next tier above the current count, or null if already at max */
export function nextTierForCount(count: number): PrizeTier | null {
  return PRIZE_TIERS.find((t) => t.minSubscribers > count) ?? null;
}

/**
 * One-stop helper: query the live subscriber count, resolve current + next tier.
 * Use at draw time and in the admin preview endpoint.
 */
export async function getCurrentPrizeTier(): Promise<{
  subscriberCount: number;
  currentTier:     PrizeTier;
  nextTier:        PrizeTier | null;
}> {
  const subscriberCount = await countPayingSubscribers();
  return {
    subscriberCount,
    currentTier: tierForCount(subscriberCount),
    nextTier:    nextTierForCount(subscriberCount),
  };
}

export interface EntrantRow {
  userId:          string;
  name:            string;
  email:           string;
  plan:            string;
  streak:          number;
  referralCount:   number;
  ambassadorTier:  AmbassadorTier;
  entryMultiplier: number;        // 1× standard, 2× Supporter, 3× Ambassador, 5× Elite
  baseEntries:     number;        // active days × entryMultiplier
  streakBonus:     number;        // flat bonus from streak tier (not multiplied)
  earlyUpgradeBonusEntries: number; // +10 bonus for trial-to-paid conversions
  entryCount:      number;        // baseEntries + streakBonus + earlyUpgradeBonusEntries
  alwaysEligible:  boolean;       // true for Ambassador tier holders — skip win restrictions
}

export interface DrawResult {
  winner:      EntrantRow;
  totalEntries: number;
  entrantCount: number;
  month:        string;
}

/** Current month as "YYYY-MM" */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Return the calendar quarter (1–4) for a "YYYY-MM" string.
 * Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec
 */
export function quarterForMonth(month: string): number {
  const mo = parseInt(month.split('-')[1], 10);
  return Math.ceil(mo / 3);
}

/** Return the year as a number from a "YYYY-MM" string */
export function yearForMonth(month: string): number {
  return parseInt(month.split('-')[0], 10);
}

/**
 * Return the immediately preceding "YYYY-MM" string.
 * e.g. "2026-01" → "2025-12"
 */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // month is 0-indexed
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Given a draw month and the full draw history, return the set of
 * winner userIds who are ineligible to win again:
 *  – Won the immediately preceding month (no consecutive wins)
 *  – Won any draw in the same calendar quarter of the same year
 */
export function ineligibleWinners(
  drawMonth: string,
  history: { winnerId: string; month: string }[],
): Set<string> {
  const ineligible = new Set<string>();
  const prev       = prevMonth(drawMonth);
  const drawQ      = quarterForMonth(drawMonth);
  const drawY      = yearForMonth(drawMonth);

  for (const d of history) {
    // Skip the draw month itself (shouldn't exist yet, but be safe)
    if (d.month === drawMonth) continue;

    // Consecutive month rule
    if (d.month === prev) {
      ineligible.add(d.winnerId);
    }

    // Same-quarter rule
    if (
      yearForMonth(d.month)    === drawY &&
      quarterForMonth(d.month) === drawQ
    ) {
      ineligible.add(d.winnerId);
    }
  }
  return ineligible;
}

/** All Pro/Fleet users with ≥1 active day in the given month, excluding test accounts */
export async function getEligibleEntrants(month: string): Promise<EntrantRow[]> {
  const prefix = `${month}-`;
  const users  = await prisma.user.findMany({
    where: {
      plan:          { in: ['pro', 'fleet'] },
      isTestAccount: { not: true },   // exclude test/internal accounts from draws
    },
    select: {
      id: true, name: true, email: true, plan: true,
      activeDays: true, streak: true, referralCount: true,
      earlyUpgradeBonusEntries: true,
    },
  });

  return users
    .map((u) => {
      const refCount      = u.referralCount ?? 0;
      const multiplier    = ambassadorEntryMultiplier(refCount);
      const activeDayCount = (u.activeDays ?? []).filter((d) => d.startsWith(prefix)).length;
      const baseEntries   = activeDayCount * multiplier;  // multiplier applied to active days
      const streakBonus   = streakBonusEntries(u.streak ?? 0);
      const bonusEntries  = u.earlyUpgradeBonusEntries ?? 0;
      return {
        userId:          u.id,
        name:            u.name,
        email:           u.email,
        plan:            u.plan,
        streak:          u.streak ?? 0,
        referralCount:   refCount,
        ambassadorTier:  getAmbassadorTier(refCount),
        entryMultiplier: multiplier,
        baseEntries,
        streakBonus,
        earlyUpgradeBonusEntries: bonusEntries,
        entryCount:      baseEntries + streakBonus + bonusEntries,
        alwaysEligible:  isAlwaysEligible(refCount),
      };
    })
    .filter((u) => u.baseEntries > 0)  // must have used the app at least once this month
    .sort((a, b) => b.entryCount - a.entryCount);
}

/**
 * Weighted random draw — more entries = proportionally better odds.
 *
 * Enforces two winner-restriction rules automatically:
 *  1. No consecutive-month wins
 *  2. Maximum one win per calendar quarter (same year)
 *
 * If the first selection is ineligible, that entrant is removed from the pool
 * and the draw repeats until an eligible winner is found.
 * Throws if no eligible entrants remain after applying restrictions.
 */
export async function runWeightedDraw(month: string): Promise<DrawResult> {
  const [allEntrants, history] = await Promise.all([
    getEligibleEntrants(month),
    getDrawHistory(),
  ]);
  if (allEntrants.length === 0) throw new Error('No eligible entrants for this month.');

  const ineligible = ineligibleWinners(month, history);

  // Ambassador tier holders are always eligible — the consecutive-month and
  // quarterly restrictions do not apply to them (per program rules).
  // Standard users are still filtered through the normal ineligibility check.
  let pool = allEntrants.filter(
    (e) => e.alwaysEligible || !ineligible.has(e.userId),
  );
  if (pool.length === 0) {
    throw new Error(
      'No eligible entrants for this month after applying consecutive-month ' +
      'and quarterly winner restrictions. All entrants have won recently.',
    );
  }

  const totalEntries    = allEntrants.reduce((s, e) => s + e.entryCount, 0);
  const eligibleEntries = pool.reduce((s, e) => s + e.entryCount, 0);

  // Weighted random pick from the eligible pool
  let pick = Math.floor(Math.random() * eligibleEntries);
  let winner: EntrantRow | null = null;
  for (const e of pool) {
    pick -= e.entryCount;
    if (pick < 0) { winner = e; break; }
  }
  winner ??= pool[pool.length - 1]; // fallback (shouldn't occur)

  return { winner, totalEntries, entrantCount: allEntrants.length, month };
}

/** Persist the draw result — throws if draw already exists for this month */
export async function recordDraw(result: DrawResult, notes?: string) {
  return prisma.giveawayDraw.create({
    data: {
      id:           randomUUID(),
      month:        result.month,
      winnerId:     result.winner.userId,
      winnerName:   result.winner.name,
      winnerEmail:  result.winner.email,
      entryCount:   result.winner.entryCount,
      totalEntries: result.totalEntries,
      drawnAt:      new Date().toISOString(),
      notes:        notes ?? null,
    },
  });
}

/** All past draws, newest first */
export async function getDrawHistory() {
  return prisma.giveawayDraw.findMany({ orderBy: { drawnAt: 'desc' } });
}

/** Entry count for a single user in the given month */
export function entryCountForMonth(activeDays: string[], month: string): number {
  const prefix = `${month}-`;
  return activeDays.filter((d) => d.startsWith(prefix)).length;
}
