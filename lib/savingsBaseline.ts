/**
 * Savings baseline — the defensible-comparison rules (Phase 0.5B).
 *
 * Pure, zero-DB module. A fill-up is only given a savings figure when ALL of:
 *   1. it has a priceable fuel grade (regular/midgrade/premium/diesel). A
 *      missing or unsupported grade (e.g. e85) is NEVER assumed to be
 *      regular — that was the grade-mixing the old math did;
 *   2. an EIA observation of THAT grade exists on or before the fill date and
 *      no more than MAX_BASELINE_AGE_DAYS before it (time-matched — never
 *      "today's price" against a purchase from months ago);
 *   3. the numbers are internally sane (positive gallons/cost, price and
 *      total agree, and the gap to the baseline is not an obvious typo).
 * Otherwise the fill-up is EXCLUDED with an explicit reason and contributes
 * nothing — there is no fallback constant and no estimate.
 *
 * Savings can be negative (paid MORE than the average). That is reported
 * as-is; callers must not floor it at zero or hide it.
 */
import {
  duoareaChainForState,
  normalizeGrade,
  NATIONAL_AREA,
  type FuelGrade,
} from './eiaAreas';

/** One missed weekly EIA release (+ a day of slack) is tolerated; more is not. */
export const MAX_BASELINE_AGE_DAYS = 13;
/** |paid - baseline| above this ($/gal) is treated as an entry error, not savings. */
export const MAX_PLAUSIBLE_GAP = 3;
/** totalCost/gallons may differ from pricePerGallon by at most this fraction. */
const MAX_PRICE_TOTAL_MISMATCH = 0.5;
export const BASELINE_SOURCE = 'eia_weekly';

export interface SnapshotPoint {
  observedOn: string; // YYYY-MM-DD (EIA survey date)
  price: number;
}

