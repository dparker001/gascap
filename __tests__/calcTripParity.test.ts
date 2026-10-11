/**
 * Trip Planner calculation extraction (Phase 1, 2026-10-11).
 *
 * `calcTrip` moved verbatim from components/TripCostEstimator.tsx into
 * lib/tripFuelPlanner.ts so it has a single, shared, testable home instead
 * of living inline in a UI component (the component now imports it). This
 * is a pure move — no formula, rounding, or edge-case behavior changed.
 *
 * Fixtures below were captured by running the pre-move function (the
 * verbatim version still on main at the time of this change) against the
 * same inputs and asserting the moved version produces byte-identical
 * JSON output, including two edge cases (zero distance, zero MPG) that
 * the live UI can reach via "Enter manually" + an empty/zero field. This
 * is the behavioral-equivalence proof requested before any Phase 2+ work
 * (safety reserve, confirmation gating) is layered on top of this
 * calculation.
 */
import { describe, it, expect } from 'vitest';
import { calcTrip } from '@/lib/tripFuelPlanner';

describe('calcTrip — parity with the pre-extraction TripCostEstimator.tsx implementation', () => {
  it('1. typical trip, current fuel covers it fully (sufficient, no stops)', () => {
    expect(calcTrip(146, 27, 14, 50, 3.49, 1)).toEqual({
      totalMiles: 146, totalGallons: 5.41, totalTripCost: 18.87,
      currentGalOffset: 5.41, currentCostOffset: 18.87,
      gallonsNeeded: 0, fuelCost: 0, stops: 0, stopsIfFull: 0,
      tankRange: 378, costPerPerson: null, milesPerDollar: 7.7,
      tankfulls: 0.4,
      summary: 'Great news — you already have enough fuel for the full 146-mile trip!',
    });
  });

  it('2. long trip, empty tank (fuelPct=0), multiple passengers, needs a stop', () => {
    expect(calcTrip(500, 32, 12, 0, 3.19, 4)).toEqual({
      totalMiles: 500, totalGallons: 15.63, totalTripCost: 49.84,
      currentGalOffset: 0, currentCostOffset: 0,
      gallonsNeeded: 15.63, fuelCost: 49.84, stops: 1, stopsIfFull: 1,
      tankRange: 384, costPerPerson: 12.46, milesPerDollar: 10,
      tankfulls: 1.3,
      summary: "This 500-mile trip needs 15.63 gal total ($49.84). You'll need to buy 15.63 gal ($49.84) on top of what's in your tank. Plan for 1 refuel stop on the road.",
    });
  });

  it('3. full tank (fuelPct=100) covers the whole trip', () => {
    expect(calcTrip(100, 24, 16, 100, 3.29, 1)).toEqual({
      totalMiles: 100, totalGallons: 4.17, totalTripCost: 13.71,
      currentGalOffset: 4.17, currentCostOffset: 13.71,
      gallonsNeeded: 0, fuelCost: 0, stops: 0, stopsIfFull: 0,
      tankRange: 384, costPerPerson: null, milesPerDollar: 7.3,
      tankfulls: 0.3,
      summary: 'Great news — you already have enough fuel for the full 100-mile trip!',
    });
  });

  it('4. partial fuel, two passengers, one stop needed (stops differs from stopsIfFull)', () => {
    expect(calcTrip(250, 18, 26, 20, 4.05, 2)).toEqual({
      totalMiles: 250, totalGallons: 13.89, totalTripCost: 56.25,
      currentGalOffset: 5.2, currentCostOffset: 21.06,
      gallonsNeeded: 8.69, fuelCost: 35.19, stops: 1, stopsIfFull: 0,
      tankRange: 468, costPerPerson: 17.6, milesPerDollar: 4.4,
      tankfulls: 0.5,
      summary: "This 250-mile trip needs 13.89 gal total ($56.25). You'll need to buy 8.69 gal ($35.19) on top of what's in your tank. Plan for 1 refuel stop on the road.",
    });
  });

  it('5. small hybrid trip, short distance', () => {
    expect(calcTrip(50, 50, 11.3, 75, 3.59, 1)).toEqual({
      totalMiles: 50, totalGallons: 1, totalTripCost: 3.59,
      currentGalOffset: 1, currentCostOffset: 3.59,
      gallonsNeeded: 0, fuelCost: 0, stops: 0, stopsIfFull: 0,
      tankRange: 565, costPerPerson: null, milesPerDollar: 13.9,
      tankfulls: 0.1,
      summary: 'Great news — you already have enough fuel for the full 50-mile trip!',
    });
  });

  it('6. long haul, low fuel, six passengers, two stops', () => {
    expect(calcTrip(1000, 16, 34, 10, 3.75, 6)).toEqual({
      totalMiles: 1000, totalGallons: 62.5, totalTripCost: 234.38,
      currentGalOffset: 3.4, currentCostOffset: 12.75,
      gallonsNeeded: 59.1, fuelCost: 221.63, stops: 2, stopsIfFull: 1,
      tankRange: 544, costPerPerson: 36.94, milesPerDollar: 4.3,
      tankfulls: 1.8,
      summary: "This 1,000-mile trip needs 62.50 gal total ($234.38). You'll need to buy 59.10 gal ($221.63) on top of what's in your tank. Plan for 2 refuel stops on the road.",
    });
  });

  it('7. edge case — zero-distance trip (boundary the UI can reach via a 0 mile input)', () => {
    const r = calcTrip(0, 27, 14, 50, 3.49, 1);
    expect(r.totalMiles).toBe(0);
    expect(r.gallonsNeeded).toBe(0);
    expect(r.stops).toBe(0);
    expect(r.summary).toBe('Great news — you already have enough fuel for the full 0-mile trip!');
  });

  it('8. edge case — zero MPG ("Enter manually" with an empty/zero MPG field) produces Infinity throughout, preserved as-is from the pre-move behavior', () => {
    const r = calcTrip(100, 0, 14, 50, 3.49, 1);
    // mpg=0 => totalGallons = 100/0 = Infinity, which propagates through
    // gallonsNeeded/fuelCost/stops/tankfulls. This is pre-existing, unchanged
    // behavior being preserved by the move (no new guard introduced here) —
    // the UI's own `validate()` is what actually prevents mpg=0 from reaching
    // this function in practice, not calcTrip itself.
    expect(r.totalGallons).toBe(Infinity);
    expect(r.gallonsNeeded).toBe(Infinity);
    expect(r.stops).toBe(Infinity);
    expect(r.tankfulls).toBe(Infinity);
    expect(r.currentGalOffset).toBe(7); // unaffected: min(14*0.5, Infinity) = 7
  });
});
