/**
 * Which saved vehicle should GasCap pick on its own?
 * (Workstream 02 Phase 1B, 2026-10-20.)
 *
 * Two surfaces auto-applied a vehicle and each got it slightly wrong:
 *
 *  - SavedVehicles only ever auto-applied a vehicle carrying `isDefault`.
 *    A brand-new user with exactly one car — who has no reason to have
 *    discovered the star button yet — got nothing, and re-picked their
 *    only vehicle on every visit.
 *  - TripCostEstimator auto-applied `vehicles[0]`, and the garage list is
 *    ordered by `createdAt` ascending (lib/savedVehicles.ts), so a user
 *    who explicitly starred their second car still got their first one.
 *
 * One pure rule for both, so the two surfaces cannot drift apart again:
 * an explicit default always wins; absent one, a sole eligible vehicle is
 * safe to assume; two or more with no default is a genuine question and
 * stays unanswered.
 *
 * Eligibility is "can this vehicle actually drive a fuel calculation",
 * i.e. a real positive tank size. There is deliberately no archived/
 * inactive flag consulted: `Vehicle` has no such column today
 * (prisma/schema.prisma), so claiming to filter on one would be fiction.
 * If one is ever added, add it to isAutoSelectableVehicle() and both
 * call sites inherit the fix.
 *
 * This answers "which vehicle, if any, may be auto-applied" — NOT "may I
 * auto-apply now". Callers own that, and every caller still guards on
 * nothing currently being selected, so a user's own choice (including a
 * deliberate clear) is never overridden.
 */

export interface AutoSelectableVehicle {
  id:         string;
  /** Tank capacity in gallons. */
  gallons:    number;
  isDefault?: boolean;
}

export type AutoSelectReason = 'explicit-default' | 'sole-vehicle';

export interface AutoSelectResult<T> {
  vehicle: T;
  reason:  AutoSelectReason;
}

/** A vehicle usable for a fuel calculation: a real, positive tank size. */
export function isAutoSelectableVehicle(v: AutoSelectableVehicle): boolean {
  return typeof v.gallons === 'number' && Number.isFinite(v.gallons) && v.gallons > 0;
}

/**
 * The vehicle GasCap may auto-apply, or null when the choice is the
 * user's to make.
 *
 * An explicit default wins even among many vehicles. With no default,
 * exactly one eligible vehicle is auto-applied; two or more returns null
 * rather than guessing.
 */
export function pickAutoSelectVehicle<T extends AutoSelectableVehicle>(
  vehicles: readonly T[],
): AutoSelectResult<T> | null {
  if (!Array.isArray(vehicles) || vehicles.length === 0) return null;
  const eligible = vehicles.filter(isAutoSelectableVehicle);

  const explicit = eligible.find((v) => v.isDefault === true);
  if (explicit) return { vehicle: explicit, reason: 'explicit-default' };

  if (eligible.length === 1) return { vehicle: eligible[0], reason: 'sole-vehicle' };
  return null;
}
