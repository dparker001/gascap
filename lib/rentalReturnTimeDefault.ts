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
 * `timeTouched` = the renter explicitly chose a time (even one equal to the
 * current default). A touched time is never overwritten by a default; clearing
 * the time un-touches it.
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

/** The renter picked (or cleared) the time. Every non-empty pick is theirs and sticks; clearing un-touches it. */
export function pickTime(d: SplitDraft, time: string, defaultTime: string | undefined): SplitDraft {
  if (!time) return { ...d, time: '', timeTouched: false };
  // ANY explicit non-empty choice is the renter's own — even one that happens to equal
  // the current default (a deliberate 10:00 must survive the pickup moving to 12:00).
  // Only clearing the time hands control back to the automatic default.
  return { ...d, time, timeTouched: true };
}

// ── controller behind DateTimeSplitInput ────────────────────────────────────

export interface SplitController {
  getDraft(): SplitDraft;
  /** The renter picked/cleared the date or the time. Emits the combined value IMMEDIATELY (as the component always did). */
  pickDate(date: string): void;
  pickTime(time: string): void;
  /** The parent's `value` prop changed (or was re-rendered): resync only for a genuine external change. */
  syncValue(value: string): void;
  /** Optional Quick-Save extension: the default clock time changed. No-op while undefined. */
  setDefaultTime(defaultTime: string | undefined): void;
}

/**
 * The framework-free core of DateTimeSplitInput.
 *
 * With NO extension (`defaultTime` never set) this is exactly the component's
 * original behaviour: each edit updates the local half and calls `onChange`
 * immediately with the recombined value (empty until BOTH halves exist), and a
 * `value` that differs from the last one it emitted is an external change that
 * replaces the draft — while the round-trip of its own emission never clobbers
 * a partial edit.
 *
 * Handlers always build on the LATEST draft (held here, not in a render
 * closure), so two edits that land before React re-renders can neither lose
 * nor revert one another.
 *
 * The default-time follow (Quick-Save only) changes the draft without a user
 * event; that is the only place a change is emitted from outside a handler.
 */
export function createSplitController(init: {
  value: string;
  defaultTime?: string;
  onChange: (combined: string) => void;
  onDraft: (draft: SplitDraft) => void;
  onParts?: (parts: { date: string; time: string }) => void;
}): SplitController {
  let defaultTime = init.defaultTime;
  let draft = applyDefaultTime(draftFromValue(init.value, defaultTime), defaultTime);
  let lastEmitted = init.value;

  function publish(next: SplitDraft) {
    draft = next;
    init.onDraft(next);
    init.onParts?.({ date: next.date, time: next.time });
  }
  function emit(next: SplitDraft) {
    publish(next);
    lastEmitted = draftValue(next);
    init.onChange(lastEmitted);
  }

  return {
    getDraft: () => draft,
    pickDate: (date) => emit(pickDate(draft, date, defaultTime)),
    pickTime: (time) => emit(pickTime(draft, time, defaultTime)),
    syncValue(value) {
      if (value === lastEmitted) return;                 // our own round-trip — don't clobber a partial edit
      lastEmitted = value;
      publish(draftFromValue(value, defaultTime));
    },
    setDefaultTime(next) {
      defaultTime = next;
      if (next === undefined) return;
      const applied = applyDefaultTime(draft, next);
      if (applied === draft) return;
      if (draftValue(applied) !== lastEmitted) emit(applied); else publish(applied);   // partial entry: no value change to report
    },
  };
}
