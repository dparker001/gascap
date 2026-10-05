/**
 * Quick-save UX refinements — the pure logic: default return time, partial
 * inputs, "Same as pickup location", DST and one-way rentals.
 */
import { describe, it, expect } from 'vitest';
import {
  applyDefaultTime, draftFromValue, draftValue, pickDate, pickTime, type SplitDraft,
} from '@/lib/rentalReturnTimeDefault';
import { resolveReturnEvent, afterSameAsToggle } from '@/lib/rentalReturnLocation';
import { emptyRentalLocation, type RentalLocationValue } from '@/components/rental-return/RentalLocationInput';
import { buildQuickSavePayload, quickSaveCanSubmit, type QuickSaveEvent } from '@/lib/rentalQuickSave';
import { describeEventTime } from '@/lib/rentalTimezone';

const empty: SplitDraft = { date: '', time: '', timeTouched: false };

describe('default return time (pure draft reducers)', () => {
  it('the example: pickup Oct 20 10:00 → pick Oct 24 → return 10:00 AM on Oct 24, changeable', () => {
    let d = applyDefaultTime(empty, '10:00');
    expect(d).toMatchObject({ date: '', time: '10:00' });         // the clock time is initialised…
    expect(draftValue(d)).toBe('');                                // …the date is NOT, so the value is still incomplete
    d = pickDate(d, '2026-10-24', '10:00');
    expect(draftValue(d)).toBe('2026-10-24T10:00');
    d = pickTime(d, '14:30', '10:00');                             // independently modifiable
    expect(draftValue(d)).toBe('2026-10-24T14:30');
  });
  it('NEVER populates the return date (and does not assume 24 hours)', () => {
    const d = applyDefaultTime(empty, '10:00');
    expect(d.date).toBe('');
    expect(draftValue(d)).toBe('');                                 // return date stays required
    expect(draftValue(pickDate(empty, '', '10:00'))).toBe('');
  });
  it('picking a date with no time fills the default; a date alone never fabricates a value when there is no default', () => {
    expect(draftValue(pickDate(empty, '2026-10-24', '09:15'))).toBe('2026-10-24T09:15');
    expect(draftValue(pickDate(empty, '2026-10-24', undefined))).toBe('');
    expect(pickDate(empty, '2026-10-24', undefined)).toMatchObject({ date: '2026-10-24', time: '' });   // partial date kept
  });
  it('the default FOLLOWS the pickup time until the renter chooses their own', () => {
    let d = pickDate(applyDefaultTime(empty, '10:00'), '2026-10-24', '10:00');
    d = applyDefaultTime(d, '11:30');                                // pickup moved to 11:30
    expect(draftValue(d)).toBe('2026-10-24T11:30');
    d = applyDefaultTime(d, '08:00');
    expect(draftValue(d)).toBe('2026-10-24T08:00');
  });
  it('NEVER overwrites a time the renter chose — later pickup changes are ignored', () => {
    let d = pickDate(applyDefaultTime(empty, '10:00'), '2026-10-24', '10:00');
    d = pickTime(d, '16:45', '10:00');
    expect(d.timeTouched).toBe(true);
    d = applyDefaultTime(d, '07:00');
    expect(draftValue(d)).toBe('2026-10-24T16:45');
    expect(draftValue(pickDate(d, '2026-10-26', '07:00'))).toBe('2026-10-26T16:45');   // new date keeps their time
  });
  it('a chosen time is protected even when the renter picked it BEFORE any pickup time existed', () => {
    let d = pickTime(empty, '18:00', undefined);
    expect(d.timeTouched).toBe(true);
    d = applyDefaultTime(d, '10:00');
    expect(d.time).toBe('18:00');
  });
  it('an explicit selection that EQUALS the default still counts as the renter’s own (it must survive the pickup moving)', () => {
    // default 10:00 → user selects 11:00 → user selects 10:00 → pickup changes to 12:00 → return stays 10:00
    let d = pickDate(applyDefaultTime(empty, '10:00'), '2026-10-24', '10:00');
    expect(d.time).toBe('10:00');
    d = pickTime(d, '11:00', '10:00');
    expect(d.timeTouched).toBe(true);
    d = pickTime(d, '10:00', '10:00');                              // back to the default value, deliberately
    expect(d.timeTouched).toBe(true);
    d = applyDefaultTime(d, '12:00');                               // the pickup time changes
    expect(d.time).toBe('10:00');
    expect(draftValue(d)).toBe('2026-10-24T10:00');
  });
  it('even picking the default value FIRST (no other edit) is an explicit choice', () => {
    let d = applyDefaultTime(empty, '10:00');
    expect(d.timeTouched).toBe(false);                              // an automatic default is not a choice
    d = pickTime(d, '10:00', '10:00');
    expect(d.timeTouched).toBe(true);
    expect(applyDefaultTime(d, '12:00').time).toBe('10:00');
  });
  it('clearing a manually selected time resumes automatic following — and never populates the return date', () => {
    let d = pickDate(applyDefaultTime(empty, '10:00'), '', '10:00');   // no return date yet
    d = pickTime(d, '15:00', '10:00');                              // manual
    d = applyDefaultTime(d, '11:00');
    expect(d.time).toBe('15:00');                                   // protected while manual
    d = pickTime(d, '', '11:00');                                   // cleared → automatic again
    expect(d).toEqual({ date: '', time: '', timeTouched: false });
    d = applyDefaultTime(d, '12:00');                               // the pickup changes later
    expect(d.time).toBe('12:00');                                   // following has resumed
    expect(d.date).toBe('');                                        // the return date was NOT populated
    expect(draftValue(d)).toBe('');                                 // so the value is still incomplete
    d = applyDefaultTime(d, '13:30');
    expect(d.time).toBe('13:30');                                   // and keeps following
  });
  it('clearing the time un-touches it and never fabricates one; the date survives', () => {
    let d = pickDate(applyDefaultTime(empty, '10:00'), '2026-10-24', '10:00');
    d = pickTime(d, '15:00', '10:00');
    d = pickTime(d, '', '10:00');
    expect(d).toEqual({ date: '2026-10-24', time: '', timeTouched: false });
    expect(draftValue(d)).toBe('');
  });
  it('PARTIAL inputs: a date picked first is never lost when the default arrives later', () => {
    let d = pickDate(empty, '2026-10-24', undefined);                // return date first, no pickup time yet
    expect(draftValue(d)).toBe('');
    d = applyDefaultTime(d, '10:00');                                // pickup time becomes known
    expect(d).toMatchObject({ date: '2026-10-24', time: '10:00' });
    expect(draftValue(d)).toBe('2026-10-24T10:00');
  });
  it('PARTIAL inputs: clearing the date keeps the time half locally; the value is empty', () => {
    let d = pickDate(applyDefaultTime(empty, '10:00'), '2026-10-24', '10:00');
    d = pickDate(d, '', '10:00');
    expect(d).toMatchObject({ date: '', time: '10:00' });
    expect(draftValue(d)).toBe('');
  });
  it('no default (pickup time unknown/cleared) changes nothing', () => {
    const d = pickDate(empty, '2026-10-24', undefined);
    expect(applyDefaultTime(d, undefined)).toBe(d);
    expect(applyDefaultTime(d, '')).toBe(d);
  });
  it('an external value is read as the renter’s own time unless it equals the default', () => {
    expect(draftFromValue('2026-10-24T10:00', '10:00').timeTouched).toBe(false);
    expect(draftFromValue('2026-10-24T13:00', '10:00').timeTouched).toBe(true);
    expect(draftFromValue('', '10:00')).toEqual({ date: '', time: '', timeTouched: false });
  });
});

