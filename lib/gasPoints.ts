/**
 * Gamification G1 — GasPoints ledger operations (server only).
 *
 * Append-only: awards are INSERTs into "GasPointLedger"; nothing is ever
 * updated or deleted here. The balance is derived (SUM) — never stored on User.
 * An award is atomic: it either inserts a row or loses to the unique
 * idempotencyKey (Postgres 23505 / Prisma P2002) and awards zero, so retries,
 * double-clicks and concurrent requests cannot duplicate points.
 *
 * The server owns all rules (lib/gasPointsRules.ts): no function here accepts a
 * point amount or an idempotency key from a caller.
 *
 * Eligibility: real signed-in users and the dedicated test account (so QA can
 * exercise the loop). Admin accounts never earn. Test accounts are excluded from
 * reporting aggregates, not from earning.
 *
 * GasPoints are separate from giveaway entries, the visit streak and badges —
 * none of those tables/columns is read-for-write or written here. (The existing
 * `User.streak` is only READ, for display.)
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@/lib/generated/prisma/client';
import { prisma } from './prisma';
import { gasCapDateKey, gasCapWeekKey, weekDateKeys } from './gasCapCalendar';
import { isQualifyingFuelAction } from './activationMetrics';
import {
  GASPOINT_RULES, WEEKLY_MISSION_TARGET, gasPointKeys, levelFor,
  type AwardSummary, type GasPointAction, type LevelInfo,
} from './gasPointsRules';

export interface GasPointsEligibility { eligible: boolean; isTestAccount: boolean }

/** Role / test flag are read live from the DB, never from the JWT. */
export async function getEligibility(userId: string): Promise<GasPointsEligibility> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isTestAccount: true } });
  if (!u) return { eligible: false, isTestAccount: false };
  return { eligible: u.role !== 'admin', isTestAccount: !!u.isTestAccount };
}

/**
 * Insert ONE award. Returns true only if THIS call created the row. Points come
 * from the server rule table by action. A duplicate key (or a deleted user's FK
 * failure) awards zero rather than throwing.
 */
