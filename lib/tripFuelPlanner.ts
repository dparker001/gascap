/**
 * GasCap™ — Trip Fuel Planner math helpers
 *
 * Pure calculation utilities for trip fuel planning.
 * These are independent of any mapping API — they work offline and are
 * used by both Mode A (manual trip distance) and Mode B (route-based,
 * when Google Routes API is configured).
 *
 * All distance values are in MILES unless the function name says otherwise.
 *
 * Phase 1 (2026-10-11): `calcTrip` below is the live calculation that both
 * Trip Planner modes actually call — moved here verbatim from
 * components/TripCostEstimator.tsx, with no behavior change (see
 * __tests__/calcTripParity.test.ts for the before/after proof). It does
 * NOT use `calculateCurrentRange` / `calculateRecommendedRefuelWindow` /
 * `calculateTripFuelPlan` above, which remain unused dead code with their
 * own unwired 30-mile reserve concept — reconciling or removing those is a
 * separate, later decision (safety-reserve work is Phase 4), not something
 * this move silently activates.
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

// ── Live Trip Planner calculation (moved from components/TripCostEstimator.tsx) ──

export interface TripResult {
  totalMiles:        number;
  totalGallons:      number;   // full trip gallons (no offset)
  totalTripCost:     number;   // full trip cost (no offset)
  currentGalOffset:  number;   // gallons already in tank
  currentCostOffset: number;   // value of fuel already in tank
  gallonsNeeded:     number;   // gallons still to buy
  fuelCost:          number;   // cost of gallons still to buy
  stops:             number;   // en-route refuel stops based on current fuel
  stopsIfFull:       number;   // en-route stops if you top off before leaving
  tankRange:         number;   // full-tank range in miles (for diagnostics)
  costPerPerson:     number | null;
  milesPerDollar:    number;
  tankfulls:         number;
  summary:           string;
}

export function calcTrip(
  miles:     number,
  mpg:       number,
  tankGal:   number,
  fuelPct:   number,    // 0–100 current fuel %
  pricePGal: number,
  people:    number,
): TripResult {
  const totalGallons       = miles / mpg;                          // total gallons for full trip
  const totalTripCost      = totalGallons * pricePGal;             // full trip cost ignoring current fuel
  const currentGalOffset   = Math.min(tankGal * (fuelPct / 100), totalGallons); // gallons already in tank (capped at trip need)
  const currentCostOffset  = currentGalOffset * pricePGal;         // value of current fuel toward trip
  const gallonsNeeded      = Math.max(0, totalGallons - currentGalOffset);
  const fuelCost           = gallonsNeeded * pricePGal;
  const tankRange          = tankGal * mpg;
  // En-route stops if the driver tops off to full before leaving
  // (the initial fill-up is pre-trip, so stops = additional full-tank fills required on the road)
  const remainingIfFull = Math.max(0, miles - tankRange);
  const stopsIfFull     = remainingIfFull <= 0 ? 0 : Math.ceil(remainingIfFull / tankRange);
  // En-route stops based on current fuel level
  // KEY: when fuelPct = 0, the driver will fill up before leaving (not on the road),
  // so the stop count is the same as starting full — avoids the off-by-one overcount.
  const currentMilesInTank    = tankGal * (fuelPct / 100) * mpg;
  const remainingAfterCurrent = miles - currentMilesInTank;
  const stops = remainingAfterCurrent <= 0
    ? 0
    : fuelPct <= 0
      ? stopsIfFull   // at E → first fill-up is pre-trip, not a road stop
      : Math.ceil(remainingAfterCurrent / tankRange);
  const milesPerDollar        = totalTripCost > 0 ? Math.round((miles / totalTripCost) * 10) / 10 : 0;
  const tankfulls          = Math.round((totalGallons / tankGal) * 10) / 10;
  const costPerPerson      = people > 1 ? Math.round((fuelCost / people) * 100) / 100 : null;

  let summary = '';
  if (gallonsNeeded === 0) {
    summary = `Great news — you already have enough fuel for the full ${miles.toLocaleString()}-mile trip!`;
  } else {
    summary = `This ${miles.toLocaleString()}-mile trip needs ${totalGallons.toFixed(2)} gal total ` +
              `($${totalTripCost.toFixed(2)}). You'll need to buy ${gallonsNeeded.toFixed(2)} gal ` +
              `($${fuelCost.toFixed(2)}) on top of what's in your tank.`;
    if (stops > 0) summary += ` Plan for ${stops} refuel stop${stops > 1 ? 's' : ''} on the road.`;
  }

  return {
    totalMiles:        miles,
    totalGallons:      Math.round(totalGallons * 100) / 100,
    totalTripCost:     Math.round(totalTripCost * 100) / 100,
    currentGalOffset:  Math.round(currentGalOffset * 100) / 100,
    currentCostOffset: Math.round(currentCostOffset * 100) / 100,
    gallonsNeeded:     Math.round(gallonsNeeded * 100) / 100,
    fuelCost:          Math.round(fuelCost * 100) / 100,
    stops,
    stopsIfFull,
    tankRange:         Math.round(tankRange),
    costPerPerson,
    milesPerDollar,
    tankfulls,
    summary,
  };
}
