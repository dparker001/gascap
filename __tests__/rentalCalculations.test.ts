import { describe, it, expect } from 'vitest';
import {
  gallonsNeeded,
  estimatedFuelCost,
  estimatedRentalCompanyCharge,
  estimatedSavings,
  returnReadyStatus,
  resolveRequiredReturnFuel,
  formatGallons,
  roundCurrency,
  roundGallons,
} from '../lib/rentalCalculations';
import { gallonsFromGaugeFraction, gallonsFromPercent } from '../lib/rentalProvider';

// ── Pilot spec scenarios (section 39) ───────────────────────────────────────

describe('gallonsNeeded()', () => {
  it('Scenario 1: pickup 14.1, return target 14.1, current 12.6 → 1.5', () => {
    expect(gallonsNeeded(14.1, 12.6)).toBe(1.5);
  });

  it('Scenario 2: target 14.1, current 14.3 (over) → 0', () => {
    expect(gallonsNeeded(14.1, 14.3)).toBe(0);
  });

  it('never goes negative', () => {
    expect(gallonsNeeded(10, 20)).toBe(0);
  });

  it('treats invalid/negative inputs as 0', () => {
    expect(gallonsNeeded(-5, 10)).toBe(0);
    expect(gallonsNeeded(10, -5)).toBe(0);
  });
});

describe('gallonsFromGaugeFraction() — Scenario 3', () => {
  it('3/4 tank of a 15-gallon tank → 11.25 internally, displays ~11.3', () => {
    const gallons = gallonsFromGaugeFraction('3/4', 15);
    expect(gallons).toBeCloseTo(11.25, 5);
    expect(formatGallons(gallons, 'MANUAL_GAUGE')).toBe('~11.3 gal');
  });

  it('handles all documented fractions', () => {
    expect(gallonsFromGaugeFraction('full', 15)).toBe(15);
    expect(gallonsFromGaugeFraction('7/8', 16)).toBeCloseTo(14, 5);
    expect(gallonsFromGaugeFraction('1/2', 15)).toBe(7.5);
    expect(gallonsFromGaugeFraction('1/8', 16)).toBe(2);
    expect(gallonsFromGaugeFraction('empty', 15)).toBe(0);
  });

  it('returns null for unknown fraction or missing tank capacity', () => {
    expect(gallonsFromGaugeFraction('nonsense', 15)).toBeNull();
    expect(gallonsFromGaugeFraction('3/4', 0)).toBeNull();
  });
});

describe('gallonsFromPercent()', () => {
  it('95% of a 15-gal tank → 14.25 (unrounded — display rounding is a separate step)', () => {
    expect(gallonsFromPercent(95, 15)).toBeCloseTo(14.25, 5);
  });

  it('rejects out-of-range percentages', () => {
    expect(gallonsFromPercent(-1, 15)).toBeNull();
    expect(gallonsFromPercent(101, 15)).toBeNull();      // over 100
    expect(gallonsFromPercent(150, 15)).toBeNull();
  });

  it('0% is valid (empty tank)', () => {
    expect(gallonsFromPercent(0, 15)).toBe(0);
  });
});

describe('estimatedFuelCost() — Scenario 4', () => {
  it('1.5 gal @ $3.09/gal → $4.64', () => {
    expect(estimatedFuelCost(1.5, 3.09)).toBe(4.64);
  });

  it('zero gallons needed → $0', () => {
    expect(estimatedFuelCost(0, 3.09)).toBe(0);
  });

  it('invalid price → $0, never invents a number', () => {
    expect(estimatedFuelCost(1.5, 0)).toBe(0);
    expect(estimatedFuelCost(1.5, -1)).toBe(0);
  });
});

describe('estimatedRentalCompanyCharge() — Scenario 5', () => {
  it('1.5 gal @ $5.11/gal → $7.67', () => {
    expect(estimatedRentalCompanyCharge(1.5, 5.11)).toBe(7.67);
  });

  it('unknown rate → null, never guessed', () => {
    expect(estimatedRentalCompanyCharge(1.5, null)).toBeNull();
    expect(estimatedRentalCompanyCharge(1.5, undefined)).toBeNull();
    expect(estimatedRentalCompanyCharge(1.5, 0)).toBeNull();
  });

  it('zero gallons needed with a known rate → $0, not null', () => {
    expect(estimatedRentalCompanyCharge(0, 5.11)).toBe(0);
  });
});

