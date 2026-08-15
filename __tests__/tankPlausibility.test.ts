import { describe, it, expect } from 'vitest';
import { tankBandForVClass, checkTankPlausibility, bandMidpoint } from '../lib/tankPlausibility';

describe('tank plausibility by EPA size class', () => {
  it('catches the reported Pathfinder case', () => {
    // 14 gal was accepted for a Standard SUV whose real tank is ~19.5.
    expect(checkTankPlausibility(14, 'Standard Sport Utility Vehicle 4WD')).toBe('out_of_band');
    expect(checkTankPlausibility(19.5, 'Standard Sport Utility Vehicle 4WD')).toBe('ok');
  });

  it('prefers the most specific class match', () => {
    // "Standard Sport Utility" and "Sport Utility" both match the string —
    // longest key must win, or a standard SUV inherits the wider band.
    expect(tankBandForVClass('Standard Sport Utility Vehicle 4WD')).toEqual({ min: 15, max: 30 });
    expect(tankBandForVClass('Small Sport Utility Vehicle 2WD')).toEqual({ min: 11, max: 20 });
    // Minivan must not be swallowed by the shorter "van".
    expect(tankBandForVClass('Minivan - 2WD')).toEqual({ min: 16, max: 22 });
  });

  it('returns unknown_class rather than failing an unrecognised class', () => {
    // Never block a lookup on a check we cannot perform.
    expect(checkTankPlausibility(14, 'Some New EPA Class')).toBe('unknown_class');
    expect(checkTankPlausibility(14, null)).toBe('unknown_class');
    expect(checkTankPlausibility(null, 'Midsize Cars')).toBe('unknown_class');
  });

  it('accepts real factory tanks across classes', () => {
    const real: Array<[number, string]> = [
      [15.8, 'Midsize Cars'],            // Camry
      [12.4, 'Compact Cars'],            // Civic
      [26.0, 'Standard Pickup Trucks 4WD'],
      [28.0, 'Standard Sport Utility Vehicle 4WD'],
      [19.0, 'Minivan - 2WD'],
      [14.5, 'Small Sport Utility Vehicle 4WD'],
    ];
    for (const [g, c] of real) expect(checkTankPlausibility(g, c)).toBe('ok');
  });

  it('uses the midpoint, not the nearest bound, as last resort', () => {
    // A clamp lands on the edge of plausibility — for a Standard SUV that's
    // 15 gal against a real 19.5, still low and still biased the costly way.
    expect(bandMidpoint({ min: 15, max: 30 })).toBe(22.5);
  });
});
