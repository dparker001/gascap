/**
 * Gamification G2-A — weekly challenge catalog, deterministic selection and
 * progress rules (PURE: no DB, no clock, no randomness).
 *
 * G2-A is READ-ONLY with respect to GasPoints: nothing here awards, writes or
 * changes any G1 rule. It describes which three challenges a user sees for a
 * GasCap week and how far along each one is, derived only from authoritative
 * server state (the G1 ledger and the user's own records). The client never
 * declares completion.
 *
 * Calendar: the canonical GasCap week (Monday–Sunday, America/New_York) comes
 * from lib/gasCapCalendar.ts; this module only receives a week key.
 *
 * Reward amounts below are PROPOSED for G2-B. They are not awardable: none of the
 * planned `challenge_*` actions is in the G1 rule table (GASPOINT_RULES), so
 * `isGasPointAction()` rejects them and no ledger row can be written with them
 * until G2-B is separately authorized.
 */
import { createHash } from 'crypto';
import { WEEKLY_MISSION_TARGET } from './gasPointsRules';

/** Bump to change rotation rules; launch a new version only at a Monday boundary. */
export const G2_CHALLENGE_VERSION = 'g2_v1';

export type ChallengeId =
  | 'fuel_check_3day'
  | 'weekend_check'
  | 'fuel_explorer'
  | 'pump_tracker'
  | 'mpg_builder'
  | 'add_vehicle';

export type ChallengeStatus = 'available' | 'complete' | 'guidance' | 'tracking_unavailable';

/**
 * How trustworthy / available progress tracking is:
 *  - ledger_derived   progress comes from authoritative G1 ledger rows
 *  - guidance         informational row, nothing to track
 *  - requires_g2b_hook progress/completion cannot be authoritatively derived today;
 *                      G2-B must record it at the moment it happens
 */
export type TrackingCapability = 'ledger_derived' | 'guidance' | 'requires_g2b_hook';

/**
 * Slot 2 pool (non-purchase behaviour challenges). Order is part of the selection
 * function: append-only within a version, and any change needs a new version.
 */
export const SLOT2_POOL: readonly ChallengeId[] = ['weekend_check', 'fuel_explorer'];

/**
 * MPG Builder completion cannot be derived authoritatively today: MPG is computed
 * live from ALL of a user's fill-ups ordered by their user-entered date, and
 * fill-ups can be back-dated, edited (PATCH) or deleted — so a "newly created
 * fill-up produced an MPG" fact is not recoverable read-only. Until G2-B adds a
 * creation-time hook the selector never offers it.
 */
export const MPG_BUILDER_SELECTABLE = false;

/** Reward the user already gets from G1 for the same action, or a proposed G2-B reward. */
export interface PlannedReward {
  /** The ledger action that would carry the reward. */
  action: string;
  points: number;
  /** True when the action already exists in G1 (no new reward is created). */
  existingG1: boolean;
}

/**
 * PROPOSED rewards (G2-B). Not awardable in G2-A. `weekly_3day_check` is the
 * existing G1 mission and stays exactly as it is.
 */
export const PLANNED_REWARDS: Record<Exclude<ChallengeId, 'add_vehicle'>, PlannedReward> = {
  fuel_check_3day: { action: 'weekly_3day_check',        points: 25, existingG1: true  },
  weekend_check:   { action: 'challenge_weekend_check',  points: 10, existingG1: false },
  fuel_explorer:   { action: 'challenge_fuel_explorer',  points: 15, existingG1: false },
  pump_tracker:    { action: 'challenge_pump_tracker',   points: 25, existingG1: false },
  mpg_builder:     { action: 'challenge_mpg_builder',    points: 30, existingG1: false },
};

/** Guidance only: adding a vehicle is rewarded by the existing G1 `first_vehicle`, not by a challenge. */
export const ADD_VEHICLE_G1_REWARD: PlannedReward = { action: 'first_vehicle', points: 25, existingG1: true };

/**
 * G2-B idempotency identity for the NEW challenge actions. It cannot collide with
 * any G1 key (every G1 key starts with its own action name, none with
 * "challenge:") and fits the existing global unique `idempotencyKey` column.
 * Defined here for review; nothing in G2-A calls it to write.
 */
