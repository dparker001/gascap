'use client';

/**
 * Pickup/return date-time entry — Rental Return Mode (2026-08-25 post-
 * release fix).
 *
 * A single fused `<input type="datetime-local">` was overflowing its card on
 * iOS: WebKit's combined date+time control can render an internal minimum
 * width that ignores the CSS width/max-width applied to the host element on
 * some iOS versions — a native rendering limitation, not a CSS box-model
 * bug (the container math checked out; the earlier max-width/min-width/
 * box-sizing fix on `input[type="datetime-local"]` in app/globals.css
 * couldn't fix a control that ignores width outright).
 *
 * The fix is the standard WebKit workaround: split into a native
 * `<input type="date">` and `<input type="time">`, each of which has a
 * narrower, more predictable native footprint on iOS than the fused
 * control. The value this component emits is unchanged — still the single
 * "YYYY-MM-DDTHH:mm" string every caller (RentalSetupFlow, EditRentalModal,
 * validation, submit payloads, lib/rentalTimezone.ts's
 * localDateTimeToUtcIso) already expects — see
 * lib/rentalTimezone.ts's splitLocalDateTime/combineLocalDateTime.
 *
 * Local date/time state is kept independently of the combined `value` prop:
 * combineLocalDateTime() only returns a non-empty string once BOTH halves
 * are set, so a naive "derive sub-field values from the combined value"
 * approach would erase whichever half the user typed first every render
 * (the combined value is '' until the second half lands). `lastEmitted`
 * guards the resync-from-props effect so it only fires for a genuine
 * external change (e.g. a different rental loaded into the edit modal),
 * never for the round-trip of our own onChange.
 *
 * Stacked (full width each) below the `sm` breakpoint so neither input is
 * ever squeezed into half a narrow card; side-by-side once there's
 * guaranteed room. Clearing either half clears the combined value —
 * a rental can't have a return date with no time or vice versa.
 */

import { useState, useEffect, useRef } from 'react';
import { splitLocalDateTime, combineLocalDateTime } from '@/lib/rentalTimezone';

export default function DateTimeSplitInput({
  value,
  onChange,
  disabled,
}: {
  /** Combined "YYYY-MM-DDTHH:mm", or '' when unset. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const initial = splitLocalDateTime(value);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return; // our own round-trip — don't clobber a partial edit
    const split = splitLocalDateTime(value);
    setDate(split.date);
    setTime(split.time);
    lastEmitted.current = value;
  }, [value]);

  function emit(newDate: string, newTime: string) {
    const combined = combineLocalDateTime(newDate, newTime);
    lastEmitted.current = combined;
    onChange(combined);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input
        type="date"
        value={date}
        disabled={disabled}
        onChange={(e) => { setDate(e.target.value); emit(e.target.value, time); }}
        className="input-field min-w-0"
      />
      <input
        type="time"
        value={time}
        disabled={disabled}
        onChange={(e) => { setTime(e.target.value); emit(date, e.target.value); }}
        className="input-field min-w-0"
      />
    </div>
  );
}
