/**
 * Gamification G2-B — server-authoritative weekly challenge awards.
 *
 * Every award here is derived on the server from first principles; nothing the
 * client sends can name a challenge, a point amount or an idempotency key:
 *
 *   1. the GasCap week must be >= G2_REWARDS_START_WEEK (no partial first week);
 *   2. the user must be GasPoints-eligible (admins never earn);
 *   3. the challenge must be in the user's AUTHORITATIVE weekly set (same selector
 *      and state loader as the read model) — a challenge that is not selected is
 *      never rewarded;
 *   4. the underlying business action must already have persisted (the G1 daily
 *      check row / fuel_action row exists) — these hooks run AFTER it;
 *   5. one reward per challenge per user per week via the ledger's unique key
 *      `challenge:<id>:<userId>:<weekKey>` (concurrent or repeated requests award 0).
 *
 * Best-effort by design: the legitimate business action (the daily check, the
 * fill-up) is always primary. Every entry point here swallows and logs its own
 * errors so a challenge failure can never fail or roll back the real action.
 * MPG Builder has NO award path: it is non-selectable in g2_v1.
 *
 * Imports flow one way (gasChallengeAwards -> gasChallenges / gasPoints /
 * gasChallengesRules); none of those import this module, so there is no cycle.
 */
import { prisma } from './prisma';
import { gasCapDateKey, gasCapWeekKey } from './gasCapCalendar';
import { PULSE_GRADES, defaultPulseGrade } from './fuelPulse';
import { GASPOINT_RULES, gasPointKeys, type AwardSummary } from './gasPointsRules';
import { awardOnce, completeDailyCheck, getEligibility, getStatus, qualifiesForFuelPoints, type DailyCheckResult } from './gasPoints';
import {
  AWARDABLE_CHALLENGES, PLANNED_REWARDS, challengeIdempotencyKey, isG2Active, isWeekendDateKey,
  type AwardableChallengeId,
} from './gasChallengesRules';
import { loadWeekState, selectionForState } from './gasChallenges';

/** Insert the ONE award for a challenge this week; null if it already exists. */
async function awardChallenge(userId: string, id: AwardableChallengeId, weekKey: string): Promise<AwardSummary | null> {
  if (!(AWARDABLE_CHALLENGES as readonly string[]).includes(id)) return null;   // MPG Builder (and anything else) can never be awarded
  const action = PLANNED_REWARDS[id].action as keyof typeof GASPOINT_RULES;
  const created = await awardOnce(userId, action, challengeIdempotencyKey(id, userId, weekKey), weekKey);
  return created ? { action, points: GASPOINT_RULES[action] } : null;
}

/** Eligibility + launch gate shared by every hook. Returns the week key, or null if no G2 award is possible. */
async function activeWeekFor(userId: string, now: Date): Promise<string | null> {
  const weekKey = gasCapWeekKey(now);
  if (!isG2Active(weekKey)) return null;
  const elig = await getEligibility(userId);
  return elig.eligible ? weekKey : null;
}