export function challengeIdempotencyKey(id: ChallengeId, userId: string, weekKey: string): string {
  return `challenge:${id}:${userId}:${weekKey}`;
}

// ── Deterministic selection ─────────────────────────────────────────────────

/** Stable hash -> uint32. Server-side, no randomness, no state. */
export function stableHash32(...parts: string[]): number {
  const digest = createHash('sha256').update(parts.join('|')).digest();
  return digest.readUInt32BE(0);
}

export interface SelectionInput {
  userId: string;
  weekKey: string;
  version?: string;
  /** The user has at least one saved vehicle. */
  hasVehicle: boolean;
  /** This week's Pump Tracker is already complete (keeps slot 3 stable once earned). */
  pumpTrackerComplete: boolean;
  /** MPG Builder may be offered (only ever true if MPG_BUILDER_SELECTABLE and the user has odometer history). */
  mpgBuilderAvailable: boolean;
}

export interface WeeklySelection {
  version: string;
  weekKey: string;
  slot1: 'fuel_check_3day';
  slot2: 'weekend_check' | 'fuel_explorer';
  slot3: 'add_vehicle' | 'pump_tracker' | 'mpg_builder';
}

export function selectWeeklyChallenges(input: SelectionInput): WeeklySelection {
  const version = input.version ?? G2_CHALLENGE_VERSION;

  // Slot 2: a pure function of (user, week, version) — the same user sees the same
  // challenge all week on every device, and a new week or version re-rolls it.
  const slot2 = SLOT2_POOL[stableHash32(input.userId, input.weekKey, version, 'slot2') % SLOT2_POOL.length] as WeeklySelection['slot2'];

  // Slot 3: state-sensitive (owner-approved: it may change when the user's real
  // state changes). Once Pump Tracker is complete it stays put even if the vehicle
  // is later removed, so a completed challenge never disappears.
  let slot3: WeeklySelection['slot3'];
  if (!input.hasVehicle && !input.pumpTrackerComplete) {
    slot3 = 'add_vehicle';
  } else if (MPG_BUILDER_SELECTABLE && input.mpgBuilderAvailable) {
    slot3 = stableHash32(input.userId, input.weekKey, version, 'slot3') % 2 === 0 ? 'pump_tracker' : 'mpg_builder';
  } else {
    slot3 = 'pump_tracker';
  }

  return { version, weekKey: input.weekKey, slot1: 'fuel_check_3day', slot2, slot3 };
}

// ── Progress ────────────────────────────────────────────────────────────────

export interface ProgressContext {
  weekKey: string;
  /** `sourceRef` (GasCap dates) of this week's `daily_fuel_check` ledger rows. */
  checkDates: string[];
  /** The `weekly_3day_check` ledger row for this week exists. */
  weeklyMissionAwarded: boolean;
  /** `sourceRef` (GasCap dates) of this week's `fuel_action` ledger rows. */
  fuelActionDates: string[];
}

export interface ChallengeView {
  slot: 1 | 2 | 3;
  id: ChallengeId;
  /** Typed copy identity for G2-B (no copy ships in G2-A). */
  titleKey: string;
  status: ChallengeStatus;
  /** null when progress cannot be tracked authoritatively. */
  progress: number | null;
  target: number;
  /** PROPOSED reward (G2-B). null for guidance rows. */
  proposedReward: number | null;
  /** The ledger action that would/does carry the reward. */
  rewardAction: string | null;
  /** True when the reward is an existing G1 reward (no new points are created). */
  rewardIsExistingG1: boolean;
  trackingCapability: TrackingCapability;
  weekKey: string;
}

/** Saturday/Sunday of a GasCap date key (YYYY-MM-DD). */
export function isWeekendDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const t = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const dow = new Date(t).getUTCDay();
  return dow === 0 || dow === 6;
}

function base(slot: 1 | 2 | 3, id: ChallengeId, weekKey: string) {
  return { slot, id, titleKey: `gasChallenge.${id}`, weekKey } as const;
}

