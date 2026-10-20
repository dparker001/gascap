/**
 * WS02 PR #87 review finding 1 — MPGe must never be presented as MPG.
 *
 * Old behaviour this regresses against: /api/mpg-lookup read `comb08`,
 * `city08` and `hwy08` and nothing else. `legacyAcceptTrim` below reproduces
 * that exactly, and the first tests assert it accepts a battery-electric
 * car's 111 MPGe and a natural-gas car's 31 MPGe as gasoline MPG.
 *
 * Every fixture below is a REAL FuelEconomy.gov payload, read from
 * https://www.fueleconomy.gov/ws/rest on 2026-10-20 (public, no key,
 * read-only) — not an assumed shape. That is the engineering contract's
 * provider-contract rule: a mock invented from memory can agree with itself
 * and still disagree with the provider.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  classifyEpaEnergyType, isGallonBasedEpaRecord, type EpaEnergyFields,
} from '@/lib/epaEnergyType';

const read = (p: string) => readFileSync(path.resolve(__dirname, '..', p), 'utf8');

// ── Real FuelEconomy.gov records (abridged to the fields under test) ──────
const GASOLINE_CAMRY   = { id: '47085', atvType: '',                fuelType1: 'Regular Gasoline', fuelType2: '',            comb08: '26', city08: '22', hwy08: '33' };
const GASOLINE_JETTA   = { id: '35622', atvType: '',                fuelType1: 'Regular Gasoline', fuelType2: '',            comb08: '26', city08: '22', hwy08: '33' };
const DIESEL_JETTA_TDI = { id: '35433', atvType: 'Diesel',          fuelType1: 'Diesel',           fuelType2: '',            comb08: '35', city08: '31', hwy08: '43' };
const HYBRID_PRIUS     = { id: '47243', atvType: 'Hybrid',          fuelType1: 'Regular Gasoline', fuelType2: '',            comb08: '57' };
const PHEV_PRIUS_PRIME = { id: '47500', atvType: 'Plug-in Hybrid',  fuelType1: 'Regular Gasoline', fuelType2: 'Electricity', comb08: '48', combA08: '114' };
const BEV_LEAF         = { id: '46973', atvType: 'EV',              fuelType1: 'Electricity',      fuelType2: '',            comb08: '111', city08: '123', hwy08: '99' };
const CNG_CIVIC        = { id: '35886', atvType: 'CNG',             fuelType1: 'Natural Gas',      fuelType2: '',            comb08: '31', city08: '27', hwy08: '38' };
const FCV_NEXO         = { id: '47545', atvType: 'FCV',             fuelType1: 'Hydrogen',         fuelType2: '',            comb08: '61', city08: '65', hwy08: '58' };

/** Exactly what the route did before the guard: read comb08, accept it. */
function legacyAcceptTrim(v: { comb08?: string | number | null }): number | null {
  const comb = Number(v.comb08) || 0;
  return comb > 0 ? comb : null;
}

/** What the route does now, per trim, before anything is averaged. */
function guardedAcceptTrim(v: EpaEnergyFields & { comb08?: string | number | null }): number | null {
  if (!isGallonBasedEpaRecord(v)) return null;
  const comb = Number(v.comb08) || 0;
  return comb > 0 ? comb : null;
}

