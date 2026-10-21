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

// ── Auto-APPLY: may GasCap apply a vehicle right now? ─────────────────────
//
// (PR #87 review round 3, 2026-10-20.) `pickAutoSelectVehicle` above answers
// "which vehicle", not "may I". SavedVehicles used to answer the second
// question with:
//
//     if (selectedVehicleId) { autoAppliedRef.current = false; return; }
//
// — i.e. "once per empty-selection window". That resets the latch every time
// a vehicle is selected, so the NEXT transition to empty auto-applies again.
// The PR claimed a deliberate clear was never overridden. It was not true,
// and the real user paths make it matter (verified in components/
// TargetFillForm.tsx and components/BudgetForm.tsx, both of which render
// SavedVehicles and keep it mounted throughout):
//
//   1. Typing a tank size by hand clears vehicleId (TankPresets onChange).
//   2. Picking a generic tank-size preset clears vehicleId (onPresetSelect).
//   3. "Clear All" resets the form to DEFAULTS, where vehicleId is ''.
//   4. Sign-out clears vehicleId while the loaded garage data is still held.
//
// Cases 1 and 2 were the damaging ones: the user picks "16 gallons" from the
// preset list, and the old latch immediately re-applied their saved vehicle,
// silently overwriting the tank size they had just chosen. Case 4 could apply
// the previous account's vehicle for a signed-out guest.
//
// The original rationale — "most notably right after leaving Rental Mode, so
// users don't have to manually reselect their regular car" (commit 5491a68) —
// is obsolete. That was written when Rental Mode was a toggle ON the
// calculator that cleared the selected vehicle. It is now navigation to
// /rental-return, and a repository-wide search for vehicle-clearing finds only
// the four paths above: none of them is a rental-mode exit. So there is no
// separate rental semantic event left to preserve here.
//
// The fix is to latch per ACCOUNT instead of per empty-selection window:
// apply once for a signed-in user, then never again unprompted. Initial
// auto-selection is unchanged; every later clear is treated as the user's
// decision, because that is what all four paths actually are.

export type AutoApplySkipReason =
  /** Nobody is signed in — never apply, and never leak the prior account's car. */
  | 'no-user'
  /** A vehicle is already applied; nothing to do. */
  | 'already-selected'
  /** Already applied once for this account — a later clear is deliberate. */
  | 'already-applied'
  /** No vehicle qualifies (none saved, or 2+ with no explicit default). */
  | 'no-candidate';

export type AutoApplyDecision<T> =
  | { action: 'apply'; vehicle: T; reason: AutoSelectReason }
  | { action: 'skip';  reason: AutoApplySkipReason };

export interface AutoApplyInput<T> {
  vehicles:          readonly T[] | undefined;
  /** Empty string / undefined means nothing is currently applied. */
  selectedVehicleId: string | undefined | null;
  /** The signed-in user, or null/undefined when signed out. */
  userId:            string | null | undefined;
  /** Which account has already had its one auto-apply, if any. */
  appliedForUserId:  string | null;
}

/**
 * Decide whether to auto-apply a vehicle, and which.
 *
 * Applies at most once per account. Returning `already-applied` is what makes
 * a deliberate clear stay cleared. A `no-candidate` result does NOT consume
 * the account's one apply, so a user with three unstarred cars who later stars
 * one still gets it applied.
 */
export function decideVehicleAutoApply<T extends AutoSelectableVehicle>(
  input: AutoApplyInput<T>,
): AutoApplyDecision<T> {
  if (!input.userId)                               return { action: 'skip', reason: 'no-user' };
  if (input.selectedVehicleId)                     return { action: 'skip', reason: 'already-selected' };
  if (input.appliedForUserId === input.userId)     return { action: 'skip', reason: 'already-applied' };

  const auto = pickAutoSelectVehicle(input.vehicles ?? []);
  if (!auto)                                       return { action: 'skip', reason: 'no-candidate' };

  return { action: 'apply', vehicle: auto.vehicle, reason: auto.reason };
}
