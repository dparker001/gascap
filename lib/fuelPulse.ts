/**
 * Gamification G1 — the fuel intelligence shown with the Daily Fuel Check.
 *
 * Real data only: the latest NATIONAL EIA weekly observation for a grade, its
 * actual survey week, and the week-over-week change when two consecutive weekly
 * observations exist. It is NOT the user's local station price, never a
 * prediction, and carries no BUY/WAIT advice. When there is no observation (or
 * no usable previous week) the corresponding fields are null and the UI says so.
 */
import { prisma } from './prisma';
import { EIA_SOURCE } from './eiaClient';
import { NATIONAL_AREA, normalizeGrade, type FuelGrade } from './eiaAreas';
import { isStaleObservation, observationAgeDays } from './eiaFreshness';

export const PULSE_GRADES: FuelGrade[] = ['regular', 'midgrade', 'premium', 'diesel'];

export interface FuelPulse {
  grade: FuelGrade;
  /** Latest national weekly average ($/gal) — null when none is stored. */
  price: number | null;
  /** EIA survey date (YYYY-MM-DD) of that price — its real observation date. */
  period: string | null;
  /** Latest minus previous week ($/gal); null unless the prior observation is ~1 week earlier. */
  change: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  /** True when the newest observation is older than the shared staleness threshold. */
  stale: boolean;
  ageDays: number | null;
}

export interface PulsePoint { observedOn: string; price: number }

const DAY_MS = 86_400_000;
const ymdMs = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** Pure: build the pulse from the newest observations (any order). */
export function buildFuelPulse(grade: FuelGrade, points: PulsePoint[], now: Date = new Date()): FuelPulse {
  const sorted = [...points]
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.observedOn) && Number.isFinite(p.price))
    .sort((a, b) => (a.observedOn < b.observedOn ? 1 : -1));
  const latest = sorted[0];
  if (!latest) return { grade, price: null, period: null, change: null, direction: null, stale: true, ageDays: null };

  // Week-over-week only when the previous observation is a real prior WEEK
  // (5–10 days earlier). A missing week must not be presented as a weekly change.
  const prev = sorted[1];
  let change: number | null = null;
  if (prev) {
    const gapDays = (ymdMs(latest.observedOn) - ymdMs(prev.observedOn)) / DAY_MS;
    if (gapDays >= 5 && gapDays <= 10) change = Math.round((latest.price - prev.price) * 1000) / 1000;
  }
  const direction = change === null ? null : Math.abs(change) < 0.0005 ? 'flat' : change > 0 ? 'up' : 'down';
  return {
    grade,
    price: latest.price,
    period: latest.observedOn,
    change,
    direction,
    stale: isStaleObservation(latest.observedOn, now),
    ageDays: observationAgeDays(latest.observedOn, now),
  };
}

/** Read-only: newest two national observations for the grade from FuelPriceSnapshot. */
export async function loadFuelPulse(grade: FuelGrade, now: Date = new Date()): Promise<FuelPulse> {
  const rows = await prisma.fuelPriceSnapshot.findMany({
    where: { source: EIA_SOURCE, duoarea: NATIONAL_AREA, grade },
    select: { observedOn: true, price: true },
    orderBy: { observedOn: 'desc' },
    take: 2,
  });
  return buildFuelPulse(grade, rows, now);
}

/** Default display grade: the user's most recent fill-up with a priceable grade, else regular. */
export async function defaultPulseGrade(userId: string): Promise<FuelGrade> {
  const recent = await prisma.fillup.findMany({
    where: { userId, fuelGrade: { not: null } },
    select: { fuelGrade: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const r of recent) {
    const g = normalizeGrade(r.fuelGrade);
    if (g) return g;
  }
  return 'regular';
}
