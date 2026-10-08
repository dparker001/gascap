/**
 * Gamification G1 — GasPoints rules, levels and idempotency keys (PURE, no DB).
 *
 * GasPoints are a progress/achievement currency ONLY. They have no cash value,
 * no redemption path, no gift-card or sweepstakes conversion, and they are
 * completely separate from giveaway entries, the existing visit streak and
 * badges. Nothing here reads or writes any of those.
 *
 * The server owns every rule: callers pass an ACTION, never a point amount and
 * never an idempotency key. Stronger fraud controls are required before any
 * future redemption/cash/reward value could ever be attached to GasPoints.
 */

export const GASPOINT_RULES = {
  /** First-ever Daily Fuel Check, once per lifetime. */
  welcome_bonus:       25,
  /** Explicit Daily Fuel Check, once per GasCap day. */
  daily_fuel_check:    5,
  /** Daily Fuel Check on 3 distinct GasCap days in one Mon–Sun week, once per week. */
  weekly_3day_check:   25,
  /** First vehicle saved after G1 is live, once per lifetime. */
  first_vehicle:       25,
  /** First station saved after G1 is live, once per lifetime. */
  first_saved_station: 20,
  /** A persisted gallon-based fuel action, once per GasCap day. */
  fuel_action:         50,
} as const;

export type GasPointAction = keyof typeof GASPOINT_RULES;
export const GASPOINT_ACTIONS = Object.keys(GASPOINT_RULES) as GasPointAction[];

export function isGasPointAction(v: unknown): v is GasPointAction {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(GASPOINT_RULES, v);
}

/** Distinct GasCap days with a Daily Fuel Check needed for the weekly mission. */
export const WEEKLY_MISSION_TARGET = 3;

// ── Levels (derived solely from lifetime points — no level table) ───────────
export const GASPOINT_LEVELS = [
  { id: 'starter',      min: 0    },
  { id: 'road_ready',   min: 100  },
  { id: 'fuel_smart',   min: 250  },
  { id: 'smart_saver',  min: 500  },
  { id: 'gascap_elite', min: 1000 },
] as const;

export type GasPointLevelId = (typeof GASPOINT_LEVELS)[number]['id'];

export interface LevelInfo {
  id: GasPointLevelId;
  index: number;
  min: number;
  /** null at the top level — there is no fake next threshold. */
  next: { id: GasPointLevelId; min: number } | null;
  /** Points still needed for the next level (0 at max). */
  pointsToNext: number;
  /** 0–100 progress through the current level (100 at max). */
  progressPct: number;
}

export function levelFor(points: number): LevelInfo {
  const p = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  let index = 0;
  for (let i = 0; i < GASPOINT_LEVELS.length; i++) if (p >= GASPOINT_LEVELS[i].min) index = i;
  const cur = GASPOINT_LEVELS[index];
  const nxt = GASPOINT_LEVELS[index + 1] ?? null;
  if (!nxt) return { id: cur.id, index, min: cur.min, next: null, pointsToNext: 0, progressPct: 100 };
  const span = nxt.min - cur.min;
  return {
    id: cur.id, index, min: cur.min,
    next: { id: nxt.id, min: nxt.min },
    pointsToNext: nxt.min - p,
    progressPct: Math.max(0, Math.min(100, Math.floor(((p - cur.min) / span) * 100))),
  };
}

// ── Idempotency keys — the identity of each award ──────────────────────────
export const gasPointKeys = {
  welcome:        (userId: string) => `welcome_bonus:${userId}`,
  dailyCheck:     (userId: string, dateKey: string) => `daily_fuel_check:${userId}:${dateKey}`,
  weekly:         (userId: string, weekKey: string) => `weekly_3day_check:${userId}:${weekKey}`,
  firstVehicle:   (userId: string) => `first_vehicle:${userId}`,
  firstStation:   (userId: string) => `first_saved_station:${userId}`,
  fuelAction:     (userId: string, dateKey: string) => `fuel_action:${userId}:${dateKey}`,
} as const;

export interface AwardSummary {
  action: GasPointAction;
  points: number;
}
