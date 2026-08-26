/**
 * GasCap™ — canonical fuel-math primitives.
 *
 * Phase 3A extraction (2026-08-25): lib/calculations.ts (the personal
 * calculator) and lib/rentalCalculations.ts (Rental Return Mode) had
 * independently reimplemented the same core arithmetic — round-to-N-decimals,
 * gallons-needed-to-reach-a-target, cost-for-gallons, percent-of-tank-to-
 * gallons. This file is the single source of truth for that generic math.
 * Both calculators call these functions rather than reimplementing them.
 *
 * Deliberately generic only: business rules that aren't shared (required
 * return level policy, rental-company charge comparison, return-ready
 * tolerance, EV charging) stay in their respective calculator files. This
 * file must never grow a rental-specific or personal-calculator-specific
 * concept — see lib/rentalCalculations.ts / lib/calculations.ts for those.
 *
 * Every call site is responsible for its own rounding precision (2 decimals
 * for currency, 1 for rental gallons display, etc.) — this refactor
 * preserves each caller's prior externally-visible rounding behavior
 * exactly; see __tests__/fuelMathParity.test.ts for the regression proof.
 */

/** Round to N decimal places. */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Gallons needed to go from `currentGallons` to `targetGallons` — never negative. */
export function gallonsToFill(targetGallons: number, currentGallons: number, decimals: number): number {
  return roundTo(Math.max(0, targetGallons - currentGallons), decimals);
}

/** Cost of buying `gallons` at `pricePerGallon`. */
export function costForGallons(gallons: number, pricePerGallon: number, decimals: number): number {
  return roundTo(gallons * pricePerGallon, decimals);
}

/** Gallons represented by a percent-of-tank reading, capped at the tank's capacity. */
export function gallonsFromPercent(percent: number, tankCapacityGallons: number): number {
  return Math.min(tankCapacityGallons, tankCapacityGallons * (percent / 100));
}
