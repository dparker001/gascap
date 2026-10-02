/**
 * T2 — server event-timezone model (2026-10-02, approved).
 * Validation, DST classification, per-event create/PATCH semantics, the
 * reminder-reset matrix, legacy fallback, and UTC lifecycle invariance.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isValidIanaZone, parseStrictLocalDateTime, resolveEventUtc, storedOccurrence, localDateTimeToUtcIso,
} from '@/lib/rentalTimezone';
import { resolveRentalLifecycle } from '@/lib/rentalCalculations';

type Row = Record<string, unknown>;
const table = new Map<string, Row>();
let created: Row | null = null;
vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      create: vi.fn(async ({ data }: { data: Row }) => { created = { ...data, refuelLogs: [] }; return created; }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const r = table.get(where.id); return r && r.userId === where.userId ? r : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const r = table.get(where.id)!; Object.assign(r, data); return r;
      }),
    },
  },
}));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));

const mod = () => import('@/lib/rentalSessions');
const STAMPS = { pickupReminder24SentAt: 'x', pickupReminder2SentAt: 'x', reminderSentAt: 'x', returnReminder2SentAt: 'x' };
const base = (o: Row = {}): Row => ({
  id: 'rs', userId: 'u', status: 'active', refuelLogs: [],
  pickupFuelGallons: null, pickupFuelSource: null, currentFuelGallons: null, currentFuelSource: null,
  requiredReturnFuelGallons: null, requiredReturnPolicyType: 'same_as_pickup', fuelTankCapacityGallons: 14,
  timeZone: 'America/New_York',
  pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneSource: 'place',
  pickupDateTimeUtc: '2026-10-05T21:00:00.000Z',
  returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place',
  returnDateTimeUtc: '2026-10-08T14:00:00.000Z',
  notes: null, rentalAgreementNumber: null, rentalCompany: 'Hertz',
  ...STAMPS, ...o,
});
beforeEach(() => { table.clear(); created = null; });

describe('timezone + datetime validation', () => {
  it('accepts canonical IANA (incl. Google-modern names) and UTC; rejects abbreviations, untrimmed, Etc/*, aliases, junk', () => {
    for (const z of ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Europe/Kyiv', 'America/Indiana/Indianapolis']) {
      expect(isValidIanaZone(z), z).toBe(true);
    }
    for (const z of ['EST', 'EST5EDT', 'PST', ' America/New_York', 'America/New_York ', 'Etc/GMT+5', 'US/Eastern', 'Not/AZone', '', null, 42]) {
      expect(isValidIanaZone(z), String(z)).toBe(false);
    }
  });
  it('never throws on an invalid zone (no escaped RangeError)', () => {
    expect(() => resolveEventUtc('2026-10-05T14:00', 'Not/AZone')).not.toThrow();
    expect(resolveEventUtc('2026-10-05T14:00', 'Not/AZone')).toEqual({ ok: false, code: 'invalid_time_zone' });
  });
  it('rejects impossible or malformed local datetimes', () => {
    for (const v of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-10-05T24:00', '2026-10-05T10:60', 'garbage', '2026-10-05 10:00']) {
      expect(parseStrictLocalDateTime(v), v).toBeNull();
    }
    expect(parseStrictLocalDateTime('2028-02-29T10:00')).not.toBeNull(); // leap day
  });
});

describe('DST handling', () => {
  it('normal times are DST-correct', () => {
    expect(resolveEventUtc('2026-10-05T14:00', 'America/Los_Angeles')).toMatchObject({ ok: true, utcIso: '2026-10-05T21:00:00.000Z' });
    expect(resolveEventUtc('2026-12-05T14:00', 'America/Los_Angeles')).toMatchObject({ ok: true, utcIso: '2026-12-05T22:00:00.000Z' });
  });
  it('a spring-forward gap time is rejected (422), never normalized', () => {
    expect(resolveEventUtc('2027-03-14T02:30', 'America/New_York')).toEqual({ ok: false, code: 'nonexistent_local_time' });
    expect(resolveEventUtc('2027-03-14T03:00', 'America/New_York')).toMatchObject({ ok: true, utcIso: '2027-03-14T07:00:00.000Z' });
  });
  it('a fall-back repeated time requires an explicit choice; EARLIER and LATER both resolve correctly', () => {
    expect(resolveEventUtc('2026-11-01T01:30', 'America/New_York')).toEqual({ ok: false, code: 'ambiguous_local_time' });
    expect(resolveEventUtc('2026-11-01T01:30', 'America/New_York', 'earlier')).toEqual({ ok: true, utcIso: '2026-11-01T05:30:00.000Z', occurrence: 'earlier' });
    expect(resolveEventUtc('2026-11-01T01:30', 'America/New_York', 'later')).toEqual({ ok: true, utcIso: '2026-11-01T06:30:00.000Z', occurrence: 'later' });
  });
  it('the persisted choice is recoverable from the stored UTC instant (no extra column)', () => {
    expect(storedOccurrence('2026-11-01T01:30', 'America/New_York', '2026-11-01T05:30:00.000Z')).toBe('earlier');
    expect(storedOccurrence('2026-11-01T01:30', 'America/New_York', '2026-11-01T06:30:00.000Z')).toBe('later');
    expect(storedOccurrence('2026-10-05T14:00', 'America/New_York', '2026-10-05T18:00:00.000Z')).toBeNull();
  });
});

describe('CREATE — independent event zones', () => {
  it('MANDATORY one-way: LAX pickup / JFK return derive their own instants; the 2h return reminder is BEFORE the due instant', async () => {
    const { createRentalSession } = await mod();
    await createRentalSession('u', {
      rentalCompany: 'Hertz',
      pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneSource: 'place',
      returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/New_York',   returnTimeZoneSource: 'place',
      timeZone: 'America/New_York',
    });
    expect(created!.pickupDateTimeUtc).toBe('2026-10-05T21:00:00.000Z');
    expect(created!.returnDateTimeUtc).toBe('2026-10-08T14:00:00.000Z');
    const due = Date.parse('2026-10-08T14:00:00Z');
    const reminder = Date.parse(created!.returnDateTimeUtc as string) - 2 * 3_600_000;
    expect(reminder).toBeLessThan(due);
  });

  it('the former single-zone model FAILS that same one-way assertion (regression proof)', () => {
    // Old behaviour: one zone (the LA device at booking) for BOTH events.
    const oldReturnUtc = localDateTimeToUtcIso('2026-10-08T10:00', 'America/Los_Angeles')!;
    const reminder = Date.parse(oldReturnUtc) - 2 * 3_600_000;
    expect(reminder).toBeGreaterThanOrEqual(Date.parse('2026-10-08T14:00:00Z')); // arrives after the car is due
  });

  it('ignores any client-supplied UTC instant', async () => {
    const { createRentalSession } = await mod();
    await createRentalSession('u', {
      rentalCompany: 'Hertz', pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneSource: 'place',
      ...({ pickupDateTimeUtc: '1999-01-01T00:00:00.000Z' } as object),
    });
    expect(created!.pickupDateTimeUtc).toBe('2026-10-05T21:00:00.000Z');
  });

  it('an older client sending only the legacy device timeZone gets it as each event zone with source "device"', async () => {
    const { createRentalSession } = await mod();
    await createRentalSession('u', { rentalCompany: 'Hertz', pickupDateTime: '2026-10-05T14:00', returnDateTime: '2026-10-06T10:00', timeZone: 'America/Chicago' });
    expect(created).toMatchObject({ pickupTimeZone: 'America/Chicago', pickupTimeZoneSource: 'device', returnTimeZone: 'America/Chicago', returnTimeZoneSource: 'device', timeZone: 'America/Chicago' });
    expect(created!.pickupDateTimeUtc).toBe('2026-10-05T19:00:00.000Z');
  });

  it('never borrows the pickup zone for the return event', async () => {
    const { createRentalSession } = await mod();
    await createRentalSession('u', { rentalCompany: 'Hertz', pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', returnDateTime: '2026-10-08T10:00' });
    expect(created!.returnTimeZone).toBeNull();
    expect(created!.returnDateTimeUtc).toBeNull();
  });

  it('rejects: invalid zone 400, nonexistent 422, ambiguous-without-choice 422; with a choice it saves', async () => {
    const { createRentalSession, RentalScheduleError } = await mod();
    const attempt = (o: object) => createRentalSession('u', { rentalCompany: 'Hertz', ...o });
    await expect(attempt({ pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'EST' })).rejects.toMatchObject({ code: 'invalid_time_zone', status: 400 });
    await expect(attempt({ returnDateTime: '2027-03-14T02:30', returnTimeZone: 'America/New_York' })).rejects.toMatchObject({ code: 'nonexistent_local_time', status: 422, field: 'returnDateTime' });
    await expect(attempt({ returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York' })).rejects.toBeInstanceOf(RentalScheduleError);
    await attempt({ returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York', returnTimeDisambiguation: 'later' });
    expect(created!.returnDateTimeUtc).toBe('2026-11-01T06:30:00.000Z');
  });
});

describe('PATCH — event semantics + reminder-reset matrix', () => {
  const patch = async (o: object, row: Row = base()) => {
    table.set('rs', row);
    const { updateRentalSession } = await mod();
    return (await updateRentalSession('u', 'rs', o)) as unknown as Row;
  };
  const stampsKept = (r: Row) => Object.keys(STAMPS).every((k) => r[k] === 'x');

  it('notes only / reservation number only: nothing scheduling-related changes', async () => {
    for (const o of [{ notes: 'gate 4' }, { rentalAgreementNumber: 'A123' }, { rentalCompany: 'Avis' }]) {
      const r = await patch(o);
      expect(stampsKept(r)).toBe(true);
      expect(r.pickupDateTimeUtc).toBe('2026-10-05T21:00:00.000Z');
      expect(r.returnDateTimeUtc).toBe('2026-10-08T14:00:00.000Z');
    }
  });

  it('an edit from a device in a THIRD zone (stale client sends timeZone) changes nothing', async () => {
    const r = await patch({ timeZone: 'America/Chicago', notes: 'from Chicago', pickupDateTime: '2026-10-05T14:00', returnDateTime: '2026-10-08T10:00' });
    expect(stampsKept(r)).toBe(true);
    expect(r).toMatchObject({ timeZone: 'America/New_York', pickupTimeZone: 'America/Los_Angeles', returnTimeZone: 'America/New_York',
      pickupDateTimeUtc: '2026-10-05T21:00:00.000Z', returnDateTimeUtc: '2026-10-08T14:00:00.000Z' });
  });

  it('pickup datetime change → re-derives pickup only; resets pickup stamps only', async () => {
    const r = await patch({ pickupDateTime: '2026-10-05T16:00' });
    expect(r.pickupDateTimeUtc).toBe('2026-10-05T23:00:00.000Z');
    expect(r.returnDateTimeUtc).toBe('2026-10-08T14:00:00.000Z');
    expect([r.pickupReminder24SentAt, r.pickupReminder2SentAt]).toEqual([null, null]);
    expect([r.reminderSentAt, r.returnReminder2SentAt]).toEqual(['x', 'x']);
  });

  it('return datetime change → re-derives return only; resets return stamps only', async () => {
    const r = await patch({ returnDateTime: '2026-10-08T12:00' });
    expect(r.returnDateTimeUtc).toBe('2026-10-08T16:00:00.000Z');
    expect([r.pickupReminder24SentAt, r.pickupReminder2SentAt]).toEqual(['x', 'x']);
    expect([r.reminderSentAt, r.returnReminder2SentAt]).toEqual([null, null]);
  });

  it('pickup zone change → pickup re-derived + reset; return untouched', async () => {
    const r = await patch({ pickupTimeZone: 'America/Denver', pickupTimeZoneSource: 'user' });
    expect(r).toMatchObject({ pickupTimeZone: 'America/Denver', pickupTimeZoneSource: 'user', pickupDateTimeUtc: '2026-10-05T20:00:00.000Z' });
    expect([r.pickupReminder24SentAt, r.reminderSentAt]).toEqual([null, 'x']);
  });

  it('return zone change → return re-derived + reset; pickup untouched', async () => {
    const r = await patch({ returnTimeZone: 'America/Chicago', returnTimeZoneSource: 'place' });
    expect(r.returnDateTimeUtc).toBe('2026-10-08T15:00:00.000Z');
    expect([r.pickupReminder24SentAt, r.reminderSentAt]).toEqual(['x', null]);
  });

  it('same zone confirmed with a new source (device → place) updates the source, not the schedule', async () => {
    const r = await patch({ returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place' },
      base({ returnTimeZoneSource: 'device' }));
    expect(r.returnTimeZoneSource).toBe('place');
    expect(stampsKept(r)).toBe(true);
  });

  it('location text change with the same effective zone → no reset', async () => {
    const r = await patch({ returnLocation: 'JFK Terminal 4 rental lot', pickupLocation: 'LAX Hertz' });
    expect(stampsKept(r)).toBe(true);
  });

  it('a stored LATER occurrence is preserved through an unrelated edit', async () => {
    const row = base({ returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York', returnDateTimeUtc: '2026-11-01T06:30:00.000Z' });
    const r = await patch({ notes: 'unrelated', returnDateTime: '2026-11-01T01:30' }, row);
    expect(r.returnDateTimeUtc).toBe('2026-11-01T06:30:00.000Z');
    expect(stampsKept(r)).toBe(true);
  });

  it('changing the ambiguous occurrence (later → earlier) resets only that event', async () => {
    const row = base({ returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York', returnDateTimeUtc: '2026-11-01T06:30:00.000Z' });
    const r = await patch({ returnTimeDisambiguation: 'earlier' }, row);
    expect(r.returnDateTimeUtc).toBe('2026-11-01T05:30:00.000Z');
    expect([r.pickupReminder24SentAt, r.reminderSentAt]).toEqual(['x', null]);
  });

  it('moving an event to a NEW ambiguous wall time requires the choice again (422)', async () => {
    const { RentalScheduleError } = await mod();
    await expect(patch({ returnDateTime: '2026-11-01T01:15' })).rejects.toBeInstanceOf(RentalScheduleError);
    const r = await patch({ returnDateTime: '2026-11-01T01:15', returnTimeDisambiguation: 'earlier' });
    expect(r.returnDateTimeUtc).toBe('2026-11-01T05:15:00.000Z');
  });

  it('LEGACY row (no event zones): a datetime edit uses the STORED legacy zone, never the device zone', async () => {
    const legacy = base({ pickupTimeZone: null, pickupTimeZoneSource: null, returnTimeZone: null, returnTimeZoneSource: null,
      timeZone: 'America/New_York', returnDateTime: '2026-10-08T10:00', returnDateTimeUtc: '2026-10-08T14:00:00.000Z' });
    const r = await patch({ returnDateTime: '2026-10-08T11:00', timeZone: 'America/Los_Angeles' }, legacy);
    expect(r.returnDateTimeUtc).toBe('2026-10-08T15:00:00.000Z'); // New York, not LA
    expect(r.timeZone).toBe('America/New_York');
    expect(r.returnTimeZone).toBeNull();                          // not rewritten
  });

  it('an invalid event zone in a PATCH is rejected and nothing is written', async () => {
    await expect(patch({ pickupTimeZone: 'PST' })).rejects.toMatchObject({ code: 'invalid_time_zone' });
    expect(table.get('rs')!.pickupTimeZone).toBe('America/Los_Angeles');
  });
});

describe('lifecycle uses the UTC instant — invariant to the VIEWING device timezone', () => {
  const rental = { status: 'active', pickupDateTime: '2026-10-05T14:00', pickupDateTimeUtc: '2026-10-05T21:00:00.000Z',
                   returnDateTime: '2026-10-08T10:00', returnDateTimeUtc: '2026-10-08T14:00:00.000Z' };
  const at = (iso: string, tz: string) => {
    const prev = process.env.TZ; process.env.TZ = tz;
    try { return resolveRentalLifecycle({ ...rental, now: Date.parse(iso) }); } finally { process.env.TZ = prev; }
  };

  it('the same instant yields the same state whether viewed from Orlando, LA or Tokyo', () => {
    for (const iso of ['2026-10-05T19:30:00Z', '2026-10-05T21:30:00Z', '2026-10-07T15:00:00Z']) {
      const states = ['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'].map((tz) => at(iso, tz));
      expect(new Set(states).size, iso).toBe(1);
    }
    expect(at('2026-10-05T19:30:00Z', 'America/New_York')).toBe('upcoming');   // 12:30 PM in LA: not picked up yet
    expect(at('2026-10-05T21:30:00Z', 'America/New_York')).toBe('active');
    expect(at('2026-10-07T15:00:00Z', 'America/New_York')).toBe('near_return');
  });

  it('sanity: switching the device TZ really moves a NAIVE parse (so the invariance above is meaningful)', () => {
    const parseIn = (tz: string) => { const prev = process.env.TZ; process.env.TZ = tz;
      try { return new Date('2026-10-05T14:00').getTime(); } finally { process.env.TZ = prev; } };
    expect(parseIn('America/New_York')).not.toBe(parseIn('America/Los_Angeles'));
    // ...and with the naive string alone, the lifecycle state WOULD depend on the viewer:
    const naive = { status: 'active', pickupDateTime: '2026-10-05T14:00', returnDateTime: '2026-10-08T10:00' };
    const view = (tz: string) => { const prev = process.env.TZ; process.env.TZ = tz;
      try { return resolveRentalLifecycle({ ...naive, now: Date.parse('2026-10-05T19:30:00Z') }); } finally { process.env.TZ = prev; } };
    expect(view('America/New_York')).not.toBe(view('America/Los_Angeles'));
  });

  it('a legacy row with no UTC still uses the naive fallback (documented backward compatibility)', () => {
    const legacy = { status: 'active', pickupDateTime: '2026-10-05T14:00', returnDateTime: '2026-10-08T10:00' };
    expect(resolveRentalLifecycle({ ...legacy, now: Date.parse('2026-10-01T00:00:00Z') })).toBe('upcoming');
  });
});