describe('default return time never bypasses schedule validation (DST, zones)', () => {
  const ev = (dateTime: string, zone: string): QuickSaveEvent => ({
    dateTime, location: emptyRentalLocation(), zone: { zone, source: 'user' }, status: describeEventTime(dateTime, zone), choice: null,
  });
  it('a default time that does NOT exist on the chosen return date (spring-forward gap) is flagged and blocks submit', () => {
    const gap = draftValue(pickDate(applyDefaultTime(empty, '02:30'), '2027-03-14', '02:30'));   // 2:30 AM does not exist in New York that day
    expect(gap).toBe('2027-03-14T02:30');
    const ret = ev(gap, 'America/New_York');
    expect(ret.status.kind).toBe('nonexistent');
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev('2027-03-10T02:30', 'America/New_York'), ret })).toBe(false);
  });
  it('a default time inside the fall-back repeated hour is AMBIGUOUS — the explicit occurrence choice is still required', () => {
    const v = draftValue(pickDate(applyDefaultTime(empty, '01:30'), '2026-11-01', '01:30'));
    expect(describeEventTime(v, 'America/New_York').kind).toBe('ambiguous');
  });
  it('the same default clock time resolves in EACH event’s own zone (separate zones, separate UTC instants)', () => {
    const p = describeEventTime('2026-10-20T10:00', 'America/New_York');
    const r = describeEventTime('2026-10-24T10:00', 'America/Los_Angeles');
    expect(p.kind).toBe('valid'); expect(r.kind).toBe('valid');
    if (p.kind === 'valid' && r.kind === 'valid') {
      expect(new Date(p.utcMs).toISOString()).toBe('2026-10-20T14:00:00.000Z');   // EDT
      expect(new Date(r.utcMs).toISOString()).toBe('2026-10-24T17:00:00.000Z');   // PDT — three hours later
    }
  });
  it('a return date is still required: a default time alone cannot be submitted', () => {
    const ret = ev('', 'America/New_York');
    expect(quickSaveCanSubmit({ company: 'Hertz', pickup: ev('2026-10-20T10:00', 'America/New_York'), ret })).toBe(false);
  });
  it('the payload still carries the wall-clock strings and zones — never a client-computed UTC instant', () => {
    const body = buildQuickSavePayload({
      company: 'Hertz', confirmationNumber: '', deviceZone: 'America/New_York',
      pickup: ev('2026-10-20T10:00', 'America/New_York'), ret: ev('2026-10-24T10:00', 'America/New_York'),
    });
    expect(body.pickupDateTime).toBe('2026-10-20T10:00');
    expect(body.returnDateTime).toBe('2026-10-24T10:00');
    expect(Object.keys(body).filter((k) => /utc/i.test(k))).toEqual([]);
  });
});

