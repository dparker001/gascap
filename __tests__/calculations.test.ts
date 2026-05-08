import { describe, it, expect } from 'vitest';
import {
  round,
  calcTargetFill,
  calcBudget,
  validateTargetFill,
  validateBudget,
} from '../lib/calculations';

// ─────────────────────────────────────────────
//  round()
// ─────────────────────────────────────────────
describe('round()', () => {
  it('rounds to 2 decimal places by default', () => {
    expect(round(1.234567, 2)).toBe(1.23);
    expect(round(1.675, 2)).toBe(1.68);
    expect(round(2.005, 2)).toBe(2.01);
  });

  it('rounds to specified decimal places', () => {
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(1.23456, 1)).toBe(1.2);
    expect(round(1.23456, 0)).toBe(1);
  });

  it('handles 0 decimals', () => {
    expect(round(4.9, 0)).toBe(5);
    expect(round(4.4, 0)).toBe(4);
  });

  it('handles negative numbers', () => {
    expect(round(-1.234, 2)).toBe(-1.23);
    expect(round(-1.235, 2)).toBe(-1.24);
    expect(round(-1.6, 0)).toBe(-2);
  });

  it('handles zero', () => {
    expect(round(0, 2)).toBe(0);
  });
});

// ─────────────────────────────────────────────
//  calcTargetFill()
// ─────────────────────────────────────────────
describe('calcTargetFill()', () => {
  it('calculates a normal fill from percent', () => {
    const result = calcTargetFill({
      tankCapacity: 15,
      currentFuelPercent: 25,  // 3.75 gal
      targetPercent: 75,       // 11.25 gal → need 7.5 gal
      pricePerGallon: 3.50,
    });
    expect(result.gallonsNeeded).toBe(7.5);
    expect(result.estimatedCost).toBe(round(7.5 * 3.50, 2));
    expect(result.currentGallons).toBe(3.75);
    expect(result.targetGallons).toBe(11.25);
    expect(result.currentPercent).toBe(25);
    expect(result.targetPercent).toBe(75);
  });

  it('returns gallonsNeeded=0 when already at or above target', () => {
    const result = calcTargetFill({
      tankCapacity: 15,
      currentFuelPercent: 80,
      targetPercent: 75,
      pricePerGallon: 3.50,
    });
    expect(result.gallonsNeeded).toBe(0);
    expect(result.estimatedCost).toBe(0);
    expect(result.summary).toContain('No fuel needed');
  });

  it('uses currentFuelGallons when both are provided (gallons takes precedence)', () => {
    const result = calcTargetFill({
      tankCapacity: 20,
      currentFuelPercent: 50,  // would be 10 gal — should be ignored
      currentFuelGallons: 5,   // 5 gal — takes precedence
      targetPercent: 100,
      pricePerGallon: 4.00,
    });
    expect(result.currentGallons).toBe(5);
    expect(result.gallonsNeeded).toBe(15);
    expect(result.estimatedCost).toBe(60);
  });

  it('caps currentFuelGallons at tankCapacity', () => {
    const result = calcTargetFill({
      tankCapacity: 15,
      currentFuelGallons: 20,  // exceeds tank
      targetPercent: 100,
      pricePerGallon: 3.00,
    });
    expect(result.currentGallons).toBe(15);
    expect(result.gallonsNeeded).toBe(0);
  });

  it('handles price=0 (no cost)', () => {
    const result = calcTargetFill({
      tankCapacity: 20,
      currentFuelPercent: 0,
      targetPercent: 50,
      pricePerGallon: 0,
    });
    expect(result.gallonsNeeded).toBe(10);
    expect(result.estimatedCost).toBe(0);
  });

  it('produces a summary mentioning "a full tank" when targetPercent=100', () => {
    const result = calcTargetFill({
      tankCapacity: 15,
      currentFuelPercent: 0,
      targetPercent: 100,
      pricePerGallon: 3.50,
    });
    expect(result.summary).toContain('a full tank');
  });

  it('produces a summary with percent when targetPercent is not 100', () => {
    const result = calcTargetFill({
      tankCapacity: 15,
      currentFuelPercent: 0,
      targetPercent: 50,
      pricePerGallon: 3.50,
    });
    expect(result.summary).toContain('50%');
  });
});

