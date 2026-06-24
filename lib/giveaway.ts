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

/**
 * Mask a winner's full name to "First L." for all user-facing surfaces.
 * Admin routes should use the raw name from the DB directly.
 * e.g. "John Doe" → "John D."  |  "Maria Garcia Lopez" → "Maria L."
 */
export function maskWinnerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? fullName;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

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

/** Count of currently active paying Pro + Fleet subscribers (excludes trial members) */
export async function countPayingSubscribers(): Promise<number> {
  return prisma.user.count({
    where: { plan: { in: ['pro', 'fleet'] }, isProTrial: false },
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
  trialCount:      number;
  currentTier:     PrizeTier;
  nextTier:        PrizeTier | null;
}> {
  const [subscriberCount, trialCount] = await Promise.all([
    countPayingSubscribers(),
    prisma.user.count({ where: { plan: 'pro', isProTrial: true } }),
  ]);
  return {
    subscriberCount,
    trialCount,
    currentTier: tierForCount(subscriberCount),
    nextTier:    nextTierForCount(subscriberCount),
  };
}

/** Bonus entries per draw period for Pro Annual members. */
export const ANNUAL_BONUS_ENTRIES = 10;

/**
 * Bonus entries per draw period for Pro Lifetime members with active Perks renewal.
 * Lifetime members whose Perks have lapsed receive ANNUAL_BONUS_ENTRIES instead.
 */
export const LIFETIME_BONUS_ENTRIES = 20;

export interface EntrantRow {
  userId:          string;
  name:            string;
  email:           string;
  plan:            string;
  stripeInterval:  string | null;
  streak:          number;
  referralCount:   number;
  ambassadorTier:  AmbassadorTier;
  entryMultiplier: number;        // 1× standard, 2× Supporter, 3× Ambassador, 5× Elite
  baseEntries:     number;        // active days × entryMultiplier
  streakBonus:     number;        // flat bonus from streak tier (not multiplied)
  earlyUpgradeBonusEntries:    number; // +10 bonus for trial-to-paid conversions
  garageBonusEntries:          number; // +10/day for tapping to open garage (Pro+)
  verifyReminderBonusEntries:  number; // +25 one-time for verifying email within 7 days of reminder
  phoneBonusEntries:           number; // +25 one-time for adding phone number in settings
  dailyBonusEntries:           number; // 3–15/day from the daily gift box badge
  lifetimeBonusEntries:        number; // +20 (active Perks) or +10 (lapsed/Annual) per period
  entryCount:      number;        // baseEntries + streakBonus + earlyUpgrade + garageBonus + verifyReminderBonus + phoneBonus + dailyBonus + lifetimeBonus
  alwaysEligible:  boolean;       // true for Ambassador tier holders — skip win restrictions
  loginCount:      number;        // lifetime login count (engagement signal for draw review)
  lastLoginAt:     string | null; // ISO timestamp of most recent login, or null if never recorded
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

// ── Cadence layer ───────────────────────────────────────────────────────────
// The draw "period" is stored in GiveawayDraw.month (kept as the column name to
// avoid a schema migration). For weekly it holds an ISO-week key "YYYY-Www";
// for monthly the existing "YYYY-MM". Built cadence-agnostic so 'daily' is a
// later flag flip. Override with env GIVEAWAY_CADENCE.

export type Cadence = 'weekly' | 'monthly' | 'daily';

export const GIVEAWAY_CADENCE: Cadence =
  (process.env.GIVEAWAY_CADENCE as Cadence) || 'weekly';

/** ISO-8601 week key for a date, e.g. 2026-07-03 → "2026-W27" (weeks are Mon–Sun). */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;            // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);         // shift to the week's Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The current draw-period key for the configured cadence. */
export function currentPeriod(cadence: Cadence = GIVEAWAY_CADENCE): string {
  if (cadence === 'weekly') return isoWeekKey(new Date());
  if (cadence === 'daily')  return new Date().toISOString().slice(0, 10);
  return currentMonth();
}

/** Inclusive [startYMD, endYMD] date range covered by a period key. */
export function periodRange(period: string): [string, string] {
  if (period.includes('W')) {
    // ISO week "YYYY-Www" → Mon…Sun. Week 1 is the week containing Jan 4.
    const [yStr, wStr] = period.split('-W');
    const y = Number(yStr), w = Number(wStr);
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const jan4Day = (jan4.getUTCDay() + 6) % 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - jan4Day + (w - 1) * 7);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)];
  }
  if (period.length === 10) return [period, period];   // daily "YYYY-MM-DD"
  const [y, m] = period.split('-').map(Number);        // monthly "YYYY-MM"
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end   = new Date(Date.UTC(y, m, 0));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

/** Count of activeDays (YYYY-MM-DD strings) that fall within a draw period. */
export function activeDaysInPeriod(activeDays: string[], period: string): number {
  if (!period.includes('W') && period.length === 7) {
    return activeDays.filter((d) => d.startsWith(`${period}-`)).length;  // fast path: month prefix
  }
  const [start, end] = periodRange(period);
  return activeDays.filter((d) => d >= start && d <= end).length;
}

/**
 * Format a period key into a human-readable label.
 * "2026-W27" → "Week of Jun 29 – Jul 5, 2026"
 * "2026-06"  → "June 2026"
 * "2026-06-24" → "June 24, 2026"
 */
export function formatPeriodLabel(period: string): string {
  if (period.includes('W')) {
    const [start, end] = periodRange(period);
    const fmt = (d: string) => {
      const dt = new Date(`${d}T00:00:00Z`);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };
    const year = period.split('-')[0];
    const endStr = fmt(end);
    // Include year only on the end date to avoid "Jun 29, 2026 – Jul 5, 2026"
    const endWithYear = new Date(`${end}T00:00:00Z`)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `Week of ${fmt(start)} – ${endWithYear}`;
  }
  if (period.length === 10) {
    return new Date(`${period}T00:00:00Z`)
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  const [y, m] = period.split('-').map(Number);
  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Return a label for the NEXT draw period after the given one.
 * Used in non-winner emails: "tune in for next week's drawing."
 * "2026-W27" → "next week's"
 * "2026-06"  → "the July 2026"
 */
export function nextPeriodLabel(period: string): string {
  if (period.includes('W')) return "next week's";
  // Monthly: compute next month
  const [y, m] = period.split('-').map(Number);
  const nextMo   = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  const MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `the ${MONTH_NAMES[nextMo - 1]} ${nextYear}`;
}

// ─── Winner cooldown ──────────────────────────────────────────────────────────

/** Number of weeks a recent winner is ineligible after a weekly draw. */
export const WINNER_COOLDOWN_WEEKS = 4;

/** Return the UTC Monday Date for a given ISO-week period key "YYYY-Www". */
function mondayOfIsoWeek(period: string): Date {
  const [yStr, wStr] = period.split('-W');
  const y = Number(yStr), w = Number(wStr);
  const jan4    = new Date(Date.UTC(y, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const mon     = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - jan4Day + (w - 1) * 7);
  return mon;
}

/**
 * Given a draw period and the full draw history, return the set of
 * winner userIds who are ineligible to win again.
 *
 * Weekly cadence: blocks anyone who won within the last WINNER_COOLDOWN_WEEKS weeks.
 * Monthly cadence (legacy): blocks consecutive-month wins + same-quarter wins.
 *
 * Ambassador tier holders bypass these restrictions (checked in runWeightedDraw).
 */
export function ineligibleWinners(
  drawPeriod: string,
  history: { winnerId: string; month: string }[],
): Set<string> {
  const ineligible = new Set<string>();

  if (drawPeriod.includes('W')) {
    // Weekly cooldown: any win in the preceding WINNER_COOLDOWN_WEEKS weeks
    const drawMonday = mondayOfIsoWeek(drawPeriod).getTime();
    const cutoffMs   = WINNER_COOLDOWN_WEEKS * 7 * 24 * 60 * 60 * 1000;
    for (const d of history) {
      if (d.month === drawPeriod) continue;
      if (!d.month.includes('W')) continue;  // ignore cross-cadence draws
      const dMonday = mondayOfIsoWeek(d.month).getTime();
      if (dMonday >= drawMonday - cutoffMs && dMonday < drawMonday) {
        ineligible.add(d.winnerId);
      }
    }
    return ineligible;
  }

  // Monthly legacy rules
  const prev  = prevMonth(drawPeriod);
  const drawQ = quarterForMonth(drawPeriod);
  const drawY = yearForMonth(drawPeriod);

  for (const d of history) {
    if (d.month === drawPeriod) continue;
    if (d.month === prev) ineligible.add(d.winnerId);
    if (yearForMonth(d.month) === drawY && quarterForMonth(d.month) === drawQ) {
      ineligible.add(d.winnerId);
    }
  }
  return ineligible;
}

/**
 * Hard exclusion list — these accounts (the Sponsor and immediate family) can
 * never be drawn or qualify, per Section 2 of the Official Rules. Keyed by email
 * (lowercase) rather than name, since names are neither unique nor stable.
 */
const EXCLUDED_EMAILS = new Set<string>([
  'dparker001@gmail.com',      // Don Parker (Sponsor)
  'donwparker1969@gmail.com',  // Donald Parker
  'servant4hire@gmail.com',    // Donovan Parker
  'livetotravelnow@gmail.com', // Madlon T Parker
  'green.bilena@yahoo.com',    // Bilena Green
]);

/** All Pro/Fleet users with ≥1 active day in the given draw period, excluding test accounts. */
export async function getEligibleEntrants(period: string = currentPeriod()): Promise<EntrantRow[]> {
  const users  = await prisma.user.findMany({
    where: {
      plan:          { in: ['pro', 'fleet'] },
      isTestAccount: { not: true },   // exclude test/internal accounts from draws
      emailVerified: true,            // only verified emails are eligible to win
      email:         { notIn: Array.from(EXCLUDED_EMAILS) }, // Sponsor + family
    },
    select: {
      id: true, name: true, email: true, plan: true, stripeInterval: true,
      lifetimePerksUntil: true,
      activeDays: true, streak: true, referralCount: true,
      earlyUpgradeBonusEntries: true,
      garageBonusDays: true,
      verifyReminderBonusEntries: true,
      phoneBonusEntries: true,
      dailyBonusEntries: true,
      loginCount: true,
      lastLoginAt: true,
    },
  });

  return users
    .map((u) => {
      const refCount      = u.referralCount ?? 0;
      const multiplier    = ambassadorEntryMultiplier(refCount);
      const activeDayCount = activeDaysInPeriod(u.activeDays ?? [], period);
      const baseEntries   = activeDayCount * multiplier;  // multiplier applied to active days
      const streakBonus   = streakBonusEntries(u.streak ?? 0);
      const bonusEntries  = u.earlyUpgradeBonusEntries ?? 0;
      // Garage bonus: +10 per day user tapped to open their garage this period
      const garageDaysThisMonth = activeDaysInPeriod(u.garageBonusDays ?? [], period);
      const garageBonusEntries         = garageDaysThisMonth * 10;
      const verifyReminderBonusEntries = u.verifyReminderBonusEntries ?? 0;
      const phoneBonusEntries          = u.phoneBonusEntries          ?? 0;
      const dailyBonusEntries          = u.dailyBonusEntries          ?? 0;
      const perksActive          = u.stripeInterval === 'lifetime'
        && u.lifetimePerksUntil != null
        && new Date(u.lifetimePerksUntil) > new Date();
      const lifetimeBonusEntries = u.stripeInterval === 'lifetime'
        ? (perksActive ? LIFETIME_BONUS_ENTRIES : ANNUAL_BONUS_ENTRIES)
        : u.stripeInterval === 'annual'
        ? ANNUAL_BONUS_ENTRIES
        : 0;
      return {
        userId:          u.id,
        name:            u.name,
        email:           u.email,
        plan:            u.plan,
        stripeInterval:  u.stripeInterval ?? null,
        streak:          u.streak ?? 0,
        referralCount:   refCount,
        ambassadorTier:  getAmbassadorTier(refCount),
        entryMultiplier: multiplier,
        baseEntries,
        streakBonus,
        earlyUpgradeBonusEntries: bonusEntries,
        garageBonusEntries,
        verifyReminderBonusEntries,
        phoneBonusEntries,
        dailyBonusEntries,
        lifetimeBonusEntries,
        entryCount:      baseEntries + streakBonus + bonusEntries + garageBonusEntries + verifyReminderBonusEntries + phoneBonusEntries + dailyBonusEntries + lifetimeBonusEntries,
        alwaysEligible:  isAlwaysEligible(refCount),
        loginCount:      u.loginCount ?? 0,
        lastLoginAt:     u.lastLoginAt ?? null,
      };
    })
    .filter((u) => u.baseEntries > 0)  // must have used the app at least once this month
    // Defensive exclusion (in case of any email casing drift past the DB query)
    .filter((u) => !EXCLUDED_EMAILS.has(u.email.toLowerCase()))
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

/** Mark winner as having confirmed receipt of their prize */
export async function markWinnerClaimed(month: string) {
  return prisma.giveawayDraw.update({
    where: { month },
    data:  { claimedAt: new Date().toISOString() },
  });
}

/**
 * Return draws older than 3 days that have not been confirmed by the winner.
 * Used by the daily cron to alert admin.
 */
export async function getUnclaimedDraws(): Promise<typeof draws> {
  const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const draws  = await prisma.giveawayDraw.findMany({
    where: { claimedAt: null, drawnAt: { lt: cutoff } },
  });
  return draws;
}

/** Entry count for a single user in the given draw period. */
export function entryCountForPeriod(activeDays: string[], period: string): number {
  return activeDaysInPeriod(activeDays, period);
}

/** @deprecated Use entryCountForPeriod */
export function entryCountForMonth(activeDays: string[], month: string): number {
  return entryCountForPeriod(activeDays, month);
}

/**
 * Re-draw from the remaining pool after a winner forfeiture.
 * Excludes the forfeited winner's userId and re-applies the standard
 * ineligibility rules (consecutive-month + quarterly restrictions).
 * Ambassador tier holders remain always-eligible per program rules.
 */
export async function runAlternateWeightedDraw(
  month: string,
  excludeUserId: string,
): Promise<DrawResult> {
  const [allEntrants, history] = await Promise.all([
    getEligibleEntrants(month),
    getDrawHistory(),
  ]);

  // Remove the forfeited winner from the pool entirely
  const remaining = allEntrants.filter((e) => e.userId !== excludeUserId);
  if (remaining.length === 0) {
    throw new Error('No remaining entrants after excluding the forfeited winner.');
  }

  // Re-apply ineligibility rules — exclude the forfeited winner's prior draw
  // from history so it doesn't block others unfairly
  const historyWithoutForfeited = history.filter((d) => d.winnerId !== excludeUserId);
  const ineligible = ineligibleWinners(month, historyWithoutForfeited);

  const pool = remaining.filter((e) => e.alwaysEligible || !ineligible.has(e.userId));
  if (pool.length === 0) {
    throw new Error('No eligible alternate entrants for this month after applying winner restrictions.');
  }

  const totalEntries    = allEntrants.reduce((s, e) => s + e.entryCount, 0);
  const eligibleEntries = pool.reduce((s, e) => s + e.entryCount, 0);

  let pick = Math.floor(Math.random() * eligibleEntries);
  let winner: EntrantRow | null = null;
  for (const e of pool) {
    pick -= e.entryCount;
    if (pick < 0) { winner = e; break; }
  }
  winner ??= pool[pool.length - 1];

  return { winner, totalEntries, entrantCount: allEntrants.length, month };
}

/**
 * Replace the winner on an existing draw record (alternate selection).
 * Preserves the original draw's id and month; updates all winner fields
 * and appends a forfeit note for the audit trail.
 */
export async function updateDrawWinner(
  month: string,
  result: DrawResult,
  forfeited: { name: string; email: string },
  notes?: string,
) {
  const forfeitNote =
    `Alternate draw ${new Date().toISOString().slice(0, 10)}: ` +
    `original winner ${forfeited.name} (${forfeited.email}) forfeited — ` +
    `did not claim within 3 days of notification.`;

  return prisma.giveawayDraw.update({
    where: { month },
    data: {
      winnerId:     result.winner.userId,
      winnerName:   result.winner.name,
      winnerEmail:  result.winner.email,
      entryCount:   result.winner.entryCount,
      totalEntries: result.totalEntries,
      drawnAt:      new Date().toISOString(),
      claimedAt:    null,   // reset — new winner must claim
      notes:        [forfeitNote, notes ?? ''].filter(Boolean).join(' '),
    },
  });
}
