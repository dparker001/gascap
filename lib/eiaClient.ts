/**
 * Minimal EIA v2 client for the weekly retail petroleum series
 * (petroleum/pri/gnd). READ-ONLY against a public API.
 *
 * Parsing and URL construction are pure so they can be tested against real
 * EIA response shapes without the network. A "row" is only accepted when it
 * carries a real observation date (`period`, YYYY-MM-DD) and a plausible
 * price — anything else is dropped rather than coerced, so a malformed
 * upstream response can never become a stored price.
 */
import { EIA_PRODUCT_BY_GRADE, GRADE_BY_EIA_PRODUCT, type FuelGrade } from './eiaAreas';

export const EIA_SOURCE = 'eia_weekly';
const EIA_BASE = 'https://api.eia.gov/v2/petroleum/pri/gnd/data/';

/** Retail $/gal sanity bounds. Outside this, the value is a data error. */
export const MIN_PLAUSIBLE_PRICE = 0.5;
export const MAX_PLAUSIBLE_PRICE = 15;

export interface EiaObservation {
  duoarea: string;
  product: string;
  grade:   FuelGrade;
  /** EIA survey date, YYYY-MM-DD — the price's real observation date. */
  period:  string;
  price:   number;
}

const PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: raw EIA JSON -> validated observations (invalid rows dropped). */
export function parseEiaRows(json: unknown): EiaObservation[] {
  const rows = (json as { response?: { data?: unknown } } | null)?.response?.data;
  if (!Array.isArray(rows)) return [];
  const out: EiaObservation[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const grade = GRADE_BY_EIA_PRODUCT[String(r.product ?? '')];
    const period = String(r.period ?? '');
    const duoarea = String(r.duoarea ?? '');
    const price = typeof r.value === 'number' ? r.value : parseFloat(String(r.value ?? ''));
    if (!grade || !PERIOD_RE.test(period) || !duoarea) continue;
    if (!Number.isFinite(price) || price < MIN_PLAUSIBLE_PRICE || price > MAX_PLAUSIBLE_PRICE) continue;
    out.push({
      duoarea,
      product: String(r.product),
      grade,
      period,
      price: Math.round(price * 1000) / 1000,
    });
  }
  return out;
}

/** Pure: build one EIA request URL. The API key is passed in, never logged. */
export function buildEiaUrl(opts: {
  apiKey: string;
  areas: string[];
  grades: FuelGrade[];
  length: number;
}): string {
  const u = new URL(EIA_BASE);
  u.searchParams.set('api_key', opts.apiKey);
  u.searchParams.set('frequency', 'weekly');
  u.searchParams.append('data[0]', 'value');
  for (const a of opts.areas) u.searchParams.append('facets[duoarea][]', a);
  for (const g of opts.grades) u.searchParams.append('facets[product][]', EIA_PRODUCT_BY_GRADE[g]);
  u.searchParams.append('sort[0][column]', 'period');
  u.searchParams.append('sort[0][direction]', 'desc');
  u.searchParams.set('length', String(opts.length));
  return u.toString();
}

export interface FetchEiaOptions {
  areas: string[];
  grades: FuelGrade[];
  /** Number of most-recent weekly periods wanted per (area, grade). */
  weeks: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch recent weekly observations. One request per grade keeps each under
 * EIA's 5,000-row page limit (17 areas x 156 weeks = 2,652). The requests run
 * IN PARALLEL: EIA answers in ~7–10 s per request regardless of size (measured
 * 2026-10-07), so sequential grades would take 30–40 s. Results are merged in
 * grade order so output is deterministic. Throws on a non-OK response so a
 * cron run fails visibly instead of silently storing nothing; per-grade
 * results that simply have no rows are fine.
 */
export async function fetchEiaObservations(opts: FetchEiaOptions): Promise<EiaObservation[]> {
  const apiKey = opts.apiKey ?? process.env.EIA_API_KEY ?? '';
  if (!apiKey) throw new Error('EIA_API_KEY not configured');
  const doFetch = opts.fetchImpl ?? fetch;

  const perGrade = await Promise.all(opts.grades.map(async (grade) => {
    const url = buildEiaUrl({
      apiKey,
      areas: opts.areas,
      grades: [grade],
      length: Math.min(5000, opts.weeks * opts.areas.length),
    });
    const res = await doFetch(url, { signal: AbortSignal.timeout(40000) });
    if (!res.ok) throw new Error(`EIA responded ${res.status} for grade ${grade}`);
    return parseEiaRows(await res.json());
  }));
  return perGrade.flat();
}
