/**
 * Freshness of an EIA weekly observation. Pure.
 *
 * EIA publishes one retail price per area per week, dated the survey Monday.
 * A price is therefore up to ~7 days old the moment it is released, and
 * ~9 days old after a Monday holiday pushes the release to Tuesday. We call a
 * price stale only past STALE_AFTER_DAYS — i.e. at least one release was
 * missed — so "stale" is a real signal, not the normal weekly cadence.
 */
export const STALE_AFTER_DAYS = 14;

const DAY_MS = 86_400_000;

/** Whole days from the EIA survey date to `now` (UTC dates), or null if unparseable. */
export function observationAgeDays(observedOn: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn)) return null;
  const t = Date.parse(`${observedOn}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - t) / DAY_MS);
}

/** True when the observation is missing/unparseable or older than STALE_AFTER_DAYS. */
export function isStaleObservation(observedOn: string | null | undefined, now: Date = new Date()): boolean {
  if (!observedOn) return true;
  const age = observationAgeDays(observedOn, now);
  return age === null || age > STALE_AFTER_DAYS;
}