const DAY_MS = 86_400_000;
function dayNumber(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

/**
 * Most recent point observed on/before `fillDate`, if within the allowed age.
 * Points may be in any order. Returns null when none qualifies — including a
 * fill-up that predates all stored history (we do not extrapolate backwards).
 */
export function findBaselineForDate(points: SnapshotPoint[], fillDate: string): SnapshotPoint | null {
  const fd = dayNumber(fillDate);
  if (fd === null) return null;
  let best: SnapshotPoint | null = null;
  let bestDay = -Infinity;
  for (const p of points) {
    const d = dayNumber(p.observedOn);
    if (d === null || d > fd) continue;
    if (d > bestDay) { best = p; bestDay = d; }
  }
  if (!best) return null;
  return fd - bestDay <= MAX_BASELINE_AGE_DAYS ? best : null;
}

export interface NewFillupBaseline {
  price: number;
  source: typeof BASELINE_SOURCE;
  /** EIA area actually used: own state series, PADD region, or 'NUS'. */
  area: string;
  /** EIA survey date of the price used. */
  period: string;
}

/**
 * Baseline to freeze onto a NEW fill-up. Walks the user's state -> region ->
 * national chain and uses the first area with a qualifying observation.
 * `pointsByArea` holds the already-loaded series for the fill-up's grade.
 */
export function pickBaselineForNewFillup(args: {
  grade: string | null | undefined;
  date: string;
  state?: string | null;
  pointsByArea: Record<string, SnapshotPoint[]>;
}): NewFillupBaseline | null {
  if (!normalizeGrade(args.grade)) return null;
  for (const area of duoareaChainForState(args.state)) {
    const hit = findBaselineForDate(args.pointsByArea[area] ?? [], args.date);
    if (hit) return { price: hit.price, source: BASELINE_SOURCE, area, period: hit.observedOn };
  }
  return null;
}

// ── Per-fill-up + aggregate savings ─────────────────────────────────────────

export interface SavingsFillup {
  id: string;
  date: string;
  gallonsPumped: number;
  pricePerGallon: number;
  totalCost: number;
  fuelGrade?: string | null;
  baselinePrice?: number | null;
  baselineSource?: string | null;
  baselineArea?: string | null;
  baselinePeriod?: string | null;
}

export type SavingsStatus = 'compared' | 'no_grade' | 'unsupported_grade' | 'no_baseline' | 'invalid';

export interface FillupSavings {
  id: string;
  status: SavingsStatus;
  grade?: FuelGrade;
  paidPerGallon?: number;
  baselinePrice?: number;
  baselinePeriod?: string;
  baselineArea?: string;
  /** 'stored' = frozen at log time; 'snapshot' = matched from history now. */
  origin?: 'stored' | 'snapshot';
  /** baseline cost - amount paid. Negative = paid more than the baseline. */
  savings?: number;
}

/** National series per grade — the fallback baseline for fill-ups with no stored one. */
export type NationalSnapshots = Partial<Record<FuelGrade, SnapshotPoint[]>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeFillupSavings(f: SavingsFillup, national: NationalSnapshots): FillupSavings {
  const rawGrade = (f.fuelGrade ?? '').trim();
  const grade = normalizeGrade(rawGrade);
  if (!grade) return { id: f.id, status: rawGrade ? 'unsupported_grade' : 'no_grade' };

  const gallons = f.gallonsPumped;
  if (!(gallons > 0) || !(f.totalCost > 0) || !(f.pricePerGallon > 0)) {
    return { id: f.id, status: 'invalid', grade };
  }
  const paidPerGallon = f.totalCost / gallons;
  if (Math.abs(paidPerGallon - f.pricePerGallon) / f.pricePerGallon > MAX_PRICE_TOTAL_MISMATCH) {
    return { id: f.id, status: 'invalid', grade };
  }

  // Prefer the baseline frozen when the fill-up was logged.
  let baselinePrice: number | undefined;
  let baselinePeriod: string | undefined;
  let baselineArea: string | undefined;
  let origin: 'stored' | 'snapshot' | undefined;

  if (
    typeof f.baselinePrice === 'number' && f.baselinePrice > 0 &&
    f.baselinePeriod && f.baselineSource === BASELINE_SOURCE
  ) {
    baselinePrice = f.baselinePrice;
    baselinePeriod = f.baselinePeriod;
    baselineArea = f.baselineArea ?? NATIONAL_AREA;
    origin = 'stored';
  } else {
    const hit = findBaselineForDate(national[grade] ?? [], f.date);
    if (hit) {
      baselinePrice = hit.price;
      baselinePeriod = hit.observedOn;
      baselineArea = NATIONAL_AREA;
      origin = 'snapshot';
    }
  }
  if (baselinePrice === undefined || !baselinePeriod || !baselineArea || !origin) {
    return { id: f.id, status: 'no_baseline', grade };
  }

  if (Math.abs(paidPerGallon - baselinePrice) > MAX_PLAUSIBLE_GAP) {
    return { id: f.id, status: 'invalid', grade };
  }

  return {
    id: f.id,
    status: 'compared',
    grade,
    paidPerGallon: Math.round(paidPerGallon * 1000) / 1000,
    baselinePrice,
    baselinePeriod,
    baselineArea,
    origin,
    savings: round2(baselinePrice * gallons - f.totalCost),
  };
}

export interface SavingsSummary {
  fillupsTotal: number;
  compared: number;
  excluded: Record<Exclude<SavingsStatus, 'compared'>, number>;
  gallonsCompared: number;
  spentCompared: number;
  baselineCostCompared: number;
  /** Net across compared fill-ups only. Negative = net above baseline. */
  netSavings: number;
  avgPaidPerGallon: number | null;
  avgBaselinePerGallon: number | null;
  perFillup: FillupSavings[];
}

export function summarizeSavings(fillups: SavingsFillup[], national: NationalSnapshots): SavingsSummary {
  const perFillup = fillups.map((f) => computeFillupSavings(f, national));
  const excluded = { no_grade: 0, unsupported_grade: 0, no_baseline: 0, invalid: 0 };
  let compared = 0, gallons = 0, spent = 0, baselineCost = 0;
  const byId = new Map(fillups.map((f) => [f.id, f]));

  for (const r of perFillup) {
    if (r.status !== 'compared') { excluded[r.status] += 1; continue; }
    const f = byId.get(r.id)!;
    compared += 1;
    gallons += f.gallonsPumped;
    spent += f.totalCost;
    baselineCost += (r.baselinePrice as number) * f.gallonsPumped;
  }

  return {
    fillupsTotal: fillups.length,
    compared,
    excluded,
    gallonsCompared: round2(gallons),
    spentCompared: round2(spent),
    baselineCostCompared: round2(baselineCost),
    netSavings: round2(baselineCost - spent),
    avgPaidPerGallon: gallons > 0 ? Math.round((spent / gallons) * 1000) / 1000 : null,
    avgBaselinePerGallon: gallons > 0 ? Math.round((baselineCost / gallons) * 1000) / 1000 : null,
    perFillup,
  };
}
