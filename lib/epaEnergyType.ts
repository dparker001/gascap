/**
 * Is a FuelEconomy.gov record's economy figure actually MPG?
 * (WS02 Phase 1, PR #87 review round 1, 2026-10-20.)
 *
 * `comb08` / `city08` / `highway08` are **MPGe** for electric, natural-gas and
 * hydrogen vehicles, and plain MPG for liquid-fuelled ones. `/api/mpg-lookup`
 * read those three fields and nothing else, so GasCap could hand Trip Planner
 * a battery-electric car's MPGe as though it were gasoline MPG.
 *
 * The dangerous case is not the one that looks absurd. A 2024 Nissan LEAF
 * reports `comb08: 111`, which is obviously not a gasoline figure — but a 2015
 * Honda Civic Natural Gas reports `comb08: 31`, which is a completely
 * plausible MPG and is **gasoline-gallon-equivalent**, not MPG. No numeric
 * sanity check can tell those apart. Only the fuel type can.
 *
 * ── Which field decides ──────────────────────────────────────────────────
 * `fuelType1` is definitionally the fuel that `comb08`/`city08`/`highway08`
 * describe; a dual-fuel record puts fuel 2's economy in `combA08`/`cityA08`/
 * `highwayA08`. So `fuelType1` is the classifier and `atvType` is only a
 * corroborating deny. That is also what makes a plug-in hybrid come out right:
 * its `comb08` IS its gasoline-mode MPG.
 *
 * ── Verified against the live API, not assumed ──────────────────────────
 * Every string below was read from https://www.fueleconomy.gov/ws/rest on
 * 2026-10-20 (public, no key, read-only), per the engineering contract's
 * provider-contract rule that mocks come from real payloads:
 *
 * | id    | vehicle                       | atvType           | fuelType1        | fuelType2   | comb08 |
 * |-------|-------------------------------|-------------------|------------------|-------------|--------|
 * | 47085 | 2024 Toyota Camry             | `''`              | Regular Gasoline | `''`        | 26 ✅ |
 * | 35622 | 2015 VW Jetta 2.0             | `''`              | Regular Gasoline | `''`        | 26 ✅ |
 * | 35433 | 2015 VW Jetta TDI             | `Diesel`          | Diesel           | `''`        | 35 ✅ |
 * | 47243 | 2024 Toyota Prius             | `Hybrid`          | Regular Gasoline | `''`        | 57 ✅ |
 * | 47500 | 2024 Toyota Prius Prime       | `Plug-in Hybrid`  | Regular Gasoline | Electricity | 48 ✅ (combA08 114 = MPGe) |
 * | 46973 | 2024 Nissan LEAF              | `EV`              | Electricity      | `''`        | 111 ❌ MPGe |
 * | 35886 | 2015 Honda Civic Natural Gas  | `CNG`             | Natural Gas      | `''`        | 31 ❌ MPGe |
 * | 47545 | 2022 Hyundai Nexo Blue        | `FCV`             | Hydrogen         | `''`        | 61 ❌ |
 *
 * ── Verified against the COMPLETE dataset (2026-10-21) ──────────────────
 * Re-checked against FuelEconomy.gov's own bulk export
 * (feg/epadata/vehicles.csv, 50,407 records) rather than sampled records,
 * to settle the bifuel question and to enumerate every value that exists.
 *
 * `atvType` has exactly 11 values, and this classifier's verdict for each:
 *   (blank) 43,547 → accept 43,537 / deny 10   Hybrid 1,899 → accept all
 *   EV 1,608 → deny all                        FFV 1,538 → accept all
 *   Diesel 1,246 → accept all                  Plug-in Hybrid 447 → accept all
 *   CNG 50 → deny all                          FCV 42 → deny all
 *   Bifuel (CNG) 20 → accept all               Bifuel (LPG) 8 → accept all
 *   eFCV 2 → deny both
 *
 * `fuelType1` has exactly 8 values, all handled: Regular Gasoline 31,390,
 * Premium Gasoline 15,813, Electricity 1,608, Diesel 1,318, Midgrade
 * Gasoline 174, Natural Gas 60, Hydrogen 42, and empty 2.
 *
 * ── Why fuelType1 is the classifier and not atvType ─────────────────────
 * Ten dedicated natural-gas vehicles carry a BLANK `atvType` — among them a
 * 1999 Honda Civic whose model name is simply "Civic", with
 * `fuelType1: 'Natural Gas'` and `comb08: 27`. An atvType-driven classifier
 * would have served that 27 as gasoline MPG. Only `fuelType1` reveals it.
 *
 * ── Bifuel: accepted, and that is correct ───────────────────────────────
 * All 20 `Bifuel (CNG)` and all 8 `Bifuel (LPG)` records have
 * `fuelType1: 'Regular Gasoline'` with the alternative fuel in `fuelType2`,
 * and both `comb08` and `combA08` populated — `comb08` being the GASOLINE
 * figure (2015 Impala Bi-Fuel: comb08 20 gasoline / combA08 19 CNG;
 * 2003 F150 Dual-fuel LPG: comb08 15 gasoline / combA08 11 propane).
 * Supporting an alternative fuel is not a reason to discard a valid gasoline
 * MPG, so these are accepted — which is why `atvType` is matched EXACTLY
 * rather than as a substring.
 *
 * ── Deny by default ─────────────────────────────────────────────────────
 * An unrecognised `fuelType1` is `unknown` and NOT gallon-based. A new or
 * renamed energy type must fail closed: showing no MPG is a small loss, while
 * showing an energy-equivalent number as MPG silently corrupts every trip
 * cost, gallons-needed and dollar figure derived from it.
 *
 * Nothing here converts MPGe to MPG. There is no honest conversion — they
 * measure different things.
 */

