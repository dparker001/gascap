/**
 * Gamification G2 — weekly challenges read model (server only, READ-ONLY).
 *
 * Loads the authoritative state a user's three weekly challenges are derived from
 * and runs the pure selector/progress rules (lib/gasChallengesRules.ts). SELECTs
 * only: no ledger rows, no analytics, no badge/streak/giveaway/user writes. Awards
 * live in lib/gasChallengeAwards.ts, which reuses `loadWeekState` and
 * `selectionForState` below so the read model and the award hooks can never
 * disagree about which challenges a user has.
 *
 * Launch boundary: before G2_REWARDS_START_WEEK nothing is active — no challenges
 * are returned, so no customer is shown a challenge that cannot earn its reward.
 *
 * Progress sources (all authoritative server state):
 *  - `daily_fuel_check` ledger rows (their `sourceRef` is the GasCap date)
 *  - the `weekly_3day_check` ledger row for the week (G2 Challenge #1)
 *  - the challenge's own award row (`challenge_*`), which IS its completion
 *  - saved-vehicle existence (guidance + slot-3 selection)
 */
import { prisma } from './prisma';
import { gasCapWeekKey, weekDateKeys } from './gasCapCalendar';
import { gasPointKeys } from './gasPointsRules';
import { getEligibility } from './gasPoints';
import {
  G2_CHALLENGE_VERSION, G2_REWARDS_START_WEEK, buildWeeklyChallengeViews, isG2Active, selectWeeklyChallenges,
  type ChallengeView, type ProgressContext, type WeeklySelection,
} from './gasChallengesRules';

export interface WeekState {
  weekKey: string;
  /** GasCap dates of this week's `daily_fuel_check` rows. */
  checkDates: string[];
  weeklyMissionAwarded: boolean;
  /** `challenge_*` award actions already written for this week. */
  challengeAwards: string[];
  hasVehicle: boolean;
}

const CHALLENGE_ACTIONS = ['challenge_weekend_check', 'challenge_fuel_explorer', 'challenge_pump_tracker', 'challenge_mpg_builder'];

/** One round of SELECTs describing the user's authoritative weekly state. */
export async function loadWeekState(userId: string, weekKey: string): Promise<WeekState> {
  const dates = weekDateKeys(weekKey);
  const [rows, weeklyRow, vehicles] = await Promise.all([
    prisma.gasPointLedger.findMany({
      where: { userId, action: { in: ['daily_fuel_check', ...CHALLENGE_ACTIONS] }, sourceRef: { in: [...dates, weekKey] } },
      select: { action: true, sourceRef: true },
    }),
    prisma.gasPointLedger.findUnique({ where: { idempotencyKey: gasPointKeys.weekly(userId, weekKey) }, select: { id: true } }),
    prisma.vehicle.count({ where: { userId } }),
  ]);
  return {
    weekKey,
    checkDates: rows.filter((r) => r.action === 'daily_fuel_check' && r.sourceRef).map((r) => r.sourceRef as string),
    weeklyMissionAwarded: !!weeklyRow,
    challengeAwards: rows.filter((r) => CHALLENGE_ACTIONS.includes(r.action)).map((r) => r.action),
    hasVehicle: vehicles > 0,
  };
}

/** The authoritative weekly selection for a loaded state (pure; server-derived). */
export function selectionForState(userId: string, state: WeekState, opts?: { pumpTrackerComplete?: boolean }): WeeklySelection {
  return selectWeeklyChallenges({
    userId,
    weekKey: state.weekKey,
    hasVehicle: state.hasVehicle,
    // MPG Builder is never offered in g2_v1 (MPG_BUILDER_SELECTABLE), so no odometer lookup runs.
    mpgBuilderAvailable: false,
    pumpTrackerComplete: opts?.pumpTrackerComplete ?? state.challengeAwards.includes('challenge_pump_tracker'),
  });
}

export interface WeeklyChallengesResult {
  eligible: boolean;
  /** False before G2_REWARDS_START_WEEK: no challenges are returned or rewardable. */
  g2Active: boolean;
  /** The first rewardable GasCap week (Monday). */
  startsOn: string;
  weekKey: string;
  version: string;
  challenges: ChallengeView[];
}

export async function getWeeklyChallenges(userId: string, now: Date = new Date()): Promise<WeeklyChallengesResult> {
  const weekKey = gasCapWeekKey(now);
  const base = { weekKey, version: G2_CHALLENGE_VERSION, startsOn: G2_REWARDS_START_WEEK };
  const elig = await getEligibility(userId);
  if (!elig.eligible) return { ...base, eligible: false, g2Active: false, challenges: [] };
  if (!isG2Active(weekKey)) return { ...base, eligible: true, g2Active: false, challenges: [] };

  const state = await loadWeekState(userId, weekKey);
  const ctx: ProgressContext = {
    weekKey, checkDates: state.checkDates, weeklyMissionAwarded: state.weeklyMissionAwarded, challengeAwards: state.challengeAwards,
  };
  const selection = selectionForState(userId, state);
  return { ...base, eligible: true, g2Active: true, version: selection.version, challenges: buildWeeklyChallengeViews(selection, ctx) };
}
