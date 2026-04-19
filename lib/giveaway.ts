/**
 * Monthly Gas Card Giveaway
 *
 * Entries are derived from activeDays — each day a Pro/Fleet user is
 * active in the current calendar month counts as one entry (max ~31/month).
 * No separate entry counter is stored; everything is computed at draw time.
 *
 * Prize tiers scale automatically with the paying subscriber base.
 * Add a new row to PRIZE_TIERS (keep sorted by minSubscribers) to unlock
 * the next tier — no other code changes needed.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';

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
  userId:     string;
  name:       string;
  email:      string;
  plan:       string;
  entryCount: number;
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

/** All Pro/Fleet users with ≥1 active day in the given month */
export async function getEligibleEntrants(month: string): Promise<EntrantRow[]> {
  const prefix = `${month}-`;
  const users  = await prisma.user.findMany({
    where: { plan: { in: ['pro', 'fleet'] } },
    select: { id: true, name: true, email: true, plan: true, activeDays: true },
  });

  return users
    .map((u) => ({
      userId:     u.id,
      name:       u.name,
      email:      u.email,
      plan:       u.plan,
      entryCount: (u.activeDays ?? []).filter((d) => d.startsWith(prefix)).length,
    }))
    .filter((u) => u.entryCount > 0)
    .sort((a, b) => b.entryCount - a.entryCount);
}

/** Weighted random draw — more entries = proportionally better odds */
export async function runWeightedDraw(month: string): Promise<DrawResult> {
  const entrants = await getEligibleEntrants(month);
  if (entrants.length === 0) throw new Error('No eligible entrants for this month.');

  const totalEntries = entrants.reduce((s, e) => s + e.entryCount, 0);

  // Build weighted pool and pick
  let pick = Math.floor(Math.random() * totalEntries);
  let winner: EntrantRow | null = null;
  for (const e of entrants) {
    pick -= e.entryCount;
    if (pick < 0) { winner = e; break; }
  }
  winner ??= entrants[entrants.length - 1]; // fallback (shouldn't occur)

  return { winner, totalEntries, entrantCount: entrants.length, month };
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
