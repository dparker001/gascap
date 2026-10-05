/**
 * Default return CLOCK TIME for the quick-save form: once a pickup time is
 * known, the return time starts at that same local time (never the date,
 * never a 24-hour assumption), and the renter can change it freely.
 *
 * Pure reducers over the split input's local draft. The split date/time input
 * keeps a PARTIAL entry (a date with no time, a time with no date) locally —
 * the combined "YYYY-MM-DDTHH:mm" value is empty until both halves exist — so
 * the default must live in that same draft: it can fill the time half while the
 * date is still empty, and picking a date can never lose or reset a time.
 *
 * `timeTouched` = the renter chose a time of their own. A touched time is never
 * overwritten by a default; clearing the time un-touches it.
 */
import { combineLocalDateTime, splitLocalDateTime } from './rentalTimezone';

export interface SplitDraft { date: string; time: string; timeTouched: boolean }

/** Draft for an externally supplied combined value (a time that differs from the default counts as the renter's own). */
export function draftFromValue(value: string, defaultTime?: string): SplitDraft {
  const { date, time } = splitLocalDateTime(value);
  return { date, time, timeTouched: !!time && (!defaultTime || time !== defaultTime) };
}

export const draftValue = (d: SplitDraft): string => combineLocalDateTime(d.date, d.time);

/** The pickup time changed (or became known). Never overwrites a touched time; never touches the date. */
export function applyDefaultTime(d: SplitDraft, defaultTime: string | undefined): SplitDraft {
  if (!defaultTime || d.timeTouched || d.time === defaultTime) return d;
  return { ...d, time: defaultTime };
}

/** The renter picked (or cleared) the date. An empty time is filled from the default; an existing time is kept. */
export function pickDate(d: SplitDraft, date: string, defaultTime: string | undefined): SplitDraft {
  const next = { ...d, date };
  if (date && !next.time && !next.timeTouched && defaultTime) next.time = defaultTime;
  return next;
}

/** The renter picked (or cleared) the time. Any time other than the current default is theirs. */
export function pickTime(d: SplitDraft, time: string, defaultTime: string | undefined): SplitDraft {
  if (!time) return { ...d, time: '', timeTouched: false };
  return { ...d, time, timeTouched: !defaultTime || time !== defaultTime };
}