// ─────────────────────────────────────────────
//  calcBudget()
// ─────────────────────────────────────────────
describe('calcBudget()', () => {
  it('calculates a normal budget fill', () => {
    const result = calcBudget({
      tankCapacity: 15,
      currentFuelPercent: 0,
      pricePerGallon: 3.50,
      budget: 35,  // 35/3.50 = 10 gal
    });
    expect(result.gallonsAffordable).toBe(10);
    expect(result.resultingGallons).toBe(10);
    expect(result.wouldOverfill).toBe(false);
    expect(result.actualCost).toBe(35);
  });

  it('caps at tank capacity and sets wouldOverfill=true', () => {
    const result = calcBudget({
      tankCapacity: 15,
      currentFuelPercent: 50,  // 7.5 gal in
      pricePerGallon: 2.00,
      budget: 100, // would buy 50 gal — way over capacity
    });
    expect(result.wouldOverfill).toBe(true);
    expect(result.resultingGallons).toBe(15);
    expect(result.gallonsAffordable).toBe(7.5);
    expect(result.summary).toContain('more than fill');
  });

  it('returns gallonsAffordable=0 when budget is too small for 1 gallon', () => {
    const result = calcBudget({
      tankCapacity: 15,
      currentFuelPercent: 100,  // already full
      pricePerGallon: 5.00,
      budget: 1,
    });
    // Tank is full, so 0 gallons can be added regardless of budget
    expect(result.gallonsAffordable).toBe(0);
  });

  it('handles currentFuelGallons taking precedence over percent', () => {
    const result = calcBudget({
      tankCapacity: 20,
      currentFuelPercent: 0,   // should be ignored
      currentFuelGallons: 5,
      pricePerGallon: 2.00,
      budget: 10,
    });
    expect(result.currentGallons).toBe(5);
    expect(result.gallonsAffordable).toBe(5);
    expect(result.resultingGallons).toBe(10);
  });

  it('summary mentions budget amount for normal fill', () => {
    const result = calcBudget({
      tankCapacity: 20,
      currentFuelPercent: 0,
      pricePerGallon: 4.00,
      budget: 20,
    });
    expect(result.summary).toContain('$20.00');
  });
});

// ─────────────────────────────────────────────
//  validateTargetFill()
// ─────────────────────────────────────────────
describe('validateTargetFill()', () => {
  const validInput = {
    tankCapacity: 15,
    currentFuelPercent: 25,
    targetPercent: 75,
    pricePerGallon: 3.50,
    fuelInputMode: 'percent' as const,
  };

  it('returns empty errors for valid input', () => {
    const errors = validateTargetFill(validInput);
    expect(errors).toEqual({});
  });

  it('errors on invalid tank size (zero)', () => {
    const errors = validateTargetFill({ ...validInput, tankCapacity: 0 });
    expect(errors.tankCapacity).toBeTruthy();
  });

  it('errors on tank size too large (>200)', () => {
    const errors = validateTargetFill({ ...validInput, tankCapacity: 201 });
    expect(errors.tankCapacity).toBeTruthy();
  });

  it('errors when price is too high (>$20)', () => {
    const errors = validateTargetFill({ ...validInput, pricePerGallon: 20.01 });
    expect(errors.pricePerGallon).toBeTruthy();
  });

  it('errors when current fuel gallons exceeds tank capacity (gallons mode)', () => {
    const errors = validateTargetFill({
      ...validInput,
      fuelInputMode: 'gallons',
      tankCapacity: 15,
      currentFuelGallons: 20,  // exceeds tank
    });
    expect(errors.currentFuel).toBeTruthy();
  });

  it('errors when current fuel percent is out of range', () => {
    const errors = validateTargetFill({ ...validInput, currentFuelPercent: 110 });
    expect(errors.currentFuel).toBeTruthy();
  });

  it('errors when target percent is missing', () => {
    const { targetPercent: _omit, ...rest } = validInput;
    const errors = validateTargetFill(rest as typeof validInput);
    expect(errors.targetPercent).toBeTruthy();
  });
});

// ─────────────────────────────────────────────
//  validateBudget()
// ─────────────────────────────────────────────
describe('validateBudget()', () => {
  const validInput = {
    tankCapacity: 15,
    currentFuelPercent: 25,
    pricePerGallon: 3.50,
    budget: 20,
    fuelInputMode: 'percent' as const,
  };

  it('returns empty errors for valid input', () => {
    const errors = validateBudget(validInput);
    expect(errors).toEqual({});
  });

  it('errors when budget is 0', () => {
    const errors = validateBudget({ ...validInput, budget: 0 });
    expect(errors.budget).toBeTruthy();
  });

  it('errors when budget is negative', () => {
    const errors = validateBudget({ ...validInput, budget: -5 });
    expect(errors.budget).toBeTruthy();
  });

  it('errors on invalid tank size', () => {
    const errors = validateBudget({ ...validInput, tankCapacity: -1 });
    expect(errors.tankCapacity).toBeTruthy();
  });

  it('errors when price per gallon is zero', () => {
    const errors = validateBudget({ ...validInput, pricePerGallon: 0 });
    expect(errors.pricePerGallon).toBeTruthy();
  });

  it('errors when price per gallon exceeds $20', () => {
    const errors = validateBudget({ ...validInput, pricePerGallon: 21 });
    expect(errors.pricePerGallon).toBeTruthy();
  });

  it('errors when current fuel gallons exceeds tank capacity (gallons mode)', () => {
    const errors = validateBudget({
      ...validInput,
      fuelInputMode: 'gallons',
      tankCapacity: 10,
      currentFuelGallons: 15,
    });
    expect(errors.currentFuel).toBeTruthy();
  });
});