describe('Same as pickup location', () => {
  const place = (text: string, lat: number, lng: number, tz: string): RentalLocationValue =>
    ({ text, lat, lng, timeZone: tz, timeZoneSource: 'place' });
  const MCO = place('Orlando International Airport', 28.4312, -81.3081, 'America/New_York');
  const LAX = place('Los Angeles International Airport', 33.9416, -118.4085, 'America/Los_Angeles');
  const base = { pickupLoc: MCO, pickupZone: { zone: 'America/New_York', source: 'place' as const }, returnLoc: emptyRentalLocation(), pickedReturnZone: null, deviceZone: 'America/Chicago' };

  it('checked: the return event is the pickup’s FULL location object — text, coordinates and place zone — with place provenance', () => {
    const e = resolveReturnEvent({ ...base, sameAsPickup: true });
    expect(e.location).toEqual(MCO);
    expect(e.zone).toEqual({ zone: 'America/New_York', source: 'place' });
  });
  it('checked: the return zone inherits the pickup zone with the SAME provenance (place / user / device)', () => {
    for (const z of [{ zone: 'America/New_York', source: 'place' }, { zone: 'America/Denver', source: 'user' }, { zone: 'America/Chicago', source: 'device' }] as const) {
      const e = resolveReturnEvent({ ...base, sameAsPickup: true, pickupLoc: z.source === 'place' ? MCO : emptyRentalLocation('Some garage'), pickupZone: z });
      expect(e.zone).toEqual(z);
    }
  });
  it('checked: the result is a copy — mutating it cannot change the pickup', () => {
    const e = resolveReturnEvent({ ...base, sameAsPickup: true });
    e.location.text = 'changed';
    expect(MCO.text).toBe('Orlando International Airport');
  });
  it('checked: a pickup change is reflected immediately (derived, never a stale copy)', () => {
    const a = resolveReturnEvent({ ...base, sameAsPickup: true });
    const b = resolveReturnEvent({ ...base, sameAsPickup: true, pickupLoc: LAX, pickupZone: { zone: 'America/Los_Angeles', source: 'place' } });
    expect(a.location.text).toBe('Orlando International Airport');
    expect(b.location).toEqual(LAX);
    expect(b.zone.zone).toBe('America/Los_Angeles');
  });
  it('checked with no pickup location yet: an empty location, device/none zone — nothing invented', () => {
    const e = resolveReturnEvent({ ...base, sameAsPickup: true, pickupLoc: emptyRentalLocation(), pickupZone: { zone: 'America/Chicago', source: 'device' } });
    expect(e.location).toEqual(emptyRentalLocation());
    expect(e.zone.source).toBe('device');
  });
  it('unchecked: fully independent — a one-way rental across time zones keeps two locations and two zones', () => {
    const e = resolveReturnEvent({ ...base, sameAsPickup: false, returnLoc: LAX });
    expect(e.location).toEqual(LAX);
    expect(e.zone).toEqual({ zone: 'America/Los_Angeles', source: 'place' });
    const pickupZone = base.pickupZone.zone;
    expect(e.zone.zone).not.toBe(pickupZone);
  });
  it('unchecked: a manually entered return location is NOT overwritten by later pickup changes', () => {
    const manual = place('Burbank Airport', 34.2, -118.35, 'America/Los_Angeles');
    for (const pickupLoc of [MCO, LAX, emptyRentalLocation('somewhere')]) {
      const e = resolveReturnEvent({ ...base, sameAsPickup: false, pickupLoc, returnLoc: manual });
      expect(e.location).toBe(manual);
    }
  });
  it('unchecked free text carries NO coordinates and no place zone (it falls back to a picked/device zone, honestly labelled)', () => {
    const typed = emptyRentalLocation('Downtown office');
    const e = resolveReturnEvent({ ...base, sameAsPickup: false, returnLoc: typed });
    expect(e.location.lat).toBeNull();
    expect(e.location.timeZone).toBeNull();
    expect(e.zone).toEqual({ zone: 'America/Chicago', source: 'device' });
    const picked = resolveReturnEvent({ ...base, sameAsPickup: false, returnLoc: typed, pickedReturnZone: { zone: 'America/Denver', source: 'user' } });
    expect(picked.zone).toEqual({ zone: 'America/Denver', source: 'user' });
  });
  it('toggling either way starts the return side clean: no stale coordinates, no stale picked zone or occurrence choice', () => {
    expect(afterSameAsToggle()).toEqual({ returnLoc: emptyRentalLocation(), pickedReturnZone: null, returnChoice: null });
  });
  it('SEQUENCE: check → uncheck → type → pickup changes → recheck uses the CURRENT pickup', () => {
    let sameAs = true;
    let returnLoc = emptyRentalLocation();
    let picked: { zone: string; source: 'user' } | null = null;
    let pickupLoc = MCO;
    const view = () => resolveReturnEvent({ sameAsPickup: sameAs, pickupLoc, pickupZone: { zone: pickupLoc.timeZone, source: 'place' } as never, returnLoc, pickedReturnZone: picked, deviceZone: null });
    expect(view().location.text).toBe('Orlando International Airport');
    // uncheck
    sameAs = false; ({ returnLoc } = afterSameAsToggle()); picked = null;
    expect(view().location).toEqual(emptyRentalLocation());               // clean slate, not a stale MCO copy
    // user types a return location (RentalLocationInput resets coordinates on typing)
    returnLoc = emptyRentalLocation('Hotel lobby');
    pickupLoc = LAX;                                                      // pickup changes while unchecked
    expect(view().location.text).toBe('Hotel lobby');                     // not overwritten
    // recheck
    sameAs = true; ({ returnLoc } = afterSameAsToggle());
    expect(view().location).toEqual(LAX);                                 // the CURRENT pickup
  });
  it('the saved payload carries the derived return location, coordinates and zone provenance', () => {
    const e = resolveReturnEvent({ ...base, sameAsPickup: true });
    const mk = (loc: RentalLocationValue, zone: { zone: string | null; source: 'place' | 'user' | 'device' | null }, dt: string): QuickSaveEvent => ({
      dateTime: dt, location: loc, zone, status: describeEventTime(dt, zone.zone), choice: null,
    });
    const body = buildQuickSavePayload({ company: 'Hertz', confirmationNumber: '', deviceZone: 'America/Chicago',
      pickup: mk(MCO, base.pickupZone, '2026-10-20T10:00'), ret: mk(e.location, e.zone, '2026-10-24T10:00') });
    expect(body).toMatchObject({
      pickupLocation: 'Orlando International Airport', returnLocation: 'Orlando International Airport',
      pickupLatitude: 28.4312, returnLatitude: 28.4312, pickupLongitude: -81.3081, returnLongitude: -81.3081,
      pickupTimeZone: 'America/New_York', pickupTimeZoneSource: 'place', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place',
    });
  });
});
