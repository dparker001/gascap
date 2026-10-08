/**
 * Gamification G1 — the ONE canonical GasCap day/week calendar.
 *
 * Every GasPoints daily/weekly rule keys off this module and nothing else.
 * The calendar is deliberately server-side and fixed to America/New_York (the
 * same zone the engagement baseline already uses): award identity must never
 * depend on a client-controlled timezone. A future release can add a per-user
 * timezone if that is ever justified; until then a "GasCap day" ends at
 * midnight Eastern for everyone.
 *
 * A GasCap week runs Monday through Sunday (Eastern).
 */
export const GASCAP_TIMEZONE = 'America/New_York';

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** GasCap calendar date (YYYY-MM-DD, Eastern) of an instant. */
export function gasCapDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: GASCAP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function ymdToUtcMs(ymd: string): number | null {
  if (!YMD.test(ymd)) return null;
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function msToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Monday (YYYY-MM-DD) of the GasCap week containing a GasCap date key, or null if malformed. */
export function weekKeyForDateKey(dateKey: string): string | null {
  const ms = ymdToUtcMs(dateKey);
  if (ms === null) return null;
  const dow = new Date(ms).getUTCDay();          // 0 = Sunday … 6 = Saturday
  const sinceMonday = (dow + 6) % 7;             // Monday -> 0 … Sunday -> 6
  return msToYmd(ms - sinceMonday * DAY_MS);
}

/** GasCap week key (the Monday's date key) of an instant. */
export function gasCapWeekKey(now: Date = new Date()): string {
  return weekKeyForDateKey(gasCapDateKey(now)) as string;
}

/** The seven GasCap date keys (Mon..Sun) of the week identified by its Monday key. */
export function weekDateKeys(weekKey: string): string[] {
  const ms = ymdToUtcMs(weekKey);
  if (ms === null) return [];
  return Array.from({ length: 7 }, (_, i) => msToYmd(ms + i * DAY_MS));
}
