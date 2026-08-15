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

// ── Rounding ─────────────────────────────────────────────────────────────

export function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundGallons(n: number): number {
  return Math.round(n * 10) / 10;
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
  return roundGallons(Math.max(requiredReturnFuelGallons - currentFuelGallons, 0));
}

/** Estimated out-of-pocket cost to refuel at a given nearby station price. */
export function estimatedFuelCost(gallonsNeededVal: number, stationPricePerGallon: number): number {
  if (!(gallonsNeededVal > 0) || !(stationPricePerGallon > 0)) return 0;
  return roundCurrency(gallonsNeededVal * stationPricePerGallon);
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