export type EpaEnergyType =
  // Gallon-based: comb08 is real MPG.
  | 'gasoline'
  | 'diesel'
  | 'hybrid_gasoline'        // conventional hybrid — still a gasoline MPG
  | 'phev_gasoline_mode'     // plug-in hybrid — comb08 is the gasoline-mode MPG
  | 'flex_fuel'              // E85-capable; comb08 is the gasoline figure
  // NOT gallon-based: comb08 is MPGe or otherwise not gallons.
  | 'electric'
  | 'natural_gas'
  | 'hydrogen'
  | 'propane'
  | 'unknown';

export interface EpaEnergyClassification {
  energyType: EpaEnergyType;
  /** True only when comb08/city08/highway08 are gallons-based MPG. */
  gallonBased: boolean;
  /** Short explanation, safe to surface to a caller. Never a raw API blob. */
  detail: string;
}

/** Shape this reads. Everything is `unknown` because it comes off the wire. */
export interface EpaEnergyFields {
  fuelType1?: unknown;
  fuelType2?: unknown;
  atvType?:   unknown;
}

const lower = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase() : '';

/**
 * `atvType` values whose economy figures are never gallons. Matched exactly
 * (after lowercasing), deliberately NOT as substrings: `Bifuel (CNG)` and
 * `Bifuel (LPG)` contain these tokens but are gasoline-primary records whose
 * `comb08` is the gasoline figure, and a substring match would throw away a
 * perfectly good MPG.
 *
 * `efcv` was added 2026-10-21 after the full-dataset check turned it up —
 * the 2025/2026 Honda CR-V e-FCEV, a hydrogen fuel-cell EV reporting
 * `comb08: 39` with an EMPTY `fuelType1`. It was already refused before this
 * (empty fuelType1 falls through to the fail-closed branch), so this is a
 * labelling fix, not a safety fix: it makes the refusal explicit and lets the
 * UI say "hydrogen" rather than "could not confirm".
 */
const NON_GALLON_ATV_TYPES = new Set(['ev', 'fcv', 'efcv', 'cng']);

/**
 * Classify a FuelEconomy.gov record by the fuel its `comb08` describes.
 */
