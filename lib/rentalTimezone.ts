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
