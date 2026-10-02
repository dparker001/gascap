/**
 * Rental return/pickup reminders (2026-08-25 P0 fix) — timezone-correct
 * local-wall-clock → UTC conversion, dependency-free (no date-fns-tz/luxon
 * in this project).
 *
 * pickupDateTime/returnDateTime remain naive local-time strings (unchanged,
 * for backward compatibility with existing rows and UI) — this module adds
 * the SMALLEST additional representation needed for the server cron to
 * compare unambiguously: an actual UTC instant, derived from the naive
 * local string plus the IANA timezone captured from the browser at
 * write time (Intl.DateTimeFormat().resolvedOptions().timeZone).
 *
 * Algorithm: iteratively correct a UTC guess against how that guess renders
 * back in the target timezone — the standard technique for converting a
 * local wall-clock time in an arbitrary IANA zone to UTC without a date
 * library. Converges in at most 2 passes and is DST-correct because the
 * offset used is whatever Intl reports for that actual calendar date, not a
 * fixed/assumed offset.
 */

interface WallClock { year: number; month: number; day: number; hour: number; minute: number }

function parseLocalDateTime(dateTimeLocal: string): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal);
  if (!m) return null;
  return {
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour: Number(m[4]), minute: Number(m[5]),
  };
}

/** Reads the wall-clock time a given UTC instant displays as in `timeZone`. */
function wallClockInZone(utcMs: number, timeZone: string): WallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function wallClockToUtcMs(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
}

/**
 * Converts a naive local wall-clock string ("YYYY-MM-DDTHH:mm", exactly what
 * `<input type="datetime-local">` produces) plus an IANA timezone into the
 * correct UTC ISO instant. Returns null if either input is unusable — never
 * guesses or falls back to treating the string as if it were already UTC.
 */
export function localDateTimeToUtcIso(dateTimeLocal: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!dateTimeLocal || !timeZone) return null;
  const wall = parseLocalDateTime(dateTimeLocal);
  if (!wall) return null;

  let guessMs = wallClockToUtcMs(wall);
  // Up to 2 correction passes — sufficient because the offset itself only
  // ever shifts by the DST delta between the initial UTC-as-if-wall guess
  // and the actual zone, which converges in one correction in practice.
  for (let i = 0; i < 2; i++) {
    const observed = wallClockInZone(guessMs, timeZone);
    const observedMs = wallClockToUtcMs(observed);
    const diff = wallClockToUtcMs(wall) - observedMs;
    if (diff === 0) break;
    guessMs += diff;
  }

  try {
    return new Date(guessMs).toISOString();
  } catch {
    return null;
  }
}

/** Best-effort browser IANA timezone name; undefined server-side/unsupported. */
/**
 * Split a combined "YYYY-MM-DDTHH:mm" local-datetime string (the format a
 * native `<input type="datetime-local">` produces, and what
 * pickupDateTime/returnDateTime are stored as) into its date and time
 * halves — the formats native `<input type="date">` (YYYY-MM-DD) and
 * `<input type="time">` (HH:mm) each expect. Introduced 2026-08-25 when the
 * combined datetime-local control was replaced with two separate inputs
 * (a WebKit rendering-width limitation on iOS) — the underlying stored
 * string format is unchanged, only the input UI split.
 */
export function splitLocalDateTime(value: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}

/** Inverse of splitLocalDateTime — recombines a date-input value and a
 *  time-input value back into the single "YYYY-MM-DDTHH:mm" string every
 *  downstream consumer (validation, submit payloads, localDateTimeToUtcIso)
 *  already expects. Returns '' if either half is missing — a rental can't
 *  have a return date with no time or vice versa. */
