/**
 * GasCap™ Rental Return Assistant — calculation engine.
 *
 * Pure functions only, no I/O — every number the Rental Return UI shows
 * comes from here, never recomputed ad hoc in a component. Mirrors the
 * "centralized calculation logic" rule the app already follows for the
 * main fuel calculator (lib/calculations.ts).
 *
 * All currency math rounds to cents via roundCurrency(); all fuel-quantity
 * math rounds to tenths of a gallon, since a tenth of a gallon is already
 * finer than any manual estimate can honestly claim.
 */
import type { FuelDataSource } from './rentalProvider';
import { roundTo, gallonsToFill, costForGallons } from './fuelMath';

// ── Rounding ─────────────────────────────────────────────────────────────

export function roundCurrency(n: number): number {
  return roundTo(n, 2);
}

export function roundGallons(n: number): number {
  return roundTo(n, 1);
}

// ── Return requirement resolution ───────────────────────────────────────────

export type ReturnPolicyType = 'same_as_pickup' | 'full' | 'exact';

/**
 * Resolve the actual required-return gallon figure from the chosen policy.
 * 'same_as_pickup' is the documented default (section 7) — if the renter
 * hasn't specified anything different, GasCap should not assume "fill it up."
 */
export function resolveRequiredReturnFuel(
  policyType: ReturnPolicyType,
  pickupFuelGallons: number | null,
  tankCapacityGallons: number | null,
  exactGallons: number | null = null,
): number | null {
  if (policyType === 'full') return tankCapacityGallons ?? null;
  if (policyType === 'exact') return exactGallons;
  return pickupFuelGallons ?? null; // 'same_as_pickup'
}

// ── Core gas math (section 11–13) ───────────────────────────────────────────

/** Gallons needed to reach the required return level — never negative. */
export function gallonsNeeded(requiredReturnFuelGallons: number, currentFuelGallons: number): number {
  if (!(requiredReturnFuelGallons >= 0) || !(currentFuelGallons >= 0)) return 0;
  return gallonsToFill(requiredReturnFuelGallons, currentFuelGallons, 1);
}

export interface TripFillEstimate {
  gallonsToAdd: number;
  estimatedCost: number | null;
}

/** Trip Fill-Up calculator (Phase 6A) — "how much fuel do I want to add
 *  right now," independent of the return-target calculation above (which
 *  uses gallonsNeeded() against requiredReturnFuelGallons specifically).
 *  Desired level is clamped to tank capacity first: the 'gallons' entry
 *  method has no upper bound of its own, and an estimate built from a
 *  physically-impossible desired level isn't a smaller number than
 *  reality, it's a wrong one. Reuses gallonsNeeded()/estimatedFuelCost()
 *  unchanged — same math as the return flow, just a different target. */
export function tripFillEstimate(
  currentFuelGallons: number,
  desiredFuelGallons: number,
  tankCapacityGallons: number,
  pricePerGallon?: number,
): TripFillEstimate {
  const clampedDesired = tankCapacityGallons > 0
    ? Math.min(desiredFuelGallons, tankCapacityGallons)
    : desiredFuelGallons;
  const gallonsToAdd = roundGallons(gallonsNeeded(clampedDesired, currentFuelGallons));
  const estimatedCost = gallonsToAdd > 0 && pricePerGallon != null && pricePerGallon > 0
    ? estimatedFuelCost(gallonsToAdd, pricePerGallon)
    : null;
  return { gallonsToAdd, estimatedCost };
}

/** Estimated out-of-pocket cost to refuel at a given nearby station price. */
export function estimatedFuelCost(gallonsNeededVal: number, stationPricePerGallon: number): number {
  if (!(gallonsNeededVal > 0) || !(stationPricePerGallon > 0)) return 0;
  return costForGallons(gallonsNeededVal, stationPricePerGallon, 2);
}

/** Estimated rental-company refueling charge, if their rate is known — null means "unknown," never invented. */
export function estimatedRentalCompanyCharge(gallonsNeededVal: number, rentalFuelChargePerGallon: number | null | undefined): number | null {
  if (rentalFuelChargePerGallon == null || !(rentalFuelChargePerGallon > 0)) return null;
  if (!(gallonsNeededVal > 0)) return 0;
  return roundCurrency(gallonsNeededVal * rentalFuelChargePerGallon);
}

/** Potential savings from self-refueling vs. the rental company's estimated charge — null if the rate is unknown. */
export function estimatedSavings(rentalCompanyCharge: number | null, selfRefuelCost: number): number | null {
  if (rentalCompanyCharge == null) return null;
  return roundCurrency(rentalCompanyCharge - selfRefuelCost);
}

// ── Refuel log totals + end-of-rental recap ─────────────────────────────────
// The payoff moment: what the renter actually spent across every refuel this
// rental, versus what the rental company would have charged to put those same
// gallons in. Deliberately based on REAL logged purchases, not estimates —
// this runs after the fact, so there's no need to guess at a station price.

