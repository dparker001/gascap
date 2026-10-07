/**
 * FuelPriceSnapshot persistence (Phase 0.5B).
 *
 * WRITES: insert-only into FuelPriceSnapshot (createMany + skipDuplicates —
 * first-seen value wins, re-runs are no-ops). READS: EIA (public API).
 * Never touches any user table. See prisma/schema.prisma for the model and
 * lib/eiaAreas.ts for the verified product/area mapping.
 */
import { prisma } from './prisma';
import { EIA_SOURCE, fetchEiaObservations, type EiaObservation } from './eiaClient';
import {
  FUEL_GRADES,
  NATIONAL_AREA,
  duoareaChainForState,
  normalizeGrade,
  SNAPSHOT_AREAS,
  EIA_PRODUCT_BY_GRADE,
  type FuelGrade,
} from './eiaAreas';
import { observationAgeDays, isStaleObservation } from './eiaFreshness';
import {
  pickBaselineForNewFillup,
  type NationalSnapshots,
  type NewFillupBaseline,
  type SnapshotPoint,
} from './savingsBaseline';

const INSERT_CHUNK = 1000;
/** Hard cap so a bad `weeks` param can't request an unbounded backfill. */
export const MAX_BACKFILL_WEEKS = 156;

export function toSnapshotRows(obs: EiaObservation[]) {
  return obs.map((o) => ({
    source:     EIA_SOURCE,
    duoarea:    o.duoarea,
    product:    o.product,
    grade:      o.grade,
    observedOn: o.period,
    price:      o.price,
  }));
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  /** Newest national Regular observation we now hold, and its age. */
  latestObservedOn: string | null;
  ageDays: number | null;
  stale: boolean;
}

/**
 * Fetch the most recent `weeks` of EIA observations for every snapshot area
 * and grade and store any we don't already have. Throws if EIA is
 * unreachable or the key is missing — a cron run must FAIL visibly, not
 * report success having stored nothing.
 */
export async function syncFuelPriceSnapshots(opts: {
  weeks: number;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<SyncResult> {
  const weeks = Math.max(1, Math.min(MAX_BACKFILL_WEEKS, Math.floor(opts.weeks)));
  const obs = await fetchEiaObservations({
    areas: SNAPSHOT_AREAS,
    grades: FUEL_GRADES,
    weeks,
    fetchImpl: opts.fetchImpl,
  });
  if (obs.length === 0) throw new Error('EIA returned no valid observations');

  const rows = toSnapshotRows(obs);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const res = await prisma.fuelPriceSnapshot.createMany({
      data: rows.slice(i, i + INSERT_CHUNK),
      skipDuplicates: true,
    });
    inserted += res.count;
  }

  const latest = obs
    .filter((o) => o.duoarea === NATIONAL_AREA && o.grade === 'regular')
    .map((o) => o.period)
    .sort()
    .pop() ?? null;
  const now = opts.now ?? new Date();
  return {
    fetched: obs.length,
    inserted,
    latestObservedOn: latest,
    ageDays: latest ? observationAgeDays(latest, now) : null,
    stale: isStaleObservation(latest, now),
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

function shiftDate(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** National series per grade from `sinceDate` (inclusive) forward. */
export async function loadNationalSnapshots(sinceDate: string): Promise<NationalSnapshots> {
  const rows = await prisma.fuelPriceSnapshot.findMany({
    where: { source: EIA_SOURCE, duoarea: NATIONAL_AREA, observedOn: { gte: sinceDate } },
    select: { grade: true, observedOn: true, price: true },
    orderBy: { observedOn: 'asc' },
  });
  const out: NationalSnapshots = {};
  for (const r of rows) {
    const g = r.grade as FuelGrade;
    if (!(g in EIA_PRODUCT_BY_GRADE)) continue;
    (out[g] ??= []).push({ observedOn: r.observedOn, price: r.price });
  }
  return out;
}

/** Series per EIA area for one grade, covering the window just before `date`. */
export async function loadAreaSeriesNear(
  areas: string[],
  grade: FuelGrade,
  date: string,
): Promise<Record<string, SnapshotPoint[]>> {
  const rows = await prisma.fuelPriceSnapshot.findMany({
    where: {
      source: EIA_SOURCE,
      grade,
      duoarea: { in: areas },
      observedOn: { gte: shiftDate(date, -21), lte: date },
    },
    select: { duoarea: true, observedOn: true, price: true },
  });
  const out: Record<string, SnapshotPoint[]> = {};
  for (const r of rows) (out[r.duoarea] ??= []).push({ observedOn: r.observedOn, price: r.price });
  return out;
}

export interface LatestSnapshot {
  price: number;
  area: string;
  observedOn: string;
}

/** Newest stored observation for the first area in `chain` that has one. */
export async function latestSnapshotForChain(
  chain: string[],
  grade: FuelGrade = 'regular',
): Promise<LatestSnapshot | null> {
  for (const area of chain) {
    const row = await prisma.fuelPriceSnapshot.findFirst({
      where: { source: EIA_SOURCE, duoarea: area, grade },
      orderBy: { observedOn: 'desc' },
      select: { price: true, observedOn: true },
    });
    if (row) return { price: row.price, area, observedOn: row.observedOn };
  }
  return null;
}

/**
 * Baseline to freeze onto a NEW fill-up, or null when none is defensible
 * (unpriceable grade, no EIA observation within the allowed age, or the
 * snapshot table is unavailable). Best-effort by contract: callers must
 * treat null as "no baseline" and must never fail a fill-up because of it.
 * `state` is an optional 2-letter US state; only the coarse EIA area it maps
 * to is stored — never the state's finer location.
 */
export async function resolveNewFillupBaseline(args: {
  grade: string | null | undefined;
  date: string;
  state?: string | null;
}): Promise<NewFillupBaseline | null> {
  const grade = normalizeGrade(args.grade);
  if (!grade) return null;
  const chain = duoareaChainForState(args.state);
  const pointsByArea = await loadAreaSeriesNear(chain, grade, args.date);
  return pickBaselineForNewFillup({ grade, date: args.date, state: args.state, pointsByArea });
}
