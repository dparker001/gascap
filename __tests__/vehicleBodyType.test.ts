import { describe, it, expect } from 'vitest';
import { inferBodyType } from '../lib/vehicleBodyType';

describe('inferBodyType()', () => {
  it('prefers an explicit NHTSA bodyClass over everything else', () => {
    // Tank size alone would say "pickup"; bodyClass wins.
    expect(inferBodyType({ bodyClass: 'Sedan/Saloon', model: 'F-150', tankGallons: 30 })).toBe('sedan');
    expect(inferBodyType({ bodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' })).toBe('suv');
    expect(inferBodyType({ bodyClass: 'Pickup' })).toBe('pickup');
    expect(inferBodyType({ bodyClass: 'Minivan' })).toBe('van');
  });

  it('falls back to model name when bodyClass is missing (the Y/M/M path)', () => {
    expect(inferBodyType({ model: 'Terrain' })).toBe('suv');
    expect(inferBodyType({ model: 'F-150' })).toBe('pickup');
    expect(inferBodyType({ model: 'Pacifica' })).toBe('van');
    expect(inferBodyType({ model: 'Camry' })).toBe('sedan');
    expect(inferBodyType({ model: 'Versa' })).toBe('compact');
  });

  it('matches model names case-insensitively and within longer strings', () => {
    expect(inferBodyType({ model: 'GMC TERRAIN FWD' })).toBe('suv');
    expect(inferBodyType({ model: 'Ford F-150 SuperCrew' })).toBe('pickup');
  });

  it('falls back to tank size for models it does not recognize', () => {
    expect(inferBodyType({ model: 'Unknown Model', tankGallons: 10 })).toBe('compact');
    expect(inferBodyType({ model: 'Unknown Model', tankGallons: 14 })).toBe('sedan');
    expect(inferBodyType({ model: 'Unknown Model', tankGallons: 18 })).toBe('suv');
    expect(inferBodyType({ model: 'Unknown Model', tankGallons: 23 })).toBe('van');
    expect(inferBodyType({ model: 'Unknown Model', tankGallons: 30 })).toBe('pickup');
  });

  it('defaults to sedan when there is nothing to go on', () => {
    expect(inferBodyType({})).toBe('sedan');
    expect(inferBodyType({ model: '', tankGallons: 0 })).toBe('sedan');
    expect(inferBodyType({ model: null, tankGallons: null, bodyClass: null })).toBe('sedan');
  });

  it('ignores an unrecognized bodyClass rather than failing', () => {
    // Falls through to the model name instead of returning something wrong.
    expect(inferBodyType({ bodyClass: 'Incomplete Chassis', model: 'Odyssey' })).toBe('van');
  });
});