export function classifyEpaEnergyType(v: EpaEnergyFields): EpaEnergyClassification {
  const atv   = lower(v.atvType);
  const fuel1 = lower(v.fuelType1);
  const fuel2 = lower(v.fuelType2);

  // Belt-and-braces: a record self-identifying as battery-electric, fuel-cell
  // or dedicated CNG is refused whatever fuelType1 says. In every verified
  // sample these agree; this exists so they cannot disagree silently.
  if (NON_GALLON_ATV_TYPES.has(atv)) {
    const byAtv: EpaEnergyType =
      atv === 'ev' ? 'electric'
        : (atv === 'fcv' || atv === 'efcv') ? 'hydrogen'
        : 'natural_gas';
    return {
      energyType:  byAtv,
      gallonBased: false,
      detail:      `EPA reports this vehicle as ${v.atvType as string}; its economy figures are energy-equivalent, not miles per gallon.`,
    };
  }

  // Non-gallon primary fuels. Checked BEFORE the gasoline test so a record
  // like "Premium and Electricity" can never be read as gasoline by accident.
  if (fuel1.includes('electricity') || fuel1.includes('electric')) {
    return { energyType: 'electric', gallonBased: false, detail: 'This is an electric vehicle — EPA reports MPGe, not MPG.' };
  }
  if (fuel1.includes('natural gas') || fuel1 === 'cng') {
    return { energyType: 'natural_gas', gallonBased: false, detail: 'This is a natural-gas vehicle — EPA reports gasoline-gallon-equivalent, not MPG.' };
  }
  if (fuel1.includes('hydrogen')) {
    return { energyType: 'hydrogen', gallonBased: false, detail: 'This is a hydrogen fuel-cell vehicle — EPA reports MPGe, not MPG.' };
  }
  if (fuel1.includes('propane') || fuel1.includes('lpg')) {
    return { energyType: 'propane', gallonBased: false, detail: 'This is a propane vehicle — GasCap does not price propane.' };
  }

  // Gallon-based primary fuels.
  if (fuel1.includes('diesel')) {
    return { energyType: 'diesel', gallonBased: true, detail: 'Diesel — EPA figures are miles per gallon.' };
  }
  if (fuel1.includes('gasoline') || fuel1.includes('gas and electricity')) {
    // Refine the label from atvType. A plug-in hybrid's comb08 is its
    // gasoline-mode MPG (verified: Prius Prime comb08 48 vs combA08 114).
    if (atv === 'plug-in hybrid') {
      return { energyType: 'phev_gasoline_mode', gallonBased: true, detail: 'Plug-in hybrid — this is the gasoline-mode MPG, not the electric MPGe.' };
    }
    if (atv === 'hybrid') {
      return { energyType: 'hybrid_gasoline', gallonBased: true, detail: 'Hybrid — EPA figures are miles per gallon.' };
    }
    if (atv === 'ffv' || fuel2.includes('e85') || fuel2.includes('ethanol')) {
      return { energyType: 'flex_fuel', gallonBased: true, detail: 'Flex-fuel — this is the gasoline figure.' };
    }
    return { energyType: 'gasoline', gallonBased: true, detail: 'Gasoline — EPA figures are miles per gallon.' };
  }
  if (fuel1.includes('e85') || fuel1.includes('ethanol')) {
    return { energyType: 'flex_fuel', gallonBased: true, detail: 'Ethanol blend — EPA figures are miles per gallon.' };
  }

  // Unrecognised: fail closed.
  return {
    energyType:  'unknown',
    gallonBased: false,
    detail:      'GasCap could not confirm this vehicle runs on gasoline or diesel, so it will not treat the EPA figure as MPG.',
  };
}

/** Convenience: may this record's comb08 be used as gallon-based MPG? */
export function isGallonBasedEpaRecord(v: EpaEnergyFields): boolean {
  return classifyEpaEnergyType(v).gallonBased;
}