/** +10 when slot 2 is Weekend Check and a Daily Fuel Check was completed on a GasCap Saturday/Sunday. */
export async function awardWeekendCheckIfEligible(userId: string, now: Date = new Date()): Promise<AwardSummary | null> {
  try {
    const weekKey = await activeWeekFor(userId, now);
    if (!weekKey) return null;
    const todayKey = gasCapDateKey(now);
    if (!isWeekendDateKey(todayKey)) return null;
    const state = await loadWeekState(userId, weekKey);
    if (selectionForState(userId, state).slot2 !== 'weekend_check') return null;
    // The G1 daily check for TODAY must already be persisted.
    const row = await prisma.gasPointLedger.findUnique({ where: { idempotencyKey: gasPointKeys.dailyCheck(userId, todayKey) }, select: { id: true } });
    if (!row) return null;
    return await awardChallenge(userId, 'weekend_check', weekKey);
  } catch (e) {
    console.error('[GasChallenges] weekend_check award failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export type ExploreOutcome =
  | 'awarded' | 'already_complete' | 'not_active' | 'ineligible' | 'not_selected' | 'no_daily_check' | 'same_grade' | 'invalid_grade' | 'error';

/** +15 when slot 2 is Fuel Explorer, a Daily Check exists this week, and the grade differs from the server-derived default. */
export async function awardFuelExplorerIfEligible(
  userId: string, grade: unknown, now: Date = new Date(),
): Promise<{ outcome: ExploreOutcome; award: AwardSummary | null }> {
  try {
    if (typeof grade !== 'string' || !(PULSE_GRADES as string[]).includes(grade)) return { outcome: 'invalid_grade', award: null };
    const weekKey = gasCapWeekKey(now);
    if (!isG2Active(weekKey)) return { outcome: 'not_active', award: null };
    if (!(await getEligibility(userId)).eligible) return { outcome: 'ineligible', award: null };
    const state = await loadWeekState(userId, weekKey);
    if (selectionForState(userId, state).slot2 !== 'fuel_explorer') return { outcome: 'not_selected', award: null };
    if (state.challengeAwards.includes('challenge_fuel_explorer')) return { outcome: 'already_complete', award: null };
    if (state.checkDates.length === 0) return { outcome: 'no_daily_check', award: null };
    // The default is derived HERE from the user's own data — the client never says what it was.
    if (grade === (await defaultPulseGrade(userId))) return { outcome: 'same_grade', award: null };
    const award = await awardChallenge(userId, 'fuel_explorer', weekKey);
    return { outcome: award ? 'awarded' : 'already_complete', award };
  } catch (e) {
    console.error('[GasChallenges] fuel_explorer award failed:', e instanceof Error ? e.message : e);
    return { outcome: 'error', award: null };
  }
}

/**
 * +25 when slot 3 is Pump Tracker and a qualifying fuel action is persisted. Call
 * AFTER the G1 fuel_action award. Selection is evaluated from the user's state at
 * this moment (a user with no vehicle is on `add_vehicle`, so their fill-up does
 * not retroactively become a Pump Tracker completion).
 */
export async function awardPumpTrackerIfEligible(userId: string, now: Date = new Date()): Promise<AwardSummary | null> {
  try {
    const weekKey = await activeWeekFor(userId, now);
    if (!weekKey) return null;
    const state = await loadWeekState(userId, weekKey);
    if (selectionForState(userId, state).slot3 !== 'pump_tracker') return null;
    // A persisted qualifying fuel action for today's GasCap date must exist (the G1 once-per-day row).
    const fuel = await prisma.gasPointLedger.findUnique({
      where: { idempotencyKey: gasPointKeys.fuelAction(userId, gasCapDateKey(now)) }, select: { id: true },
    });
    if (!fuel) return null;
    return await awardChallenge(userId, 'pump_tracker', weekKey);
  } catch (e) {
    console.error('[GasChallenges] pump_tracker award failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Challenge awards that follow a persisted fuel record. The G1 fuel_action award has
 * already been attempted by the caller; this only evaluates Pump Tracker, and only
 * for a record that qualifies (EV/kWh and invalid records never satisfy it).
 */
export async function awardChallengesAfterFuelAction(
  userId: string,
  record: { gallons: number; pricePerGallon: number; totalCost: number; energyUnit?: string | null },
  now: Date = new Date(),
): Promise<AwardSummary[]> {
  if (!qualifiesForFuelPoints(record)) return [];
  const pump = await awardPumpTrackerIfEligible(userId, now);
  return pump ? [pump] : [];
}

/**
 * The G1 Daily Fuel Check, then (best effort) the Weekend Check challenge. The G1
 * result is returned unchanged if the challenge step fails or does not apply; when a
 * challenge reward is earned it is appended to `awards` and the status is refreshed.
 */
export async function completeDailyCheckWithChallenges(
  userId: string, now: Date = new Date(),
): Promise<DailyCheckResult | { ineligible: true }> {
  const result = await completeDailyCheck(userId, now);
  if ('ineligible' in result) return result;
  try {
    const weekend = await awardWeekendCheckIfEligible(userId, now);
    if (weekend) {
      return {
        ...result,
        awards: [...result.awards, weekend],
        totalAwarded: result.totalAwarded + weekend.points,
        status: await getStatus(userId, now),
      };
    }
  } catch (e) {
    console.error('[GasChallenges] daily-check challenge step failed:', e instanceof Error ? e.message : e);
  }
  return result;
}