export function combineLocalDateTime(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time}`;
}

export function detectBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event-timezone model (2026-10-02, approved). Each rental EVENT (pickup,
// return) is a naive local wall clock + its OWN IANA zone; the server derives
// the authoritative UTC instant from that pair and never trusts a
// client-supplied UTC value. Everything below is pure and DST-aware.
// ─────────────────────────────────────────────────────────────────────────────

export const TIME_ZONE_SOURCES = ['place', 'user', 'device'] as const;
export type TimeZoneSource = typeof TIME_ZONE_SOURCES[number];
export function isTimeZoneSource(v: unknown): v is TimeZoneSource {
  return typeof v === 'string' && (TIME_ZONE_SOURCES as readonly string[]).includes(v);
}

export type TimeDisambiguation = 'earlier' | 'later';
export function isTimeDisambiguation(v: unknown): v is TimeDisambiguation {
  return v === 'earlier' || v === 'later';
}

// Backward-compatibility link prefixes (IANA "backward" file) and fixed-offset
// Etc/* zones are rejected: they aren't the canonical location-based names a
// rental event should carry, and Etc/* has no DST.
const REJECTED_PREFIXES = ['Etc/', 'US/', 'Canada/', 'Mexico/', 'Brazil/', 'Chile/', 'SystemV/'];
let supportedZones: Set<string> | null = null;

/**
 * Strict IANA zone check. Accepts "UTC" or an Area/Location name that Intl
 * accepts and that resolves to a supported zone. Rejects abbreviations
 * ("EST", "EST5EDT" — Intl silently maps EST to fixed-offset America/Panama),
 * untrimmed/empty strings, fixed-offset Etc/* and backward-link aliases.
 * Membership is checked on the RESOLVED name because ICU's list still uses
 * older canonical spellings (Asia/Calcutta) while Google Places returns the
 * current IANA ones (Asia/Kolkata) — both must be accepted. Never throws.
 */
export function isValidIanaZone(z: unknown): z is string {
  if (typeof z !== 'string' || z.length === 0 || z !== z.trim()) return false;
  if (z === 'UTC') return true;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(z)) return false;
  if (REJECTED_PREFIXES.some((p) => z.startsWith(p))) return false;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone;
    if (!supportedZones) {
      const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
      supportedZones = new Set(intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : []);
    }
    return supportedZones.size === 0 ? true : supportedZones.has(resolved);
  } catch {
    return false;
  }
}

/** Strict "YYYY-MM-DDTHH:mm" (optional ":00" seconds) with a real calendar date. */
export function parseStrictLocalDateTime(s: unknown): WallClock | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00)?$/.exec(s);
  if (!m) return null;
  const w = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
  if (w.month < 1 || w.month > 12 || w.hour > 23 || w.minute > 59 || w.day < 1) return null;
  const probe = new Date(Date.UTC(w.year, w.month - 1, w.day));
  if (probe.getUTCMonth() !== w.month - 1 || probe.getUTCDate() !== w.day) return null; // e.g. Feb 30
  return w;
}

export type LocalTimeClass =
  | { kind: 'valid';       utcMs: number }
  | { kind: 'ambiguous';   earlierMs: number; laterMs: number }   // fall-back: occurs twice
  | { kind: 'nonexistent' };                                     // spring-forward gap

const sameWall = (a: WallClock, b: WallClock) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;

/**
 * Classifies a wall clock in a zone. Candidate instants are derived from the
 * zone's offsets a day either side of the wall time (covers any DST change),
 * and each is kept only if it really displays as that wall clock. Zero
 * survivors = nonexistent, one = valid, two = ambiguous. Assumes a valid zone.
 */
export function classifyLocalTime(wall: WallClock, zone: string): LocalTimeClass {
  const target = wallClockToUtcMs(wall);
  const offsets = new Set<number>();
  for (const probe of [target - 86_400_000, target, target + 86_400_000]) {
    offsets.add(wallClockToUtcMs(wallClockInZone(probe, zone)) - probe);
  }
  const hits = Array.from(offsets)
    .map((o) => target - o)
    .filter((t) => sameWall(wallClockInZone(t, zone), wall));
  const uniq = Array.from(new Set(hits)).sort((a, b) => a - b);
  if (uniq.length === 0) return { kind: 'nonexistent' };
  if (uniq.length === 1) return { kind: 'valid', utcMs: uniq[0] };
  return { kind: 'ambiguous', earlierMs: uniq[0], laterMs: uniq[uniq.length - 1] };
}

export type ScheduleErrorCode =
  | 'invalid_time_zone' | 'invalid_local_datetime' | 'nonexistent_local_time' | 'ambiguous_local_time';

export type ResolveResult =
  | { ok: true; utcIso: string; occurrence: TimeDisambiguation | null }
  | { ok: false; code: ScheduleErrorCode };

/**
 * Authoritative local → UTC for ONE event. Nonexistent times are rejected,
 * never normalized. Ambiguous times REQUIRE an explicit 'earlier'/'later'.
 */
export function resolveEventUtc(local: string, zone: string, choice?: TimeDisambiguation | null): ResolveResult {
  if (!isValidIanaZone(zone)) return { ok: false, code: 'invalid_time_zone' };
  const wall = parseStrictLocalDateTime(local);
  if (!wall) return { ok: false, code: 'invalid_local_datetime' };
  const c = classifyLocalTime(wall, zone);
  if (c.kind === 'nonexistent') return { ok: false, code: 'nonexistent_local_time' };
  if (c.kind === 'valid') return { ok: true, utcIso: new Date(c.utcMs).toISOString(), occurrence: null };
  if (!choice) return { ok: false, code: 'ambiguous_local_time' };
  return { ok: true, utcIso: new Date(choice === 'earlier' ? c.earlierMs : c.laterMs).toISOString(), occurrence: choice };
}

/**
 * Which occurrence a stored (local, zone, utc) triple represents, for an
 * ambiguous wall time. Null when the time isn't ambiguous or can't be told.
 * No extra column is needed: the stored UTC instant identifies the choice.
 */
export function storedOccurrence(local: string | null | undefined, zone: string | null | undefined, utcIso: string | null | undefined): TimeDisambiguation | null {
  if (!local || !zone || !utcIso || !isValidIanaZone(zone)) return null;
  const wall = parseStrictLocalDateTime(local);
  if (!wall) return null;
  const c = classifyLocalTime(wall, zone);
  if (c.kind !== 'ambiguous') return null;
  const ms = Date.parse(utcIso);
  if (ms === c.earlierMs) return 'earlier';
  if (ms === c.laterMs) return 'later';
  return null;
}

// ── Display helpers (client-safe, pure) ─────────────────────────────────────

/** "Pacific Time" (generic name) — falls back to the long/short name. */
export function zoneLongName(zone: string, atMs: number = Date.now(), locale = 'en-US'): string {
  for (const timeZoneName of ['longGeneric', 'long'] as const) {
    try {
      const p = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName }).formatToParts(new Date(atMs));
      const v = p.find((x) => x.type === 'timeZoneName')?.value;
      if (v) return v;
    } catch { /* try next */ }
  }
  return zone;
}

/** "Los Angeles" from "America/Los_Angeles". */
export function zoneCity(zone: string): string {
  return zone === 'UTC' ? 'UTC' : (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** "PDT" / "EST" at a given instant. */
export function zoneShortName(zone: string, atMs: number, locale = 'en-US'): string {
  try {
    const p = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(atMs));
    return p.find((x) => x.type === 'timeZoneName')?.value ?? zone;
  } catch { return zone; }
}

/** Minutes the zone is ahead of UTC at an instant. */
export function zoneOffsetMinutes(zone: string, atMs: number): number {
  return (wallClockToUtcMs(wallClockInZone(atMs, zone)) - atMs) / 60_000;
}

export type EventTimeStatus =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'no_zone' }
  | { kind: 'valid';       utcMs: number }
  | { kind: 'nonexistent' }
  | { kind: 'ambiguous';   earlierMs: number; laterMs: number; earlierLabel: string; laterLabel: string };

/** UI classification of one event's wall clock in its zone. */
export function describeEventTime(local: string | null | undefined, zone: string | null | undefined): EventTimeStatus {
  if (!local) return { kind: 'empty' };
  const wall = parseStrictLocalDateTime(local);
  if (!wall) return { kind: 'invalid' };
  if (!zone || !isValidIanaZone(zone)) return { kind: 'no_zone' };
  const c = classifyLocalTime(wall, zone);
  if (c.kind === 'ambiguous') {
    return { ...c, earlierLabel: zoneShortName(zone, c.earlierMs), laterLabel: zoneShortName(zone, c.laterMs) };
  }
  return c;
}

/**
 * "Oct 5, 2:00 PM PDT" — the event's wall clock in ITS zone. Uses the stored
 * UTC instant when available (so an ambiguous time shows the occurrence that
 * was actually saved); otherwise the plain wall clock without a zone label.
 */
export function formatEventWallClock(
  local: string | null | undefined, zone: string | null | undefined, utcIso: string | null | undefined, locale?: string,
): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (utcIso && zone && isValidIanaZone(zone)) {
    try { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone, timeZoneName: 'short' }).format(new Date(utcIso)); } catch { /* fall through */ }
  }
  if (!local) return '';
  const w = parseStrictLocalDateTime(local);
  if (!w) return local;
  // Wall clock only (legacy / no zone): format the components in UTC so the
  // viewing device's zone can't shift them.
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(wallClockToUtcMs(w)));
}

/** Common zones first in pickers; the full list follows. */
export const COMMON_TIME_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico', 'America/Toronto', 'America/Vancouver',
  'America/Mexico_City', 'America/Cancun', 'Europe/London', 'UTC',
] as const;

export function allPickerTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const all = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return all.filter((z) => isValidIanaZone(z));
}