export interface RefuelTotals {
  count:        number;
  totalGallons: number;
  totalPaid:    number;
}

/** Running totals across every logged refuel — `totalPaid` counts only entries
 *  that actually recorded a cost (gallons-only entries still count toward
 *  `totalGallons`, so the two figures can legitimately disagree). */
export function refuelTotals(
  logs: Array<{ gallons: number; totalPaid?: number; pricePerGallon?: number }>,
): RefuelTotals {
  let totalGallons = 0;
  let totalPaid    = 0;
  for (const log of logs) {
    if (log.gallons > 0) totalGallons += log.gallons;
    // Prefer the recorded total; fall back to gallons × price when the renter
    // entered a unit price but no total.
    if (log.totalPaid != null && log.totalPaid > 0) {
      totalPaid += log.totalPaid;
    } else if (log.pricePerGallon != null && log.pricePerGallon > 0 && log.gallons > 0) {
      totalPaid += log.gallons * log.pricePerGallon;
    }
  }
  return {
    count:        logs.length,
    totalGallons: roundGallons(totalGallons),
    totalPaid:    roundCurrency(totalPaid),
  };
}

export interface RentalRecap extends RefuelTotals {
  /** What the rental company would have charged for the same gallons — null when their rate is unknown. */
  rentalWouldHaveCharged: number | null;
  /** rentalWouldHaveCharged − totalPaid — null when the rate is unknown. */
  savings:                number | null;
}

export function rentalRecap(
  logs: Array<{ gallons: number; totalPaid?: number; pricePerGallon?: number }>,
  rentalFuelChargePerGallon: number | null | undefined,
): RentalRecap {
  const totals = refuelTotals(logs);
  const rentalWouldHaveCharged =
    rentalFuelChargePerGallon != null && rentalFuelChargePerGallon > 0 && totals.totalGallons > 0
      ? roundCurrency(totals.totalGallons * rentalFuelChargePerGallon)
      : null;
  return {
    ...totals,
    rentalWouldHaveCharged,
    savings: rentalWouldHaveCharged != null ? roundCurrency(rentalWouldHaveCharged - totals.totalPaid) : null,
  };
}

// ── Return-ready status (section 16–17) ─────────────────────────────────────

export type ReturnReadyStatus = 'needs_fuel' | 'nearly_ready' | 'return_ready';

/** Default tolerance — absorbs manual-gauge imprecision, never encourages under-fueling. */
export const DEFAULT_FUEL_TOLERANCE_GALLONS = 0.3;

export function returnReadyStatus(
  currentFuelGallons: number | null,
  requiredReturnFuelGallons: number | null,
  toleranceGallons: number = DEFAULT_FUEL_TOLERANCE_GALLONS,
): ReturnReadyStatus {
  if (currentFuelGallons == null || requiredReturnFuelGallons == null) return 'needs_fuel';
  const deficit = requiredReturnFuelGallons - currentFuelGallons;
  if (deficit <= 0) return 'return_ready';
  if (deficit <= toleranceGallons) return 'nearly_ready';
  return 'needs_fuel';
}

// ── Calculate Fill visibility (2026-08-26 post-release fix) ────────────────
// The section was previously gated behind `showLiveFuel && needed > 0`,
// which hid it entirely whenever the tank already met the return level or
// before any fuel reading existed — exactly the states most users are in
// right after creating a rental, making the feature effectively
// undiscoverable. Extracted as a pure function (rather than inline JSX
// conditionals in RentalDashboard.tsx) so the three states are independently
// testable without a component-render harness.

export type CalculateFillState = 'upcoming' | 'needs_fuel_reading' | 'needs_fill' | 'at_or_above_target';

/**
 * Which of the Calculate Fill section's states should render.
 *   'upcoming'            — rental hasn't started; section hidden entirely.
 *   'needs_fuel_reading'  — rental started but no current fuel reading yet —
 *                           show a prompt, not the calculator (nothing to
 *                           calculate from).
 *   'needs_fill'          — a real reading exists and more fuel is needed —
 *                           show the full calculator.
 *   'at_or_above_target'  — a real reading exists and no more fuel is
 *                           needed — say so, but keep fill-logging available
 *                           (a renter may still want to log a mid-trip stop).
 */
export function resolveCalculateFillState(input: {
  isUpcoming: boolean;
  hasFuelReading: boolean; // session.currentFuelGallons != null || session.pickupFuelGallons != null
  needed: number;
}): CalculateFillState {
  if (input.isUpcoming) return 'upcoming';
  if (!input.hasFuelReading) return 'needs_fuel_reading';
  return input.needed > 0 ? 'needs_fill' : 'at_or_above_target';
}

// ── Precision-honest formatting (section 32) ────────────────────────────────
// Never imply a manual estimate was physically measured. Authoritative
// sources (a future rental-company API or vehicle telematics) may display
// their reported figure without a "~" — they earned that precision, a
// gauge guess didn't.