export function challengeView(slot: 1 | 2 | 3, id: ChallengeId, ctx: ProgressContext): ChallengeView {
  const b = base(slot, id, ctx.weekKey);
  switch (id) {
    case 'fuel_check_3day': {
      const distinct = new Set(ctx.checkDates).size;
      const done = ctx.weeklyMissionAwarded || distinct >= WEEKLY_MISSION_TARGET;
      const r = PLANNED_REWARDS.fuel_check_3day;
      return { ...b, status: done ? 'complete' : 'available', progress: done ? WEEKLY_MISSION_TARGET : Math.min(distinct, WEEKLY_MISSION_TARGET),
        target: WEEKLY_MISSION_TARGET, proposedReward: r.points, rewardAction: r.action, rewardIsExistingG1: r.existingG1, trackingCapability: 'ledger_derived' };
    }
    case 'weekend_check': {
      const done = ctx.checkDates.some(isWeekendDateKey);
      const r = PLANNED_REWARDS.weekend_check;
      return { ...b, status: done ? 'complete' : 'available', progress: done ? 1 : 0, target: 1,
        proposedReward: r.points, rewardAction: r.action, rewardIsExistingG1: r.existingG1, trackingCapability: 'ledger_derived' };
    }
    case 'pump_tracker': {
      const done = new Set(ctx.fuelActionDates).size >= 1;
      const r = PLANNED_REWARDS.pump_tracker;
      return { ...b, status: done ? 'complete' : 'available', progress: done ? 1 : 0, target: 1,
        proposedReward: r.points, rewardAction: r.action, rewardIsExistingG1: r.existingG1, trackingCapability: 'ledger_derived' };
    }
    case 'fuel_explorer': {
      // G1 has no authoritative write for "explored another grade"; viewing is a
      // read-only GET. Never infer completion from it.
      const r = PLANNED_REWARDS.fuel_explorer;
      return { ...b, status: 'tracking_unavailable', progress: null, target: 1,
        proposedReward: r.points, rewardAction: r.action, rewardIsExistingG1: r.existingG1, trackingCapability: 'requires_g2b_hook' };
    }
    case 'mpg_builder': {
      const r = PLANNED_REWARDS.mpg_builder;
      return { ...b, status: 'tracking_unavailable', progress: null, target: 1,
        proposedReward: r.points, rewardAction: r.action, rewardIsExistingG1: r.existingG1, trackingCapability: 'requires_g2b_hook' };
    }
    case 'add_vehicle': {
      return { ...b, status: 'guidance', progress: null, target: 1, proposedReward: null,
        rewardAction: ADD_VEHICLE_G1_REWARD.action, rewardIsExistingG1: true, trackingCapability: 'guidance' };
    }
  }
}

/** The three weekly challenge views for a selection. */
export function buildWeeklyChallengeViews(sel: WeeklySelection, ctx: ProgressContext): ChallengeView[] {
  return [challengeView(1, sel.slot1, ctx), challengeView(2, sel.slot2, ctx), challengeView(3, sel.slot3, ctx)];
}

/**
 * G2-B DESIGN ONLY (not used in G2-A): the server-authoritative moments at which
 * each new challenge would be completed and awarded. Listed here so the review
 * can approve the seams before any write exists.
 */
export const PLANNED_G2B_HOOKS: ReadonlyArray<{ challenge: ChallengeId; trigger: string; note: string }> = [
  { challenge: 'weekend_check',  trigger: 'POST /api/gaspoints/daily-check', note: 'after the daily row is inserted: complete when its GasCap date is Sat/Sun' },
  { challenge: 'pump_tracker',   trigger: 'fuel_action award (fillups/gig/rental routes)', note: 'after the +50 fuel_action row exists for the week' },
  { challenge: 'mpg_builder',    trigger: 'POST /api/fillups after persist', note: 'at CREATE time only: complete if the saved fill-up yields a valid computed MPG; never on PATCH' },
  { challenge: 'fuel_explorer',  trigger: 'new POST /api/gaspoints/explore { grade }', note: 'complete when the grade differs from the server-derived default pulse grade and a Daily Check exists this week (no new storage needed)' },
];
