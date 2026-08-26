/**
 * Phase 3A canonical calculation engine (2026-08-25) — proves the
 * lib/fuelMath.ts extraction did not change any externally-visible
 * calculator output. lib/calculations.ts and lib/rentalCalculations.ts now
 * both call into lib/fuelMath.ts's shared primitives instead of
 * independently reimplementing round/gallons-needed/cost-for-gallons; this
 * file locks in the exact numeric outputs both calculators produced before
 * that refactor.
 */
import { describe, it, expect } from 'vitest';
import { calcTargetFill, calcBudget, round } from '@/lib/calculations';
import { gallonsNeeded, estimatedFuelCost, roundCurrency, roundGallons } from '@/lib/rentalCalculations';
import { roundTo, gallonsToFill, costForGallons, gallonsFromPercent } from '@/lib/fuelMath';

describe('lib/fuelMath.ts primitives', () => {
  it('roundTo matches the prior round() behavior at various decimal counts', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
    expect(roundTo(3.14159, 0)).toBe(3);
    expect(roundTo(1.005, 2)).toBe(1); // floating-point edge case, same as before
  });

  it('gallonsToFill never goes negative and rounds to the requested precision', () => {
    expect(gallonsToFill(10, 4, 2)).toBe(6);
    expect(gallonsToFill(4, 10, 2)).toBe(0);
    expect(gallonsToFill(10.456, 4.123, 1)).toBe(6.3);
  });

  it('costForGallons multiplies and rounds', () => {
    expect(costForGallons(6, 3.5, 2)).toBe(21);
    expect(costForGallons(6.789, 3.111, 2)).toBe(21.12);
  });

  it('gallonsFromPercent scales and caps at tank capacity', () => {
    expect(gallonsFromPercent(50, 14)).toBe(7);
    expect(gallonsFromPercent(100, 14)).toBe(14);
    expect(gallonsFromPercent(150, 14)).toBe(14); // capped, defensive
  });
});

describe('Personal calculator parity (lib/calculations.ts)', () => {
  it('calcTargetFill — percent mode, unchanged from pre-refactor output', () => {
    const result = calcTargetFill({ tankCapacity: 14, currentFuelPercent: 25, targetPercent: 100, pricePerGallon: 3.19 });
    expect(result.currentGallons).toBe(3.5);
    expect(result.currentPercent).toBe(25);
    expect(result.targetGallons).toBe(14);
    expect(result.gallonsNeeded).toBe(10.5);
    expect(result.estimatedCost).toBe(33.49);
  });

  it('calcTargetFill — gallons mode, unchanged from pre-refactor output', () => {
    const result = calcTargetFill({ tankCapacity: 16, currentFuelGallons: 6, targetPercent: 75, pricePerGallon: 3.5 });
    expect(result.targetGallons).toBe(12);
    expect(result.gallonsNeeded).toBe(6);
    expect(result.estimatedCost).toBe(21);
  });

  it('calcTargetFill — already at/above target, no fuel needed', () => {
    const result = calcTargetFill({ tankCapacity: 14, currentFuelGallons: 14, targetPercent: 50, pricePerGallon: 3.19 });
    expect(result.gallonsNeeded).toBe(0);
    expect(result.estimatedCost).toBe(0);
  });

  it('calcBudget — unchanged from pre-refactor output', () => {
    const result = calcBudget({ tankCapacity: 14, currentFuelGallons: 2, pricePerGallon: 3.2, budget: 20 });
    expect(result.gallonsAffordableUncapped).toBe(6.25);
    expect(result.wouldOverfill).toBe(false);
    expect(result.gallonsAffordable).toBe(6.25);
    expect(result.actualCost).toBe(20);
  });

  it('calcBudget — overfill cap, unchanged from pre-refactor output', () => {
    const result = calcBudget({ tankCapacity: 10, currentFuelGallons: 8, pricePerGallon: 3, budget: 50 });
    expect(result.wouldOverfill).toBe(true);
    expect(result.gallonsAffordable).toBe(2);
    expect(result.actualCost).toBe(6);
  });

  it('round() still behaves exactly as before (thin wrapper over roundTo)', () => {
    expect(round(3.14159)).toBe(3.14);
    expect(round(3.14159, 3)).toBe(3.142);
  });
});

describe('Rental calculator parity (lib/rentalCalculations.ts)', () => {
  it('gallonsNeeded — unchanged from pre-refactor output (1-decimal rounding)', () => {
    expect(gallonsNeeded(12, 4.35)).toBe(7.7);
    expect(gallonsNeeded(4, 10)).toBe(0);
    expect(gallonsNeeded(-1, 4)).toBe(0);
  });

  it('estimatedFuelCost — unchanged from pre-refactor output (2-decimal rounding)', () => {
    expect(estimatedFuelCost(7.7, 3.19)).toBe(24.56);
    expect(estimatedFuelCost(0, 3.19)).toBe(0);
  });

  it('roundCurrency/roundGallons thin wrappers match prior standalone implementations', () => {
    expect(roundCurrency(21.005)).toBe(21.01); // floating-point edge case, same as the prior standalone implementation
    expect(roundGallons(7.68)).toBe(7.7);
  });
});