describe('estimatedSavings() — Scenario 6', () => {
  it('$7.67 rental charge vs $4.64 self cost → $3.03 savings', () => {
    expect(estimatedSavings(7.67, 4.64)).toBe(3.03);
  });

  it('null rental charge (unknown rate) → null savings, not zero', () => {
    expect(estimatedSavings(null, 4.64)).toBeNull();
  });

  it('can be negative if self-refuel somehow costs more (station price spike)', () => {
    expect(estimatedSavings(4.64, 7.67)).toBe(-3.03);
  });
});

// ── returnReadyStatus ────────────────────────────────────────────────────

describe('returnReadyStatus()', () => {
  it('at or above target → return_ready', () => {
    expect(returnReadyStatus(14.1, 14.1)).toBe('return_ready');
    expect(returnReadyStatus(14.3, 14.1)).toBe('return_ready');
  });

  it('within tolerance but under target → nearly_ready', () => {
    expect(returnReadyStatus(13.9, 14.1, 0.3)).toBe('nearly_ready');
  });

  it('meaningfully under target → needs_fuel', () => {
    expect(returnReadyStatus(12.6, 14.1)).toBe('needs_fuel');
  });

  it('missing data defaults to needs_fuel, never a false "ready"', () => {
    expect(returnReadyStatus(null, 14.1)).toBe('needs_fuel');
    expect(returnReadyStatus(12.6, null)).toBe('needs_fuel');
  });

  it('respects a custom tolerance', () => {
    expect(returnReadyStatus(13.0, 14.1, 1.5)).toBe('nearly_ready');
    expect(returnReadyStatus(13.0, 14.1, 1.0)).toBe('needs_fuel');
  });
});

// ── resolveRequiredReturnFuel ────────────────────────────────────────────

describe('resolveRequiredReturnFuel()', () => {
  it('same_as_pickup (default) mirrors pickup level, not a full tank', () => {
    expect(resolveRequiredReturnFuel('same_as_pickup', 14.1, 18)).toBe(14.1);
  });

  it('full uses tank capacity', () => {
    expect(resolveRequiredReturnFuel('full', 14.1, 18)).toBe(18);
  });

  it('exact uses the provided value, not pickup or capacity', () => {
    expect(resolveRequiredReturnFuel('exact', 14.1, 18, 16)).toBe(16);
  });

  it('missing pickup data under same_as_pickup → null, not a guess', () => {
    expect(resolveRequiredReturnFuel('same_as_pickup', null, 18)).toBeNull();
  });
});

// ── formatGallons — false-precision guard (section 32) ──────────────────

describe('formatGallons()', () => {
  it('manual sources always show ~ prefix', () => {
    expect(formatGallons(11.25, 'MANUAL_GAUGE')).toBe('~11.3 gal');
    expect(formatGallons(11.25, 'MANUAL_PERCENT')).toBe('~11.3 gal');
    expect(formatGallons(11.25, 'MANUAL_GALLONS')).toBe('~11.3 gal');
  });

  it('authoritative Level 2 sources show no ~ prefix', () => {
    expect(formatGallons(12.6, 'RENTAL_COMPANY_API')).toBe('12.6 gal');
    expect(formatGallons(12.6, 'VEHICLE_TELEMATICS')).toBe('12.6 gal');
  });

  it('missing value renders an em dash, not 0 or NaN', () => {
    expect(formatGallons(null, 'MANUAL_GAUGE')).toBe('—');
    expect(formatGallons(undefined, 'MANUAL_GAUGE')).toBe('—');
  });

  it('missing source defaults to estimated (safer than claiming authority)', () => {
    expect(formatGallons(12.6, null)).toBe('~12.6 gal');
  });
});

// ── rounding helpers ─────────────────────────────────────────────────────

describe('roundCurrency() / roundGallons()', () => {
  it('rounds currency to cents', () => {
    expect(roundCurrency(4.634999999999999)).toBe(4.63);
    expect(roundCurrency(4.635)).toBe(4.64);
  });

  it('rounds gallons to tenths', () => {
    expect(roundGallons(11.249999)).toBe(11.2);
    expect(roundGallons(11.25)).toBe(11.3);
  });
});
