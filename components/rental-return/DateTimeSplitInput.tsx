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
 *
 * 2026-08-26 follow-up: the split alone narrowed but did not fully fix the
 * iOS overflow — WebKit's shadow-DOM internals for these controls
 * (::-webkit-datetime-edit) have their own intrinsic minimum width that a
 * plain outer `width`/`max-width` can't reach (see the matching comment in
 * app/globals.css). Each input now carries explicit inline sizing as a
 * belt-and-suspenders layer on top of the CSS class, and uses
 * `.rental-datetime-input` (tighter horizontal padding, same visual style
 * as `.input-field`) to leave the shadow content more room without
 * shrinking below the 16px iOS no-zoom floor.
 */

import { useState, useEffect, useId, useRef, type CSSProperties } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  applyDefaultTime, draftFromValue, draftValue, pickDate, pickTime, type SplitDraft,
} from '@/lib/rentalReturnTimeDefault';

/**
 * Optional visible labels and empty-state guidance. Native date/time inputs
 * show NO usable placeholder on iOS Safari (and inconsistently elsewhere), so
 * when this is supplied each input gets a visible <label> and a line below it
 * that says what to do while empty ("Choose a date") and echoes the chosen
 * value in words once set. Omitted → the markup is exactly what it always was.
 */
export interface DateTimeFieldText {
  dateLabel: string;
  timeLabel: string;
  dateEmptyHint: string;
  timeEmptyHint: string;
  /** Shown beside a time that is still the automatic default. */
  timeDefaultedNote?: string;
}

export default function DateTimeSplitInput({
  value,
  onChange,
  disabled,
  defaultTime,
  onParts,
  text,
}: {
  /** Combined "YYYY-MM-DDTHH:mm", or '' when unset. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Optional "HH:mm" the TIME half starts from (the return time follows the
   * pickup time). Fills an empty time — even before a date is chosen — but never
   * the date, and never a time the user chose themselves. Undefined → off.
   */
  defaultTime?: string;
  /** Optional: reports the local halves on every change, including a PARTIAL entry the combined value can't express. */
  onParts?: (parts: { date: string; time: string }) => void;
  text?: DateTimeFieldText;
}) {
  const { locale } = useTranslation();
  const ids = useId();
  const [draft, setDraft] = useState<SplitDraft>(() => applyDefaultTime(draftFromValue(value, defaultTime), defaultTime));
  const lastEmitted = useRef(value);
  const { date, time } = draft;

  useEffect(() => {
    if (value === lastEmitted.current) return; // our own round-trip — don't clobber a partial edit
    setDraft(draftFromValue(value, defaultTime));
    lastEmitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // The default moved (pickup time changed or became known): follow it unless the renter chose a time.
  useEffect(() => {
    if (defaultTime === undefined) return;
    setDraft((d) => applyDefaultTime(d, defaultTime));
  }, [defaultTime]);

  // Every draft change is reported once: the combined value (only when it differs) and the raw halves.
  useEffect(() => {
    const combined = draftValue(draft);
    if (combined !== lastEmitted.current) { lastEmitted.current = combined; onChange(combined); }
    onParts?.({ date: draft.date, time: draft.time });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Redundant with the CSS class on purpose — inline styles win over any
  // stylesheet ordering surprise, and are the last lever before resorting
  // to -webkit-appearance: none, which would suppress the native picker.
  const fieldStyle: CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    display: 'block',
  };

  const dateInput = (
    <input
      id={text ? `${ids}-date` : undefined}
      type="date"
      value={date}
      disabled={disabled}
      aria-describedby={text ? `${ids}-date-hint` : undefined}
      onChange={(e) => setDraft((d) => pickDate(d, e.target.value, defaultTime))}
      className="rental-datetime-input min-w-0"
      style={fieldStyle}
    />
  );
  const timeInput = (
    <input
      id={text ? `${ids}-time` : undefined}
      type="time"
      value={time}
      disabled={disabled}
      aria-describedby={text ? `${ids}-time-hint` : undefined}
      onChange={(e) => setDraft((d) => pickTime(d, e.target.value, defaultTime))}
      className="rental-datetime-input min-w-0"
      style={fieldStyle}
    />
  );

  // Tailwind's grid-cols-N utilities already compile to
  // `repeat(N, minmax(0, 1fr))` tracks, not plain `1fr` — no inline
  // grid-template-columns override needed (and one here would apply at
  // every breakpoint, defeating the sm:grid-cols-2 variant above).
  if (!text) {
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{dateInput}{timeInput}</div>;
  }

  const loc = locale === 'es' ? 'es-US' : 'en-US';
  const prettyDate = date
    ? new Intl.DateTimeFormat(loc, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
    : '';
  const prettyTime = time
    ? new Intl.DateTimeFormat(loc, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`1970-01-01T${time}:00Z`))
    : '';
  const timeIsDefault = defaultTime !== undefined && !!time && !draft.timeTouched && time === defaultTime;
  const labelCls = 'block text-[11px] font-semibold text-slate-600 mb-1';
  const hintCls = (filled: boolean) => `text-[11px] mt-1 ${filled ? 'text-slate-600' : 'text-slate-400'}`;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div className="min-w-0">
        <label htmlFor={`${ids}-date`} className={labelCls}>{text.dateLabel}</label>
        {dateInput}
        <p id={`${ids}-date-hint`} className={hintCls(!!date)}>{date ? prettyDate : text.dateEmptyHint}</p>
      </div>
      <div className="min-w-0">
        <label htmlFor={`${ids}-time`} className={labelCls}>{text.timeLabel}</label>
        {timeInput}
        <p id={`${ids}-time-hint`} className={hintCls(!!time)}>
          {time ? prettyTime : text.timeEmptyHint}
          {timeIsDefault && text.timeDefaultedNote ? ` \u2014 ${text.timeDefaultedNote}` : ''}
        </p>
      </div>
    </div>
  );
}