const ESTIMATED_SOURCES = new Set<FuelDataSource>(['MANUAL_GAUGE', 'MANUAL_PERCENT', 'MANUAL_GALLONS']);

export function formatGallons(gallons: number | null | undefined, source: FuelDataSource | null | undefined): string {
  if (gallons == null) return '—';
  const rounded = roundGallons(gallons);
  const isEstimate = source == null || ESTIMATED_SOURCES.has(source);
  return isEstimate ? `~${rounded} gal` : `${rounded} gal`;
}

// ── Station recommendation scoring (section 15) ─────────────────────────────
// Deliberately simple for Level 1 — a station 10 miles away with slightly
// cheaper gas should not outrank one 0.5 miles from the return facility.
// Lower score = better recommendation. Kept as a small pure function so the
// weighting can be tuned or replaced without touching the UI.
export interface StationScoreInput {
  pricePerGallon: number;
  distanceFromReturnMi: number;
}

const PRICE_WEIGHT    = 1.0;  // $ per gallon difference
const DISTANCE_WEIGHT = 0.15; // $ equivalent penalty per mile from the return facility

export function scoreStation(input: StationScoreInput): number {
  return input.pricePerGallon * PRICE_WEIGHT + input.distanceFromReturnMi * DISTANCE_WEIGHT;
}

export function rankStations<T extends StationScoreInput>(stations: T[]): T[] {
  return [...stations].sort((a, b) => scoreStation(a) - scoreStation(b));
}

export function fuelSourceLabel(source: FuelDataSource | null | undefined): string {
  switch (source) {
    case 'RENTAL_COMPANY_API':  return 'Rental-company reported';
    case 'VEHICLE_TELEMATICS':  return 'Vehicle-reported';
    case 'RECEIPT':             return 'From logged refuel';
    case 'MANUAL_GALLONS':      return 'Manually entered';
    case 'MANUAL_PERCENT':      return 'Estimated from percentage';
    case 'MANUAL_GAUGE':        return 'Estimated from gauge';
    default:                    return 'Estimated';
  }
}

/**
 * Reconcile a stored fuel level against a NEW tank capacity.
 *
 * Levels are stored in gallons, but a gauge or percent entry is really a
 * fraction of a particular tank — the gallons were derived. Change the
 * vehicle and those gallons describe a tank that no longer exists, which is
 * how "~24.5 gal" ended up displayed on a 14 gal tank (7/8 of a previous
 * 28-gallon vehicle).
 *
 * Fractional sources rescale so the fraction the renter actually observed
 * survives. Absolute sources (typed gallons, a receipt) keep their value but
 * are still clamped — no tank holds more than its capacity.
 *
 * Pure and exported so the behaviour is testable without a database.
 */
export function reconcileFuelForNewTank(
  gallons: number | null,
  source: FuelDataSource | null,
  oldCapacity: number | null,
  newCapacity: number | null,
): number | null {
  if (gallons == null) return null;
  if (newCapacity == null || !(newCapacity > 0)) return gallons;

  const fractional = source === 'MANUAL_GAUGE' || source === 'MANUAL_PERCENT';
  const scaled = fractional && oldCapacity != null && oldCapacity > 0
    ? gallons * (newCapacity / oldCapacity)
    : gallons;

  return Math.round(Math.min(scaled, newCapacity) * 1_000_000) / 1_000_000;
}

/**
 * Has this rental not started yet?
 *
 * "Upcoming" is derived, not stored: a session's status is 'active' from
 * creation, and only pickupDateTime says whether the renter is actually
 * holding the car. Treating every open session as in-progress is what let a
 * booked-but-not-collected rental be announced as "Active rental with ...".
 *
 * A rental with no pickup time is treated as in progress — that's the
 * same-day case, where the renter set it up at the counter.
 */
export function isUpcomingRental(
  pickupDateTime: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!pickupDateTime) return false;
  const t = new Date(pickupDateTime).getTime();
  return Number.isFinite(t) && t > now;
}

/**
 * Growth Sprint 1, P0C-2A — the eligibility gate for the client-observed
 * `rental_fuel_needed_calculated` analytics event. Extracted as a pure
 * predicate (domain logic belongs here, not inline in a React component's
 * effect body — see this file's header) so it's independently testable
 * without rendering RentalDashboard: a genuine, meaningful fuel-needed
 * calculation exists only when the rental has actually started and both
 * the current reading and the return requirement are real (not the
 * render-time `?? 0` fallback used elsewhere for display purposes).
 */
export function shouldTrackFuelNeededCalculated(session: {
  currentFuelGallons:        number | null;
  requiredReturnFuelGallons: number | null;
  pickupDateTime:            string | null;
} | null | undefined): boolean {
  if (!session) return false;
  if (isUpcomingRental(session.pickupDateTime)) return false;
  if (session.currentFuelGallons == null || session.requiredReturnFuelGallons == null) return false;
  return true;
}
