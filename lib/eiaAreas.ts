/**
 * EIA weekly retail-price series: area + product mapping.
 *
 * Pure, zero-import module (safe for client and server, trivially testable).
 *
 * PRODUCT CODES — verified live against api.eia.gov/v2/petroleum/pri/gnd
 * (facet/product) on 2026-10-07:
 *
 *   EPMR   Regular Gasoline          <- GasCap "regular"
 *   EPMM   Midgrade Gasoline         <- GasCap "midgrade"
 *   EPMP   Premium Gasoline          <- GasCap "premium"
 *   EPD2D  No 2 Diesel               <- GasCap "diesel"
 *   EPM0   Total Gasoline            <- ALL GRADES BLENDED. Never a "regular"
 *                                       price. (/api/gas-price/history used
 *                                       it under a "Regular" label until
 *                                       Phase 0.5B; that day it read $4.496
 *                                       vs $4.354 for true Regular.)
 *
 * E85 has no EIA retail series here, so it has no baseline (see
 * normalizeGrade — unknown/unsupported grades are NEVER defaulted to regular).
 *
 * `period` in the EIA response is the survey date (a Monday) — the price's
 * real observation date. It is NOT the date we fetched it.
 */

export type FuelGrade = 'regular' | 'midgrade' | 'premium' | 'diesel';

export const EIA_PRODUCT_BY_GRADE: Record<FuelGrade, string> = {
  regular:  'EPMR',
  midgrade: 'EPMM',
  premium:  'EPMP',
  diesel:   'EPD2D',
};

export const GRADE_BY_EIA_PRODUCT: Record<string, FuelGrade> = {
  EPMR:  'regular',
  EPMM:  'midgrade',
  EPMP:  'premium',
  EPD2D: 'diesel',
};

export const FUEL_GRADES = Object.keys(EIA_PRODUCT_BY_GRADE) as FuelGrade[];

/**
 * Map a stored Fillup.fuelGrade string to a priceable grade.
 * Returns null for anything we cannot price honestly — including a missing
 * grade and "e85". A fill-up with no known grade is NOT assumed regular:
 * that is exactly the grade-mixing the old savings math got wrong.
 */
export function normalizeGrade(raw: string | null | undefined): FuelGrade | null {
  const g = (raw ?? '').trim().toLowerCase();
  return (FUEL_GRADES as string[]).includes(g) ? (g as FuelGrade) : null;
}

// ── Areas ───────────────────────────────────────────────────────────────────

/** PADD sub-region -> member states (mirrors scripts/generate-gas-price-seed.mjs). */
export const REGION_STATES: Record<string, string[]> = {
  R1X: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT'],
  R1Y: ['DE', 'DC', 'MD', 'NJ', 'NY', 'PA'],
  R1Z: ['FL', 'GA', 'NC', 'SC', 'VA', 'WV'],
  R20: ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'OK', 'SD', 'TN', 'WI'],
  R30: ['AL', 'AR', 'LA', 'MS', 'NM', 'TX'],
  R40: ['CO', 'ID', 'MT', 'UT', 'WY'],
  R50: ['AK', 'AZ', 'CA', 'HI', 'NV', 'OR', 'WA'],
};

/** States EIA publishes their own weekly series for (duoarea S{ST}). */
export const DIRECT_STATES = new Set(['CA', 'CO', 'FL', 'MA', 'MN', 'NY', 'OH', 'TX', 'WA']);

export const NATIONAL_AREA = 'NUS';

/** Every area we snapshot: national + 7 regions + 9 direct states = 17. */
export const SNAPSHOT_AREAS: string[] = [
  NATIONAL_AREA,
  ...Object.keys(REGION_STATES),
  ...[...DIRECT_STATES].sort().map((s) => `S${s}`),
];

/**
 * Ordered EIA areas to try for a state: own state series (if EIA has one),
 * then its PADD region, then national. Unknown/"US" -> national only.
 */
export function duoareaChainForState(state: string | null | undefined): string[] {
  const st = (state ?? '').trim().toUpperCase();
  for (const [region, states] of Object.entries(REGION_STATES)) {
    if (states.includes(st)) {
      return [...(DIRECT_STATES.has(st) ? [`S${st}`] : []), region, NATIONAL_AREA];
    }
  }
  return [NATIONAL_AREA];
}

/** True for a 2-letter code in a known region (50 states + DC). */
export function isKnownState(state: string | null | undefined): boolean {
  const st = (state ?? '').trim().toUpperCase();
  return Object.values(REGION_STATES).some((s) => s.includes(st));
}