describe('the gap being closed', () => {
  it('old behaviour: a BEV s 111 MPGe was accepted as 111 MPG', () => {
    expect(legacyAcceptTrim(BEV_LEAF)).toBe(111);
    expect(guardedAcceptTrim(BEV_LEAF)).toBeNull();
  });

  it('old behaviour: a CNG car s 31 MPGe was accepted as 31 MPG — and 31 looks entirely plausible', () => {
    // This is the dangerous one. No numeric sanity check can catch it: 31 is a
    // perfectly ordinary gasoline MPG. Only the fuel type reveals it.
    expect(legacyAcceptTrim(CNG_CIVIC)).toBe(31);
    expect(legacyAcceptTrim(CNG_CIVIC)).toBe(legacyAcceptTrim(GASOLINE_CAMRY)! + 5);
    expect(guardedAcceptTrim(CNG_CIVIC)).toBeNull();
  });

  it('the route reads the energy fields and classifies before using the numbers', () => {
    const src = read('app/api/mpg-lookup/route.ts');
    expect(src).toMatch(/classifyEpaEnergyType/);
    expect(src).toMatch(/fuelType1\?:\s*unknown/);
    expect(src).toMatch(/atvType\?:\s*unknown/);
    // A non-gallon record returns no MPG at all — there is no conversion
    // factor to apply, because MPGe and MPG measure different things.
    expect(src).toMatch(/if \(!cls\.gallonBased\) return unsupported\(/);
    expect(src).toMatch(/function unsupported[\s\S]{0,240}ok:\s+false/);
  });
});

describe('accepted: gallon-based vehicles keep working', () => {
  it('gasoline', () => {
    expect(classifyEpaEnergyType(GASOLINE_CAMRY)).toEqual({
      energyType: 'gasoline', gallonBased: true, detail: expect.any(String),
    });
    expect(guardedAcceptTrim(GASOLINE_CAMRY)).toBe(26);
  });

  it('diesel', () => {
    expect(classifyEpaEnergyType(DIESEL_JETTA_TDI).energyType).toBe('diesel');
    expect(guardedAcceptTrim(DIESEL_JETTA_TDI)).toBe(35);
  });

  it('conventional hybrid', () => {
    expect(classifyEpaEnergyType(HYBRID_PRIUS).energyType).toBe('hybrid_gasoline');
    expect(guardedAcceptTrim(HYBRID_PRIUS)).toBe(57);
  });

  it('gasoline-primary PHEV uses its GASOLINE-mode figure, not its electric MPGe', () => {
    expect(classifyEpaEnergyType(PHEV_PRIUS_PRIME).energyType).toBe('phev_gasoline_mode');
    // comb08 (48) is the gasoline MPG; combA08 (114) is the electric MPGe.
    // The accepted number must be the former.
    expect(guardedAcceptTrim(PHEV_PRIUS_PRIME)).toBe(48);
    expect(guardedAcceptTrim(PHEV_PRIUS_PRIME)).not.toBe(114);
  });

  it('flex-fuel is gallons-based (comb08 is the gasoline figure)', () => {
    expect(classifyEpaEnergyType({ atvType: 'FFV', fuelType1: 'Regular Gasoline', fuelType2: 'E85' }))
      .toMatchObject({ energyType: 'flex_fuel', gallonBased: true });
  });

  it('premium and midgrade gasoline are gasoline', () => {
    for (const f of ['Premium Gasoline', 'Midgrade Gasoline', 'Premium']) {
      // 'Premium' alone has no "gasoline" token and is correctly treated as
      // unconfirmed — fail closed rather than guess.
      const c = classifyEpaEnergyType({ fuelType1: f });
      if (f === 'Premium') expect(c.gallonBased, f).toBe(false);
      else                 expect(c.gallonBased, f).toBe(true);
    }
  });

  it('a bifuel CNG record is gasoline-primary and is NOT caught by a substring match', () => {
    // atvType 'Bifuel (CNG)' contains "cng" but comb08 is the gasoline figure.
    // Matching atvType exactly is what keeps this valid MPG usable.
    expect(classifyEpaEnergyType({ atvType: 'Bifuel (CNG)', fuelType1: 'Regular Gasoline', fuelType2: 'Natural Gas' }))
      .toMatchObject({ gallonBased: true });
  });
});

describe('rejected: non-gallon vehicles', () => {
  it('BEV with a positive, large-looking comb08', () => {
    expect(classifyEpaEnergyType(BEV_LEAF)).toMatchObject({ energyType: 'electric', gallonBased: false });
  });

  it('CNG with a positive, plausible-looking comb08', () => {
    expect(classifyEpaEnergyType(CNG_CIVIC)).toMatchObject({ energyType: 'natural_gas', gallonBased: false });
  });

  it('hydrogen fuel cell', () => {
    expect(classifyEpaEnergyType(FCV_NEXO)).toMatchObject({ energyType: 'hydrogen', gallonBased: false });
  });

  it('propane / LPG', () => {
    expect(classifyEpaEnergyType({ fuelType1: 'Propane' }).gallonBased).toBe(false);
    expect(classifyEpaEnergyType({ fuelType1: 'LPG' }).gallonBased).toBe(false);
  });

  it('a mixed "gas and electricity" fuelType1 is never read as plain gasoline', () => {
    // atvType carries the truth here; fuelType1 of 'Premium and Electricity'
    // must not be accepted just because it mentions a liquid.
    expect(classifyEpaEnergyType({ atvType: 'EV', fuelType1: 'Premium and Electricity' }).gallonBased).toBe(false);
  });

  it('fails CLOSED on an unrecognised or missing energy type', () => {
    for (const f of [undefined, null, '', '   ', 'Antimatter', 42, {}, []]) {
      const c = classifyEpaEnergyType({ fuelType1: f });
      expect(c.energyType, String(f)).toBe('unknown');
      expect(c.gallonBased, String(f)).toBe(false);
    }
  });

  it('atvType EV/FCV/CNG overrides a contradictory fuelType1', () => {
    // Belt-and-braces: if the two fields ever disagree, refuse.
    expect(classifyEpaEnergyType({ atvType: 'EV',  fuelType1: 'Regular Gasoline' }).gallonBased).toBe(false);
    expect(classifyEpaEnergyType({ atvType: 'FCV', fuelType1: 'Diesel' }).gallonBased).toBe(false);
    expect(classifyEpaEnergyType({ atvType: 'CNG', fuelType1: 'Regular Gasoline' }).gallonBased).toBe(false);
  });

  it('classification is case- and whitespace-insensitive', () => {
    expect(classifyEpaEnergyType({ atvType: '  ev  ', fuelType1: 'ELECTRICITY' }).gallonBased).toBe(false);
    expect(classifyEpaEnergyType({ fuelType1: '  regular gasoline  ' }).gallonBased).toBe(true);
  });
});

describe('year/make/model averaging never mixes energy types', () => {
  /** The route's per-trim filter, then average — in that order. */
  function averageCompatible(trims: (EpaEnergyFields & { comb08?: string | number })[]) {
    const accepted: number[] = [];
    const rejected: string[] = [];
    for (const t of trims) {
      const cls = classifyEpaEnergyType(t);
      if (!cls.gallonBased) { rejected.push(cls.energyType); continue; }
      const comb = Number(t.comb08) || 0;
      if (comb > 0) accepted.push(comb);
    }
    return {
      combMpg: accepted.length
        ? Math.round(accepted.reduce((a, b) => a + b, 0) / accepted.length)
        : null,
      trimsUsed: accepted.length,
      trimsRejected: rejected.length,
      rejectedTypes: rejected,
    };
  }

  function legacyAverage(trims: { comb08?: string | number }[]) {
    const vals = trims.map((t) => Number(t.comb08) || 0).filter((n) => n > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  it('a model line sold in gasoline AND battery-electric form does not average MPGe into MPG', () => {
    const line = [GASOLINE_CAMRY, BEV_LEAF];
    // Old behaviour: (26 + 111) / 2 = 69 "MPG" — a number describing nothing.
    expect(legacyAverage(line)).toBe(69);
    // New behaviour: the BEV trim never enters the average.
    expect(averageCompatible(line)).toEqual({
      combMpg: 26, trimsUsed: 1, trimsRejected: 1, rejectedTypes: ['electric'],
    });
  });

  it('filtering happens BEFORE the average, so detecting the EV afterwards would be too late', () => {
    // Three gasoline trims and one BEV. Post-hoc detection of "this line has
    // an EV" cannot recover 26 from the already-computed 47.
    const line = [GASOLINE_CAMRY, GASOLINE_JETTA, HYBRID_PRIUS, BEV_LEAF];
    expect(legacyAverage(line)).toBe(55);
    expect(averageCompatible(line).combMpg).toBe(36);   // (26+26+57)/3
    expect(averageCompatible(line).trimsRejected).toBe(1);
  });

  it('a gasoline + diesel line averages normally — both are gallons', () => {
    expect(averageCompatible([GASOLINE_JETTA, DIESEL_JETTA_TDI])).toEqual({
      combMpg: 31, trimsUsed: 2, trimsRejected: 0, rejectedTypes: [],
    });
  });

  it('a CNG trim beside gasoline trims is excluded despite a plausible number', () => {
    const r = averageCompatible([GASOLINE_CAMRY, CNG_CIVIC]);
    expect(r.combMpg).toBe(26);
    expect(r.rejectedTypes).toEqual(['natural_gas']);
  });

  it('no compatible configuration yields a safe unsupported result, not a number', () => {
    const r = averageCompatible([BEV_LEAF, FCV_NEXO]);
    expect(r.combMpg).toBeNull();
    expect(r.trimsUsed).toBe(0);
    expect(r.trimsRejected).toBe(2);
  });

  it('an empty trim list yields no number', () => {
    expect(averageCompatible([]).combMpg).toBeNull();
  });
});

describe('the route distinguishes three outcomes for callers', () => {
  const src = read('app/api/mpg-lookup/route.ts');

  it('valid gallon MPG carries energyType and gallonBased', () => {
    expect(src).toMatch(/ok:\s+true/);
    expect(src).toMatch(/gallonBased: true/);
    expect(src).toMatch(/energyType/);
  });

  it('unsupported energy type is its own reason, separate from no-data', () => {
    expect(src).toMatch(/reason: 'unsupported_energy_type'/);
    expect(src).toMatch(/reason: 'no_epa_data'/);
    expect(src).toMatch(/reason: 'not_found'/);
  });

  it('backward compatibility: success still carries combMpg/cityMpg/hwyMpg and ok', () => {
    expect(src).toMatch(/combMpg/);
    expect(src).toMatch(/cityMpg/);
    expect(src).toMatch(/hwyMpg/);
  });

  it('a non-gallon vehicle cannot be calculated in the gas Trip Planner', () => {
    const tce = read('components/TripCostEstimator.tsx');
    expect(tce).toMatch(/if \(unsupportedEnergy\) return;/);
    expect(tce).toMatch(/disabled=\{mpgLookingUp \|\| unsupportedEnergy !== null\}/);
    expect(tce).toMatch(/notGallonVehicleTitle/);
  });

  it('both languages carry the non-gallon copy', () => {
    const tr = read('lib/translations.ts');
    for (const k of ['notGallonVehicleTitle', 'notGallonElectric', 'notGallonNaturalGas', 'notGallonHydrogen', 'notGallonUnknown']) {
      expect(tr.split(new RegExp(`\\b${k}:`)).length - 1, k).toBe(2);
    }
  });
});
