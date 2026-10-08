/**
 * Gamification G1 — read-only GasPoints reporting (pure computation).
 *
 * Population: the real users handed in (the admin baseline loader already
 * excludes test accounts and admins; rows for anyone outside the population are
 * ignored here too, so a test account can earn points without ever appearing in
 * these numbers). Never writes; admins cannot edit GasPoints.
 *
 * "Last 7 days" = the last 7 GasCap calendar dates (America/New_York), today
 * included.
 */
import { gasCapDateKey, gasCapWeekKey } from './gasCapCalendar';
import { GASPOINT_LEVELS, levelFor, type GasPointLevelId } from './gasPointsRules';

export interface LedgerRow { userId: string; action: string; points: number; sourceRef: string | null }

export interface GasPointsReport {
  generatedAt: string;
  truncated: boolean;
  /** Real users with at least one GasPoints award. */
  participants: number;
  /** Daily Fuel Checks (rows) on the last 7 GasCap dates. */
  dailyChecksLast7: number;
  /** Distinct real users who completed a Daily Fuel Check in that window. */
  distinctCheckersLast7: number;
  /** dailyChecksLast7 / distinctCheckersLast7 (null when nobody checked). */
  avgChecksPerChecker7: number | null;
  /** Users who ever completed the weekly 3-day mission / completed it this GasCap week. */
  weeklyMissionCompletedEver: number;
  weeklyMissionCompletedThisWeek: number;
  levelDistribution: Record<GasPointLevelId, number>;
}

function lastNDateKeys(now: Date, n: number): Set<string> {
  const keys = new Set<string>();
  const base = Date.parse(`${gasCapDateKey(now)}T00:00:00Z`);
  for (let i = 0; i < n; i++) keys.add(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  return keys;
}

export function computeGasPointsReport(input: {
  now: Date; userIds: string[]; rows: LedgerRow[]; truncated?: boolean;
}): GasPointsReport {
  const pop = new Set(input.userIds);
  const window7 = lastNDateKeys(input.now, 7);
  const weekKey = gasCapWeekKey(input.now);

  const balances = new Map<string, number>();
  const checkers = new Set<string>();
  const weeklyEver = new Set<string>();
  const weeklyNow = new Set<string>();
  let checks7 = 0;

  for (const r of input.rows) {
    if (!pop.has(r.userId)) continue;
    balances.set(r.userId, (balances.get(r.userId) ?? 0) + r.points);
    if (r.action === 'daily_fuel_check' && r.sourceRef && window7.has(r.sourceRef)) {
      checks7 += 1; checkers.add(r.userId);
    }
    if (r.action === 'weekly_3day_check') {
      weeklyEver.add(r.userId);
      if (r.sourceRef === weekKey) weeklyNow.add(r.userId);
    }
  }

  const levelDistribution = Object.fromEntries(GASPOINT_LEVELS.map((l) => [l.id, 0])) as Record<GasPointLevelId, number>;
  for (const bal of balances.values()) levelDistribution[levelFor(bal).id] += 1;

  return {
    generatedAt: input.now.toISOString(),
    truncated: !!input.truncated,
    participants: balances.size,
    dailyChecksLast7: checks7,
    distinctCheckersLast7: checkers.size,
    avgChecksPerChecker7: checkers.size > 0 ? Math.round((checks7 / checkers.size) * 100) / 100 : null,
    weeklyMissionCompletedEver: weeklyEver.size,
    weeklyMissionCompletedThisWeek: weeklyNow.size,
    levelDistribution,
  };
}
