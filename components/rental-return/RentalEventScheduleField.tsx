'use client';

/**
 * RentalEventScheduleField — one rental EVENT (pickup or return): location,
 * local date/time, and the IANA zone that wall clock is in (2026-10-02
 * event-timezone model).
 *
 * Zone precedence (per event, never shared): the selected place's zone
 * ('place') > a zone the user picked ('user') > the device zone, shown as
 * "assumed from your device" ('device'). Normal users see "Pacific Time —
 * Los Angeles", never a raw IANA id unless they open the picker.
 *
 * DST: a spring-forward gap time is flagged and must be changed (the parent
 * blocks submit); a fall-back repeated time shows both occurrences — the
 * first is preselected, but the choice is visible and explicit.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import DateTimeSplitInput from './DateTimeSplitInput';
import RentalLocationInput, { type RentalLocationValue } from './RentalLocationInput';
import {
  COMMON_TIME_ZONES, allPickerTimeZones, describeEventTime, zoneCity, zoneLongName, zoneOffsetMinutes,
  type TimeZoneSource, type TimeDisambiguation, type EventTimeStatus,
} from '@/lib/rentalTimezone';

export interface EventZone { zone: string | null; source: TimeZoneSource | null }

/** Effective zone for an event: place > user-picked > device assumption. */
export function effectiveEventZone(location: RentalLocationValue | null, picked: EventZone | null, deviceZone: string | null): EventZone {
  if (location?.timeZone) return { zone: location.timeZone, source: 'place' };
  if (picked?.zone) return picked;
  return deviceZone ? { zone: deviceZone, source: 'device' } : { zone: null, source: null };
}

/** True when this event's time can be saved as-is. */
export function eventTimeSubmittable(status: EventTimeStatus): boolean {
  return status.kind !== 'nonexistent' && status.kind !== 'invalid';
}

interface Props {
  kind:            'pickup' | 'return';
  label:           string;
  dateTime:        string;
  onDateTime:      (v: string) => void;
  location?:       RentalLocationValue;          // omitted = no location input for this event
  onLocation?:     (v: RentalLocationValue) => void;
  locationLabel?:  string;
  locationPlaceholder?: string;
  zone:            EventZone;                    // the EFFECTIVE zone (see effectiveEventZone)
  onPickZone:      (zone: string) => void;       // user picked → source 'user'
  choice:          TimeDisambiguation | null;
  onChoice:        (c: TimeDisambiguation) => void;
  deviceZone:      string | null;
  hint?:           string;
}

export default function RentalEventScheduleField(p: Props) {
  const { t, locale } = useTranslation();
  const r = t.rentalReturn;
  const [picking, setPicking] = useState(false);
  const status = useMemo(() => describeEventTime(p.dateTime, p.zone.zone), [p.dateTime, p.zone.zone]);
  const atMs = status.kind === 'valid' ? status.utcMs : Date.now();

  const zoneLine = p.zone.zone
    ? `${zoneLongName(p.zone.zone, atMs, locale === 'es' ? 'es-US' : 'en-US')} — ${zoneCity(p.zone.zone)}`
    : null;
  const sourceLabel = p.zone.source === 'place' ? r.tzFromPlace : p.zone.source === 'user' ? r.tzFromUser : p.zone.source === 'device' ? r.tzAssumedDevice : null;

  // "Your pickup is in Pacific Time — 3 hours behind your current time zone."
  let differs: string | null = null;
  if (p.zone.zone && p.deviceZone && p.zone.zone !== p.deviceZone && p.dateTime) {
    const diffMin = zoneOffsetMinutes(p.zone.zone, atMs) - zoneOffsetMinutes(p.deviceZone, atMs);
    if (diffMin !== 0) {
      const hours = String(Math.abs(diffMin) / 60);
      differs = r.tzDiffers(p.kind === 'pickup' ? r.tzEventPickup : r.tzEventReturn,
        zoneLongName(p.zone.zone, atMs, locale === 'es' ? 'es-US' : 'en-US'), hours, diffMin > 0 ? 'ahead' : 'behind');
    }
  }

  const [datePart, timePart] = p.dateTime.split('T');
  const prettyTime = timePart ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(`1970-01-01T${timePart}:00Z`)) : '';
  const prettyDate = datePart ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${datePart}T12:00:00Z`)) : '';

  return (
    <div data-rental-event={p.kind} className="space-y-1.5">
      {p.location && p.onLocation && (
        <>
          <label className="field-label">{p.locationLabel}</label>
          <RentalLocationInput kind={p.kind} value={p.location} onChange={p.onLocation} placeholder={p.locationPlaceholder} />
        </>
      )}
      <label className="field-label">{p.label}</label>
      <DateTimeSplitInput value={p.dateTime} onChange={p.onDateTime} />

      {zoneLine ? (
        <p className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-1.5">
          <span className="font-semibold text-slate-700">{zoneLine}</span>
          {sourceLabel && <span className={p.zone.source === 'device' ? 'italic text-amber-700' : 'text-slate-400'}>({sourceLabel})</span>}
          <button type="button" onClick={() => setPicking((v) => !v)} className="font-bold text-blue-600 underline underline-offset-2">{r.tzChange}</button>
        </p>
      ) : (
        <p className="text-[11px] text-amber-700">{r.tzNeedsZone}{' '}
          <button type="button" onClick={() => setPicking(true)} className="font-bold text-blue-600 underline underline-offset-2">{r.tzChange}</button>
        </p>
      )}

      {picking && (
        <select
          aria-label={r.tzPickerLabel}
          className="input-field text-xs"
          value={p.zone.zone ?? ''}
          onChange={(e) => { if (e.target.value) { p.onPickZone(e.target.value); setPicking(false); } }}
        >
          <option value="" disabled>{r.tzPickerLabel}</option>
          <optgroup label={r.tzPickerCommon}>
            {COMMON_TIME_ZONES.map((z) => <option key={`c-${z}`} value={z}>{zoneLongName(z, atMs)} — {zoneCity(z)}</option>)}
          </optgroup>
          <optgroup label={r.tzPickerAll}>
            {allPickerTimeZones().map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </optgroup>
        </select>
      )}

      {status.kind === 'nonexistent' && (
        <p role="alert" className="text-xs font-semibold text-red-600">
          {r.tzNonexistent(prettyTime, prettyDate, zoneLine ?? '')}
        </p>
      )}

      {status.kind === 'ambiguous' && (
        <fieldset className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1">
          <legend className="text-xs font-semibold text-amber-800 px-1">{r.tzAmbiguous(prettyTime, prettyDate)}</legend>
          {(['earlier', 'later'] as const).map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-slate-700">
              <input type="radio" name={`${p.kind}-occurrence`} checked={(p.choice ?? 'earlier') === c} onChange={() => p.onChoice(c)} />
              {c === 'earlier' ? r.tzAmbiguousFirst(prettyTime, status.earlierLabel) : r.tzAmbiguousSecond(prettyTime, status.laterLabel)}
            </label>
          ))}
        </fieldset>
      )}

      {differs && status.kind !== 'nonexistent' && <p className="text-[11px] text-blue-700">{differs}</p>}
      {p.hint && <p className="text-[11px] text-slate-400">{p.hint}</p>}
    </div>
  );
}
