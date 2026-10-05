/**
 * C1 time-aware Rental Car Mode — lifecycle precedence, schedule validation
 * and boundaries (docs/RENTAL_TIME_AWARE_MODE.md). Pure, no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRentalLifecycle, classifyRentalSchedule, rentalLifecycleInput, RENTAL_PICKUP_LEAD_HOURS,
  RENTAL_PICKUP_TAIL_HOURS, RENTAL_STALE_AFTER_HOURS, RENTAL_MAX_DURATION_DAYS, RENTAL_LIFECYCLE_SECTION_ORDER,
} from '@/lib/rentalCalculations';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PICKUP = Date.parse('2026-10-10T14:00:00Z');
const RETURN = PICKUP + 72 * H;
const base = { status: 'active', pickupDateTime: null, returnDateTime: null,
  pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(RETURN) };
const at = (now: number, over: Record<string, unknown> = {}) =>
  resolveRentalLifecycle({ ...base, now, ...over } as Parameters<typeof resolveRentalLifecycle>[0]);

describe('constants', () => {
  it('match the approved design', () => {
    expect([RENTAL_PICKUP_LEAD_HOURS, RENTAL_PICKUP_TAIL_HOURS, RENTAL_STALE_AFTER_HOURS, RENTAL_MAX_DURATION_DAYS]).toEqual([3, 6, 72, 366]);
  });
  it('every non-terminal state has a section order', () => {
    for (const k of ['upcoming', 'pickup', 'active', 'near_return', 'overdue', 'stale', 'needs_schedule'] as const) {
      expect(RENTAL_LIFECYCLE_SECTION_ORDER[k]).toBeTruthy();
    }
    // return prep is promoted for overdue/stale, NOT for a schedule that can't be trusted
    expect(RENTAL_LIFECYCLE_SECTION_ORDER.overdue.returnPrep).toBe(1);
    expect(RENTAL_LIFECYCLE_SECTION_ORDER.needs_schedule.returnPrep).toBeGreaterThan(1);
  });
});

describe('precedence 1–2: terminal statuses win over everything', () => {
  it('completed / cancelled even with a malformed schedule or a passed return', () => {
    expect(at(RETURN + 999 * H, { status: 'completed' })).toBe('completed');
    expect(at(PICKUP, { status: 'cancelled', returnDateTimeUtc: 'garbage' })).toBe('cancelled');
  });
});

describe('boundaries — exactly −1 ms / 0 / +1 ms', () => {
  it('upcoming → pickup at pickup − 3h (setup known incomplete)', () => {
    const edge = PICKUP - 3 * H;
    expect(at(edge - 1, { setupComplete: false })).toBe('upcoming');
    expect(at(edge, { setupComplete: false })).toBe('pickup');
    expect(at(edge + 1, { setupComplete: false })).toBe('pickup');
  });
  it('pickup ends at pickup + 6h (setup still incomplete) → active', () => {
    const edge = PICKUP + 6 * H;
    expect(at(edge - 1, { setupComplete: false })).toBe('pickup');
    expect(at(edge, { setupComplete: false })).toBe('active');
  });
  it('near_return at return − 24h (inclusive)', () => {
    const edge = RETURN - 24 * H;
    expect(at(edge - 1, { setupComplete: true })).toBe('active');
    expect(at(edge, { setupComplete: true })).toBe('near_return');
  });
  it('overdue at return, stale at return + 72h', () => {
    expect(at(RETURN - 1)).toBe('near_return');
    expect(at(RETURN)).toBe('overdue');
    expect(at(RETURN + 72 * H - 1)).toBe('overdue');
    expect(at(RETURN + 72 * H)).toBe('stale');
  });
});

describe('setup state decides pickup vs upcoming — and unknown never invents pickup', () => {
  const inWindow = PICKUP - 1 * H;
  it('setup complete before pickup stays upcoming (never the at-the-counter card)', () => {
    expect(at(inWindow, { setupComplete: true })).toBe('upcoming');
  });
  it('setup incomplete inside the window is pickup', () => {
    expect(at(inWindow, { setupComplete: false })).toBe('pickup');
  });
  it('setup UNKNOWN stays upcoming until the pickup instant, then active — never pickup', () => {
    expect(at(inWindow)).toBe('upcoming');
    expect(at(PICKUP + 1 * H)).toBe('active');
  });
  it('setup completed during/after pickup leaves pickup immediately', () => {
    expect(at(PICKUP + 1 * H, { setupComplete: false })).toBe('pickup');
    expect(at(PICKUP + 1 * H, { setupComplete: true })).toBe('active');
  });
});

describe('short rentals and rule order', () => {
  const shortReturn = PICKUP + 2 * H;
  const short = { returnDateTimeUtc: iso(shortReturn) };
  it('a 2h rental is pickup (setup incomplete) until the return time, then overdue — overdue outranks pickup', () => {
    expect(at(PICKUP + 1 * H, { ...short, setupComplete: false })).toBe('pickup');
    expect(at(shortReturn - 1, { ...short, setupComplete: false })).toBe('pickup');
    expect(at(shortReturn, { ...short, setupComplete: false })).toBe('overdue');
    expect(at(shortReturn + 5 * H, { ...short, setupComplete: false })).toBe('overdue'); // would still be inside pickup's 6h tail
  });
  it('a 23h rental is near_return as soon as it is picked up and setup is done', () => {
    expect(at(PICKUP + 1, { returnDateTimeUtc: iso(PICKUP + 23 * H), setupComplete: true })).toBe('near_return');
  });
});

describe('missing times are unknown, never invented', () => {
  it('no pickup: not upcoming/pickup — near_return/active/overdue by the return time', () => {
    expect(at(PICKUP, { pickupDateTimeUtc: null, setupComplete: false })).toBe('active');
    expect(at(RETURN + 1, { pickupDateTimeUtc: null })).toBe('overdue');
  });
  it('no return: active (never near_return/overdue/stale)', () => {
    expect(at(PICKUP + 500 * H, { returnDateTimeUtc: null })).toBe('active');
    expect(at(PICKUP - 10 * H, { returnDateTimeUtc: null })).toBe('upcoming');
  });
  it('neither time: active', () => {
    expect(at(PICKUP, { pickupDateTimeUtc: null, returnDateTimeUtc: null })).toBe('active');
  });
});

describe('C-LIFE2: malformed / inconsistent schedules are checked BEFORE any time-based state', () => {
  const NOW = RETURN + 100 * H; // would be stale for a valid schedule
  it('return = pickup exactly → needs_schedule; pickup + 1 ms → valid', () => {
    expect(classifyRentalSchedule({ pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(PICKUP) })).toBe('inconsistent');
    expect(classifyRentalSchedule({ pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(PICKUP + 1) })).toBe('ok');
  });
  it('return = pickup − 1 ms → inconsistent', () => {
    expect(classifyRentalSchedule({ pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(PICKUP - 1) })).toBe('inconsistent');
  });
  it('duration 366 days is ok; 366 days + 1 ms is implausible', () => {
    const d = RENTAL_MAX_DURATION_DAYS * 24 * H;
    expect(classifyRentalSchedule({ pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(PICKUP + d) })).toBe('ok');
    expect(classifyRentalSchedule({ pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(PICKUP + d + 1) })).toBe('implausible');
  });
  it('an unparseable UTC is invalid even when a valid local string exists (UTC wins, never masked)', () => {
    expect(classifyRentalSchedule({ pickupDateTimeUtc: 'not-a-date', pickupDateTime: '2026-10-10T10:00', returnDateTimeUtc: iso(RETURN) })).toBe('invalid');
  });
  it('an unparseable local with no UTC is invalid; a valid local with no UTC is ok (legacy fallback)', () => {
    expect(classifyRentalSchedule({ pickupDateTime: 'garbage', returnDateTime: null })).toBe('invalid');
    expect(classifyRentalSchedule({ pickupDateTime: '2026-10-10T10:00', returnDateTime: '2026-10-12T10:00' })).toBe('ok');
  });
  it('an invalid or abbreviated zone is invalid; valid IANA and absent zones are fine', () => {
    expect(classifyRentalSchedule({ pickupTimeZone: 'EST', pickupDateTimeUtc: iso(PICKUP) })).toBe('invalid');
    expect(classifyRentalSchedule({ returnTimeZone: 'Mars/Olympus', returnDateTimeUtc: iso(RETURN) })).toBe('invalid');
    expect(classifyRentalSchedule({ timeZone: 'Nope', pickupDateTimeUtc: iso(PICKUP) })).toBe('invalid');
    expect(classifyRentalSchedule({ pickupTimeZone: 'America/New_York', returnTimeZone: 'Europe/London', timeZone: null, pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(RETURN) })).toBe('ok');
  });
  it('pickup known with a malformed return → invalid (not treated as "no return")', () => {
    expect(classifyRentalSchedule({ pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: 'xx' })).toBe('invalid');
  });
  it('absent times (null, undefined, empty string) are unknown, not invalid', () => {
    expect(classifyRentalSchedule({})).toBe('ok');
    expect(classifyRentalSchedule({ pickupDateTimeUtc: '', returnDateTimeUtc: null, pickupDateTime: '' })).toBe('ok');
  });
  it('needs_schedule outranks stale/overdue/pickup/near_return for every bad class', () => {
    for (const bad of [
      { returnDateTimeUtc: iso(PICKUP - H) },                      // inconsistent
      { returnDateTimeUtc: 'garbage' },                            // invalid
      { returnDateTimeUtc: iso(PICKUP + 400 * 24 * H) },           // implausible
      { pickupTimeZone: 'EST' },                                   // invalid zone
    ]) {
      for (const now of [PICKUP - 1 * H, PICKUP + 1 * H, NOW]) {
        expect(at(now, { ...bad, setupComplete: false })).toBe('needs_schedule');
      }
    }
  });
  it('fixing the times restores a normal state immediately', () => {
    expect(at(NOW, { returnDateTimeUtc: iso(PICKUP - H) })).toBe('needs_schedule');
    expect(at(NOW, { returnDateTimeUtc: iso(RETURN) })).toBe('stale');
  });
});

describe('DST and zones: the UTC instant decides, never the viewer', () => {
  // Pickup 2026-11-01 01:30 America/New_York — the REPEATED hour (EDT first, then EST).
  const earlier = Date.parse('2026-11-01T05:30:00Z'); // 1:30 AM EDT
  const later   = Date.parse('2026-11-01T06:30:00Z'); // 1:30 AM EST
  const common = { status: 'active', pickupDateTime: '2026-11-01T01:30', returnDateTime: '2026-11-03T10:00',
    returnDateTimeUtc: '2026-11-03T15:00:00.000Z', pickupTimeZone: 'America/New_York', returnTimeZone: 'America/New_York', setupComplete: false };
  it('the two occurrences of the ambiguous hour are exactly an hour apart in state', () => {
    const state = (pickupUtc: string, now: number) => resolveRentalLifecycle({ ...common, pickupDateTimeUtc: pickupUtc, now });
    expect(state('2026-11-01T05:30:00.000Z', earlier - 4 * H)).toBe('upcoming');
    expect(state('2026-11-01T05:30:00.000Z', earlier)).toBe('pickup');
    expect(state('2026-11-01T06:30:00.000Z', earlier)).toBe('pickup');   // 1.0h before the later occurrence
    expect(state('2026-11-01T06:30:00.000Z', later + 6 * H)).toBe('active');
  });
  it('spring-forward: pickup 2027-03-14 03:30 EDT (02:xx does not exist) uses the stored instant', () => {
    const r = { ...common, pickupDateTime: '2027-03-14T03:30', pickupDateTimeUtc: '2027-03-14T07:30:00.000Z', returnDateTimeUtc: '2027-03-16T15:00:00.000Z', returnDateTime: '2027-03-16T11:00' };
    expect(resolveRentalLifecycle({ ...r, now: Date.parse('2027-03-14T04:29:59Z') })).toBe('upcoming');
    expect(resolveRentalLifecycle({ ...r, now: Date.parse('2027-03-14T04:30:00Z') })).toBe('pickup');
  });
  it('London and Los Angeles pickups at the same instant give the same state', () => {
    const a = resolveRentalLifecycle({ ...common, pickupTimeZone: 'Europe/London', pickupDateTimeUtc: '2026-10-10T14:00:00.000Z', pickupDateTime: '2026-10-10T15:00', now: Date.parse('2026-10-10T12:00:00Z') });
    const b = resolveRentalLifecycle({ ...common, pickupTimeZone: 'America/Los_Angeles', pickupDateTimeUtc: '2026-10-10T14:00:00.000Z', pickupDateTime: '2026-10-10T07:00', now: Date.parse('2026-10-10T12:00:00Z') });
    expect(a).toBe(b);
  });
});

describe('rescheduling recomputes from the current times', () => {
  it('moving the pickup later moves a pickup-state rental back to upcoming; earlier moves it forward', () => {
    const now = PICKUP - 1 * H;
    expect(at(now, { setupComplete: false })).toBe('pickup');
    expect(at(now, { setupComplete: false, pickupDateTimeUtc: iso(PICKUP + 24 * H), returnDateTimeUtc: iso(RETURN + 24 * H) })).toBe('upcoming');
  });
  it('an expired quick-saved reservation never set up walks pickup → active/near_return → overdue → stale, never auto-closed', () => {
    const seq = [PICKUP - 1 * H, PICKUP + 7 * H, RETURN - 2 * H, RETURN + 1, RETURN + 73 * H].map((n) => at(n, { setupComplete: false }));
    expect(seq).toEqual(['pickup', 'active', 'near_return', 'overdue', 'stale']);
  });
});

describe('rentalLifecycleInput maps a stored session', () => {
  const s = { status: 'active', vehicleMake: null, vehicleModel: null, fuelTankCapacityGallons: null, pickupFuelGallons: null,
    currentFuelGallons: null, requiredReturnFuelGallons: null, pickupDateTime: '2026-10-10T10:00', returnDateTime: '2026-10-13T10:00',
    pickupDateTimeUtc: iso(PICKUP), returnDateTimeUtc: iso(RETURN), pickupTimeZone: 'America/New_York', returnTimeZone: null, timeZone: null };
  it('setupComplete is false for a bare quick-save, true when vehicle + tank + pickup fuel exist', () => {
    expect(rentalLifecycleInput(s).setupComplete).toBe(false);
    expect(rentalLifecycleInput({ ...s, vehicleMake: 'Toyota', vehicleModel: 'Camry', fuelTankCapacityGallons: 14, pickupFuelGallons: 7 }).setupComplete).toBe(true);
  });
  it('a quick-saved rental never has fuel invented by the lifecycle (no field is read or written)', () => {
    const input = rentalLifecycleInput(s);
    expect(Object.keys(input)).not.toContain('pickupFuelGallons');
  });
  it('threads an explicit now', () => {
    expect(rentalLifecycleInput(s, 123).now).toBe(123);
  });
});
