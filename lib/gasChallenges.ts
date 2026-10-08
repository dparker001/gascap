/**
 * Gamification G2-A — weekly challenges read model (server only, READ-ONLY).
 *
 * Loads the authoritative state a user's three weekly challenges are derived
 * from and runs the pure selector/progress rules (lib/gasChallengesRules.ts).
 * It performs SELECTs only: no ledger rows, no analytics, no badge/streak/giveaway
 * or user writes. The week comes from the canonical GasCap calendar.
 *
 * Progress sources (all authoritative G1 state):
 *  - `daily_fuel_check` ledger rows (their `sourceRef` is the GasCap date)
 *  - the `weekly_3day_check` ledger row for the week
 *  - `fuel_action` ledger rows (once/day, persisted-fill-up-backed)
 *  - saved-vehicle existence (guidance + slot-3 selection)
 */
import { prisma } from './prisma';
import { gasCapWeekKey, weekDateKeys } from './gasCapCalendar';
import { gasPointKeys } from './gasPointsRules';
import { getEligibility } from './gasPoints';
import {
  G2_CHALLENGE_VERSION, MPG_BUILDER_SELECTABLE, buildWeeklyChallengeViews, selectWeeklyChallenges,
  type ChallengeView, type ProgressContext,
} from './gasChallengesRules';

export interface WeeklyChallengesResult {
  eligible: boolean;
  weekKey: string;
  version: string;
  challenges: ChallengeView[];
}

export async function getWeeklyChallenges(userId: string, now: Date = new Date()): Promise<WeeklyChallengesResult> {
  const weekKey = gasCapWeekKey(now);
  const elig = await getEligibility(userId);
  if (!elig.eligible) return { eligible: false, weekKey, version: G2_CHALLENGE_VERSION, challenges: [] };

  const dates = weekDateKeys(weekKey);
  const [rows, weeklyRow, vehicles] = await Promise.all([
    prisma.gasPointLedger.findMany({
      where: { userId, action: { in: ['daily_fuel_check', 'fuel_action'] }, sourceRef: { in: dates } },
      select: { action: true, sourceRef: true },
    }),
    prisma.gasPointLedger.findUnique({ where: { idempotencyKey: gasPointKeys.weekly(userId, weekKey) }, select: { id: true } }),
    prisma.vehicle.count({ where: { userId } }),
  ]);

  const ctx: ProgressContext = {
    weekKey,
    checkDates: rows.filter((r) => r.action === 'daily_fuel_check' && r.sourceRef).map((r) => r.sourceRef as string),
    weeklyMissionAwarded: !!weeklyRow,
    fuelActionDates: rows.filter((r) => r.action === 'fuel_action' && r.sourceRef).map((r) => r.sourceRef as string),
  };

  // MPG history is only consulted if MPG Builder can ever be offered (it cannot in
  // g2_v1 — see MPG_BUILDER_SELECTABLE), so no extra query runs today.
  const mpgBuilderAvailable = MPG_BUILDER_SELECTABLE
    ? (await prisma.fillup.count({ where: { userId, odometerReading: { not: null } } })) >= 1
    : false;

  const selection = selectWeeklyChallenges({
    userId, weekKey, hasVehicle: vehicles > 0, mpgBuilderAvailable,
    pumpTrackerComplete: new Set(ctx.fuelActionDates).size >= 1,
  });

  return { eligible: true, weekKey, version: selection.version, challenges: buildWeeklyChallengeViews(selection, ctx) };
}
