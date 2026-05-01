/**
 * GasCap™ — Trip Fuel Planner math helpers
 *
 * Pure calculation utilities for trip fuel planning.
 * These are independent of any mapping API — they work offline and are
 * used by both Mode A (manual trip distance) and Mode B (route-based,
 * when Google Routes API is configured).
 *
 * All distance values are in MILES unless the function name says otherwise.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TripFuelPlanInput {
  /** Total route distance in miles */
  routeDistanceMiles: number;
  /** Vehicle miles per gallon */
  mpg: number;
  /** Tank capacity in gallons */
  tankCapacityGallons: number;
  /** Current fuel level in gallons */
  currentFuelGallons: number;
  /** Gas price per gallon */
  gasPrice: number;
  /**
   * Safety reserve in miles — planner recommends refueling before the driver's
   * range drops below this distance. Defaults to 30 miles.
   */
  reserveMiles?: number;
  /** Desired arrival fuel level in gallons (defaults to 0) */
  targetArrivalFuelGallons?: number;
}

export interface TripFuelPlanResult {
  /** Gallons required for the entire route distance */
  totalGallonsNeeded: number;
  /** Estimated fuel cost for the trip (totalGallonsNeeded × gasPrice) */
  estimatedFuelCost: number;
  /** Miles the vehicle can travel on current fuel */
  currentRangeMiles: number;
  /** Whether the driver can reach the destination without refueling */
  canReachDestinationWithoutRefuel: boolean;
  /**
   * Mile marker by which the planner recommends refueling.
   * null when no refuel stop is needed.
   */
  recommendedRefuelByMile: number | null;
  /** Start of the recommended refuel window (comfort buffer begins here) */
  recommendedRefuelWindowStartMile: number | null;
  /** End of the recommended refuel window (= recommendedRefuelByMile) */
  recommendedRefuelWindowEndMile: number | null;
  /** Human-readable notes about the plan (no PII) */
  notes: string[];
}

// ── Unit conversions ──────────────────────────────────────────────────────────

/** Convert meters (Google Routes API) to miles */
export function metersToMiles(meters: number): number {
  return Math.round((meters / 1609.344) * 100) / 100;
}

/** Convert miles to meters */
export function milesToMeters(miles: number): number {
  return Math.round(miles * 1609.344);
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * How many miles can the vehicle travel on its current fuel?
 */
export function calculateCurrentRange(
  currentFuelGallons: number,
  mpg: number,
): number {
  if (mpg <= 0 || currentFuelGallons < 0) return 0;
  return Math.round(currentFuelGallons * mpg * 10) / 10;
}

/**
 * Calculate the recommended refuel window along a route.
 *
 * Returns { startMile, endMile } where:
 *   endMile   = the last safe mile to refuel before hitting the reserve buffer
 *   startMile = 80% of endMile — a comfort start to the window
 *
 * Returns null when the driver has enough fuel to skip a stop entirely.
 */
export function calculateRecommendedRefuelWindow(
  routeDistanceMiles: number,
  mpg: number,
  _tankCapacityGallons: number, // reserved for future multi-stop logic
  currentFuelGallons: number,
  reserveMiles: number = 30,
): { startMile: number; endMile: number } | null {
  const currentRange = calculateCurrentRange(currentFuelGallons, mpg);
  const usableRange  = Math.max(0, currentRange - reserveMiles);

  if (usableRange >= routeDistanceMiles) return null;

  const endMile   = Math.round(usableRange * 10) / 10;
  const startMile = Math.round(usableRange * 0.8 * 10) / 10;

  return { startMile, endMile };
}

/**
 * Full trip fuel plan calculation.
 * Covers gallons needed, cost, range, and the recommended refuel window.
 */
export function calculateTripFuelPlan(
  input: TripFuelPlanInput,
): TripFuelPlanResult {
  const {
    routeDistanceMiles,
    mpg,
    tankCapacityGallons,
    currentFuelGallons,
    gasPrice,
    reserveMiles = 30,
    targetArrivalFuelGallons = 0,
  } = input;

  const totalGallonsNeeded =
    Math.round((routeDistanceMiles / mpg) * 100) / 100;

  const estimatedFuelCost =
    Math.round(totalGallonsNeeded * gasPrice * 100) / 100;

  const currentRangeMiles = calculateCurrentRange(currentFuelGallons, mpg);

  // Account for desired arrival fuel level
  const effectiveNeed = totalGallonsNeeded + targetArrivalFuelGallons;
  const canReachDestinationWithoutRefuel = currentFuelGallons >= effectiveNeed;

  const window = calculateRecommendedRefuelWindow(
    routeDistanceMiles,
    mpg,
    tankCapacityGallons,
    currentFuelGallons,
    reserveMiles,
  );

  const notes: string[] = [];

  if (canReachDestinationWithoutRefuel) {
    notes.push('You have enough fuel to reach your destination without stopping.');
  } else {
    const gallonsShort =
      Math.round((effectiveNeed - currentFuelGallons) * 100) / 100;
    notes.push(
      `You'll need at least ${gallonsShort.toFixed(2)} gal more to complete this trip.`,
    );
  }

  notes.push(
    'These are estimates — actual mileage varies by driving conditions, speed, and load.',
  );

  return {
    totalGallonsNeeded,
    estimatedFuelCost,
    currentRangeMiles: Math.round(currentRangeMiles * 10) / 10,
    canReachDestinationWithoutRefuel,
    recommendedRefuelByMile:          window?.endMile   ?? null,
    recommendedRefuelWindowStartMile: window?.startMile ?? null,
    recommendedRefuelWindowEndMile:   window?.endMile   ?? null,
    notes,
  };
}