export async function awardOnce(
  userId: string,
  action: GasPointAction,
  idempotencyKey: string,
  sourceRef: string | null = null,
): Promise<boolean> {
  try {
    await prisma.gasPointLedger.create({
      data: { id: randomUUID(), userId, action, points: GASPOINT_RULES[action], idempotencyKey, sourceRef },
      select: { id: true },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2002' || err.code === 'P2003')) return false;
    throw err;
  }
}

/** Lifetime balance = SUM(points). */
export async function getBalance(userId: string): Promise<number> {
  const r = await prisma.gasPointLedger.aggregate({ where: { userId }, _sum: { points: true } });
  return r._sum.points ?? 0;
}

export interface WeeklyProgress {
  weekKey: string;
  /** Distinct GasCap days with a Daily Fuel Check this week (can exceed the target). */
  checks: number;
  target: number;
  complete: boolean;
}

async function weeklyChecks(userId: string, weekKey: string): Promise<number> {
  const rows = await prisma.gasPointLedger.findMany({
    where: { userId, action: 'daily_fuel_check', sourceRef: { in: weekDateKeys(weekKey) } },
    select: { sourceRef: true },
  });
  return new Set(rows.map((r) => r.sourceRef)).size;
}

export interface GasPointsStatus {
  eligible: boolean;
  balance: number;
  level: LevelInfo;
  todayKey: string;
  checkedToday: boolean;
  week: WeeklyProgress;
  /** The existing visit streak, READ-ONLY (never modified here). */
  streak: number;
}

export async function getStatus(userId: string, now: Date = new Date()): Promise<GasPointsStatus> {
  const todayKey = gasCapDateKey(now);
  const weekKey = gasCapWeekKey(now);
  const [elig, balance, today, checks, user] = await Promise.all([
    getEligibility(userId),
    getBalance(userId),
    prisma.gasPointLedger.findUnique({ where: { idempotencyKey: gasPointKeys.dailyCheck(userId, todayKey) }, select: { id: true } }),
    weeklyChecks(userId, weekKey),
    prisma.user.findUnique({ where: { id: userId }, select: { streak: true } }),
  ]);
  return {
    eligible: elig.eligible,
    balance,
    level: levelFor(balance),
    todayKey,
    checkedToday: !!today,
    week: { weekKey, checks, target: WEEKLY_MISSION_TARGET, complete: checks >= WEEKLY_MISSION_TARGET },
    streak: user?.streak ?? 0,
  };
}

export interface DailyCheckResult {
  /** Rows THIS call created (empty on a repeat the same day). */
  awards: AwardSummary[];
  totalAwarded: number;
  alreadyChecked: boolean;
  status: GasPointsStatus;
}

/**
 * The explicit Daily Fuel Check. Atomically evaluates, in order: the daily
 * reward, the one-time welcome bonus, and the weekly 3-day mission. Every step
 * is an idempotent insert, so a repeat the same day (or a concurrent call)
 * returns the existing state and awards zero.
 */
export async function completeDailyCheck(userId: string, now: Date = new Date()): Promise<DailyCheckResult | { ineligible: true }> {
  const elig = await getEligibility(userId);
  if (!elig.eligible) return { ineligible: true };

  const dateKey = gasCapDateKey(now);
  const weekKey = gasCapWeekKey(now);
  const awards: AwardSummary[] = [];

  const dailyNew = await awardOnce(userId, 'daily_fuel_check', gasPointKeys.dailyCheck(userId, dateKey), dateKey);
  if (dailyNew) awards.push({ action: 'daily_fuel_check', points: GASPOINT_RULES.daily_fuel_check });

  // The welcome bonus belongs to the FIRST check ever; its lifetime key makes
  // every later attempt a no-op (and recovers a prior crash between the two inserts).
  if (await awardOnce(userId, 'welcome_bonus', gasPointKeys.welcome(userId))) {
    awards.unshift({ action: 'welcome_bonus', points: GASPOINT_RULES.welcome_bonus });
  }

  // Weekly mission: evaluated whenever the week already has 3 distinct check days.
  const checks = await weeklyChecks(userId, weekKey);
  if (checks >= WEEKLY_MISSION_TARGET) {
    if (await awardOnce(userId, 'weekly_3day_check', gasPointKeys.weekly(userId, weekKey), weekKey)) {
      awards.push({ action: 'weekly_3day_check', points: GASPOINT_RULES.weekly_3day_check });
    }
  }

  const status = await getStatus(userId, now);
  return {
    awards,
    totalAwarded: awards.reduce((s, a) => s + a.points, 0),
    alreadyChecked: !dailyNew,
    status,
  };
}

// ── Integration awards (called ONLY after the underlying record persisted) ──

async function awardForSafe(
  userId: string, action: GasPointAction, key: string, sourceRef: string | null,
): Promise<AwardSummary | null> {
  try {
    const elig = await getEligibility(userId);
    if (!elig.eligible) return null;
    return (await awardOnce(userId, action, key, sourceRef)) ? { action, points: GASPOINT_RULES[action] } : null;
  } catch (e) {
    // Rewards must never fail the user's real action.
    console.error(`[GasPoints] ${action} award failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export function awardFirstVehicle(userId: string): Promise<AwardSummary | null> {
  return awardForSafe(userId, 'first_vehicle', gasPointKeys.firstVehicle(userId), null);
}

export function awardFirstSavedStation(userId: string): Promise<AwardSummary | null> {
  return awardForSafe(userId, 'first_saved_station', gasPointKeys.firstStation(userId), null);
}

/** +50 once per GasCap day, keyed on when the record was LOGGED (not the fill date). */
export function awardFuelAction(userId: string, now: Date = new Date()): Promise<AwardSummary | null> {
  const dateKey = gasCapDateKey(now);
  return awardForSafe(userId, 'fuel_action', gasPointKeys.fuelAction(userId, dateKey), dateKey);
}

/**
 * Only a VALID, gallon-based fuel record may earn the fuel-action reward (the
 * Phase 1 activation universe): positive gallons and cost, a plausible unit price,
 * and never an EV/kWh record. Called with values read back from the PERSISTED row.
 */
export function qualifiesForFuelPoints(r: {
  gallons: number; pricePerGallon: number; totalCost: number; energyUnit?: string | null;
}): boolean {
  return isQualifyingFuelAction({
    userId: '', source: 'personal', createdAt: '',
    gallons: r.gallons, pricePerGallon: r.pricePerGallon, totalCost: r.totalCost,
    energyUnit: r.energyUnit === 'kwh' ? 'kwh' : 'gal',
  });
}

/** Award the +50 for a persisted fuel record, but only when it qualifies. */
export async function awardFuelActionIfQualifying(
  userId: string,
  record: { gallons: number; pricePerGallon: number; totalCost: number; energyUnit?: string | null },
  now: Date = new Date(),
): Promise<AwardSummary | null> {
  if (!qualifiesForFuelPoints(record)) return null;
  return awardFuelAction(userId, now);
}
