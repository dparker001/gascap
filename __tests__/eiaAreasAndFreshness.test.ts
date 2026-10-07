/**
 * Phase 0.5B — EIA area/grade mapping and freshness rules (pure modules).
 */
import { describe, it, expect } from 'vitest';
import {
  EIA_PRODUCT_BY_GRADE,
  GRADE_BY_EIA_PRODUCT,
  FUEL_GRADES,
  SNAPSHOT_AREAS,
  duoareaChainForState,
  isKnownState,
  normalizeGrade,
} from '@/lib/eiaAreas';
import { STALE_AFTER_DAYS, isStaleObservation, observationAgeDays } from '@/lib/eiaFreshness';

describe('EIA product/grade mapping (verified against api.eia.gov facet/product, 2026-10-07)', () => {
  it('maps each GasCap grade to its own EIA product', () => {
    expect(EIA_PRODUCT_BY_GRADE).toEqual({
      regular: 'EPMR', midgrade: 'EPMM', premium: 'EPMP', diesel: 'EPD2D',
    });
  });

  it('never maps Total Gasoline (EPM0) to any grade — it is all grades blended', () => {
    expect(Object.values(EIA_PRODUCT_BY_GRADE)).not.toContain('EPM0');
    expect(GRADE_BY_EIA_PRODUCT['EPM0']).toBeUndefined();
  });

  it('reverse map round-trips', () => {
    for (const g of FUEL_GRADES) expect(GRADE_BY_EIA_PRODUCT[EIA_PRODUCT_BY_GRADE[g]]).toBe(g);
  });
});

describe('normalizeGrade — unknown grade is never assumed to be regular', () => {
  it('accepts the four priceable grades, case/space-insensitive', () => {
    expect(normalizeGrade('regular')).toBe('regular');
    expect(normalizeGrade(' Premium ')).toBe('premium');
    expect(normalizeGrade('DIESEL')).toBe('diesel');
    expect(normalizeGrade('midgrade')).toBe('midgrade');
  });
  it('returns null for missing, empty, e85 and junk', () => {
    for (const v of [undefined, null, '', '  ', 'e85', 'E85', 'ethanol', '87']) {
      expect(normalizeGrade(v as string | null | undefined)).toBeNull();
    }
  });
});

describe('duoareaChainForState', () => {
  it('state with its own EIA series: state -> region -> national', () => {
    expect(duoareaChainForState('FL')).toEqual(['SFL', 'R1Z', 'NUS']);
    expect(duoareaChainForState('ca')).toEqual(['SCA', 'R50', 'NUS']);
  });
  it('state without its own series: region -> national', () => {
    expect(duoareaChainForState('GA')).toEqual(['R1Z', 'NUS']);
    expect(duoareaChainForState('AK')).toEqual(['R50', 'NUS']);
  });
  it('unknown / US / empty -> national only', () => {
    expect(duoareaChainForState('US')).toEqual(['NUS']);
    expect(duoareaChainForState('')).toEqual(['NUS']);
    expect(duoareaChainForState(null)).toEqual(['NUS']);
    expect(duoareaChainForState('ZZ')).toEqual(['NUS']);
  });
  it('isKnownState', () => {
    expect(isKnownState('DC')).toBe(true);
    expect(isKnownState('US')).toBe(false);
  });
  it('every chain area is one we actually snapshot', () => {
    for (const st of ['FL', 'GA', 'TX', 'AK', 'NY', 'MN', 'ID']) {
      for (const a of duoareaChainForState(st)) expect(SNAPSHOT_AREAS).toContain(a);
    }
    expect(SNAPSHOT_AREAS).toHaveLength(17);
  });
});

describe('EIA observation freshness', () => {
  const now = new Date('2026-10-07T18:00:00Z');
  it('age is whole UTC days since the EIA survey date', () => {
    expect(observationAgeDays('2026-10-05', now)).toBe(2);
    expect(observationAgeDays('2026-10-07', now)).toBe(0);
  });
  it('a normal weekly cadence (up to ~9 days, holiday release) is NOT stale', () => {
    expect(isStaleObservation('2026-09-28', now)).toBe(false); // 9 days
    expect(isStaleObservation('2026-09-23', now)).toBe(false); // 14 days == threshold
  });
  it(`older than ${STALE_AFTER_DAYS} days is stale`, () => {
    expect(isStaleObservation('2026-09-22', now)).toBe(true);  // 15 days
  });
  it('the committed seed (2026-06-23) is stale today', () => {
    expect(isStaleObservation('2026-06-23', now)).toBe(true);
  });
  it('missing/unparseable is treated as stale, never as fresh', () => {
    expect(isStaleObservation(null, now)).toBe(true);
    expect(isStaleObservation('', now)).toBe(true);
    expect(isStaleObservation('not-a-date', now)).toBe(true);
    expect(observationAgeDays('2026-13-45x', now)).toBeNull();
  });
});
