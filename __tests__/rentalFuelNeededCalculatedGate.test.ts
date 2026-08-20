/**
 * Growth Sprint 1, P0C-2A — regression coverage for
 * shouldTrackFuelNeededCalculated() (lib/rentalCalculations.ts), the pure
 * eligibility gate for the client-observed rental_fuel_needed_calculated
 * analytics event fired from components/rental-return/RentalDashboard.tsx.
 *
 * Extracted as a pure predicate specifically so this logic is testable
 * without rendering RentalDashboard (this repo has no React
 * component-testing infrastructure — see the P0C-2A implementation
 * report). This covers the semantic intent of RFA16-RFA21: a genuine,
 * meaningful calculation exists only for a non-upcoming rental with both a
 * real current fuel reading and a real return requirement on record —
 * never the render-time `?? 0` fallback used elsewhere for display.
 */
import { describe, it, expect } from 'vitest';
import { shouldTrackFuelNeededCalculated } from '../lib/rentalCalculations';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST   = new Date(Date.now() - 86_400_000).toISOString();

function session(overrides: Partial<{
  currentFuelGallons: number | null;
  requiredReturnFuelGallons: number | null;
  pickupDateTime: string | null;
}> = {}) {
  return {
    currentFuelGallons:        10,
    requiredReturnFuelGallons: 12,
    pickupDateTime:            PAST,
    ...overrides,
  };
}

describe('shouldTrackFuelNeededCalculated()', () => {
  it('RFA16. active/non-upcoming rental with both real readings → true', () => {
    expect(shouldTrackFuelNeededCalculated(session())).toBe(true);
  });

  it('RFA17. currentFuelGallons missing → false', () => {
    expect(shouldTrackFuelNeededCalculated(session({ currentFuelGallons: null }))).toBe(false);
  });

  it('RFA18. requiredReturnFuelGallons missing → false', () => {
    expect(shouldTrackFuelNeededCalculated(session({ requiredReturnFuelGallons: null }))).toBe(false);
  });

  it('RFA19. upcoming rental → false even with both readings present', () => {
    expect(shouldTrackFuelNeededCalculated(session({ pickupDateTime: FUTURE }))).toBe(false);
  });

  it('RFA20. unchanged relevant inputs across two calls → same (stable) result — no accidental flip', () => {
    const s = session();
    expect(shouldTrackFuelNeededCalculated(s)).toBe(shouldTrackFuelNeededCalculated(s));
  });

  it('RFA21. currentFuelGallons changes after a real fuel update → still eligible (would refire)', () => {
    const before = session({ currentFuelGallons: 10 });
    const after  = session({ currentFuelGallons: 8 });
    expect(shouldTrackFuelNeededCalculated(before)).toBe(true);
    expect(shouldTrackFuelNeededCalculated(after)).toBe(true);
  });

  it('no session at all → false', () => {
    expect(shouldTrackFuelNeededCalculated(null)).toBe(false);
    expect(shouldTrackFuelNeededCalculated(undefined)).toBe(false);
  });

  it('zero is a real reading, not "missing" — 0 gallons current still eligible', () => {
    expect(shouldTrackFuelNeededCalculated(session({ currentFuelGallons: 0 }))).toBe(true);
  });

  it('no pickupDateTime at all (same-day setup) is treated as in-progress, not upcoming → eligible', () => {
    expect(shouldTrackFuelNeededCalculated(session({ pickupDateTime: null }))).toBe(true);
  });
});
