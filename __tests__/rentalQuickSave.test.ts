/**
 * Part A / A4 (2026-10-02) — quick-save an upcoming rental. Second entry
 * point; pickup date/time required; no vehicle/tank/fuel ever sent; same
 * create endpoint (server Pro gate + DST/zone/UTC rules unchanged); the full
 * wizard is untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { quickSaveCanSubmit, buildQuickSavePayload, type QuickSaveEvent } from '@/lib/rentalQuickSave';
import { describeEventTime } from '@/lib/rentalTimezone';

const loc = (text: string, timeZone: string | null = null) =>
  ({ text, lat: timeZone ? 1 : null, lng: timeZone ? 2 : null, timeZone, timeZoneSource: timeZone ? 'place' as const : null });
const ev = (dateTime: string, zone: string | null, source: 'place' | 'user' | 'device' | null = 'place', choice: 'earlier' | 'later' | null = null): QuickSaveEvent =>
  ({ dateTime, location: loc('X', zone), zone: { zone, source: zone ? source : null }, status: describeEventTime(dateTime, zone), choice });
const src = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

const base = { company: 'Hertz', confirmationNumber: ' K123 ', deviceZone: 'America/New_York',
  pickup: ev('2026-10-20T10:00', 'America/New_York'), ret: ev('2026-10-23T14:00', 'America/Los_Angeles') };

describe('quickSaveCanSubmit', () => {
  it('company + pickup + return, each in a zone → ok', () => {
    expect(quickSaveCanSubmit(base)).toBe(true);
  });
  it('pickup date/time is REQUIRED (unlike the full wizard)', () => {
    expect(quickSaveCanSubmit({ ...base, pickup: ev('', 'America/New_York') })).toBe(false);
  });
  it('return date/time and company are required', () => {
    expect(quickSaveCanSubmit({ ...base, ret: ev('', 'America/Los_Angeles') })).toBe(false);
    expect(quickSaveCanSubmit({ ...base, company: '  ' })).toBe(false);
  });
  it('a spring-forward gap time blocks; an ambiguous fall-back time is allowed (choice sent)', () => {
    expect(quickSaveCanSubmit({ ...base, pickup: ev('2027-03-14T02:30', 'America/New_York') })).toBe(false);
    expect(quickSaveCanSubmit({ ...base, ret: ev('2026-11-01T01:30', 'America/New_York') })).toBe(true);
  });
  it('a time with no zone at all blocks (it would save with no reminders)', () => {
    expect(quickSaveCanSubmit({ ...base, pickup: ev('2026-10-20T10:00', null) })).toBe(false);
  });
});

describe('buildQuickSavePayload', () => {
  const body = buildQuickSavePayload({ ...base, ret: ev('2026-11-01T01:30', 'America/New_York', 'user', 'later') });
  it('sends each event with its own zone/source and the explicit occurrence', () => {
    expect(body).toMatchObject({
      rentalCompany: 'Hertz', rentalConfirmationNumber: 'K123', requiredReturnPolicyType: 'same_as_pickup',
      pickupDateTime: '2026-10-20T10:00', pickupTimeZone: 'America/New_York', pickupTimeZoneSource: 'place',
      returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'user',
      returnTimeDisambiguation: 'later', timeZone: 'America/New_York',
    });
    expect(body.pickupTimeDisambiguation).toBeUndefined();
  });
  it('never sends vehicle, tank, fuel, rate, photos or any UTC instant', () => {
    for (const k of ['vehicleYear', 'vehicleMake', 'vehicleModel', 'vehicleTrim', 'fuelTankCapacityGallons',
                     'pickupFuelGallons', 'pickupFuelSource', 'currentFuelGallons', 'requiredReturnFuelGallons',
                     'rentalFuelChargePerGallon', 'pickupDateTimeUtc', 'returnDateTimeUtc', 'pickupGaugePhotoThumb']) {
      expect(body).not.toHaveProperty(k);
    }
  });
});

describe('wiring', () => {
  it('the form reuses RentalEventScheduleField for both events and posts to the normal create endpoint', () => {
    const f = src('components/rental-return/QuickSaveRentalForm.tsx');
    expect(f.match(/<RentalEventScheduleField/g)).toHaveLength(2);
    expect(f).toContain("fetch('/api/rental-sessions'");
    expect(f).toContain('buildQuickSavePayload(');
    expect(f).toContain('quickSaveCanSubmit(');
  });
  it('the rentals page offers it as a SECOND entry point next to the unchanged full wizard', () => {
    const p = src('app/rental-return/page.tsx');
    expect(p).toContain('<QuickSaveRentalForm');
    expect(p).toContain('<RentalSetupFlow');
    expect(p).toContain("setMode('quick')");
  });
});
