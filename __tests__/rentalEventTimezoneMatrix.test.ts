/**
 * T6 — end-to-end regression matrix (2026-10-02). Rentals are created and
 * edited through the REAL server model (createRentalSession /
 * updateRentalSession); the REAL cron route builds its Prisma `where`
 * clauses; a small evaluator applies those clauses to the stored row at a
 * chosen instant. This proves reminder timing from input wall clock + event
 * zone all the way to "would this tier fire now".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

process.env.CRON_SECRET = 'test-cron-secret';
type Row = Record<string, unknown>;
const table = new Map<string, Row>();
let lastCreated: Row | null = null;
const cronWheres: Record<string, unknown>[] = [];

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rentalSession: {
      create: vi.fn(async ({ data }: { data: Row }) => { lastCreated = { ...data, refuelLogs: [] }; table.set(data.id as string, lastCreated); return lastCreated; }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
        const r = table.get(where.id); return r && r.userId === where.userId ? r : null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const r = table.get(where.id)!; Object.assign(r, data); return r; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => { cronWheres.push(where); return []; }),
    },
  },
}));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'recorded' })) }));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/userPush', () => ({ sendUserPush: vi.fn(async () => {}) }));
vi.mock('@/lib/emailLog', () => ({ logEmail: vi.fn(async () => {}), logEmailError: vi.fn(async () => {}) }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond === null) return v == null;
    if (typeof cond !== 'object') return v === cond;
    const c = cond as { not?: null; gte?: string; lte?: string };
    if ('not' in c && c.not === null && v == null) return false;
    if (c.gte != null && !(typeof v === 'string' && v >= c.gte)) return false;
    if (c.lte != null && !(typeof v === 'string' && v <= c.lte)) return false;
    return true;
  });
}

type Tier = 'pickup24' | 'pickup2' | 'returnDue' | 'return2';
const DEDUP: Record<Tier, string> = { pickup24: 'pickupReminder24SentAt', pickup2: 'pickupReminder2SentAt', returnDue: 'reminderSentAt', return2: 'returnReminder2SentAt' };

/** Would `tier` fire for `row` if the cron ran at `iso`? Uses the route's real where clause. */
async function fires(row: Row, tier: Tier, iso: string): Promise<boolean> {
  cronWheres.length = 0;
  vi.setSystemTime(new Date(iso));
  const { GET } = await import('@/app/api/cron/rental-return-reminder/route');
  await GET(new Request('https://www.gascap.app/api/cron/rental-return-reminder?secret=test-cron-secret'));
  const where = cronWheres.find((w) => DEDUP[tier] in w && Object.keys(w).filter((k) => k.endsWith('SentAt')).length === 1)!;
  return matches(row, where);
}

const lib = () => import('@/lib/rentalSessions');
async function create(input: Record<string, unknown>): Promise<Row> {
  const { createRentalSession } = await lib();
  await createRentalSession('u', { rentalCompany: 'Hertz', ...input });
  // The prisma mock reassigns lastCreated; TS can't see that, so widen it.
  const created = lastCreated as Row | null;
  return { ...(created as Row), pickupReminder24SentAt: null, pickupReminder2SentAt: null, reminderSentAt: null, returnReminder2SentAt: null };
}

beforeEach(() => { table.clear(); lastCreated = null; vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('same timezone (Orlando pickup + Orlando return)', () => {
  it('create → pickup 2h tier fires in the real window only; return 2h before due', async () => {
    const row = await create({ pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/New_York', pickupTimeZoneSource: 'place',
                               returnDateTime: '2026-10-07T10:00', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place' });
    expect(row.pickupDateTimeUtc).toBe('2026-10-05T18:00:00.000Z');
    expect(await fires(row, 'pickup2', '2026-10-05T16:30:00Z')).toBe(true);
    expect(await fires(row, 'pickup2', '2026-10-05T11:30:00Z')).toBe(false);  // the old naive compare fired here
    expect(await fires(row, 'return2', '2026-10-07T12:30:00Z')).toBe(true);
  });
});

describe('cross-timezone round trip: booked from Orlando, LAX pickup + LAX return', () => {
  it('reminders follow LAX time; a later edit from a California device changes nothing', async () => {
    let row = await create({ timeZone: 'America/New_York',
      pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneSource: 'place',
      returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/Los_Angeles', returnTimeZoneSource: 'place' });
    expect([row.pickupDateTimeUtc, row.returnDateTimeUtc]).toEqual(['2026-10-05T21:00:00.000Z', '2026-10-08T17:00:00.000Z']);
    expect(await fires(row, 'pickup2', '2026-10-05T15:30:00Z')).toBe(false);  // 2h before 14:00 ET-misread = too early
    expect(await fires(row, 'pickup2', '2026-10-05T19:30:00Z')).toBe(true);
    table.set(row.id as string, row);
    const { updateRentalSession } = await lib();
    row = (await updateRentalSession('u', row.id as string, { notes: 'at the counter', timeZone: 'America/Los_Angeles',
      pickupDateTime: '2026-10-05T14:00', returnDateTime: '2026-10-08T10:00' })) as unknown as Row;
    expect([row.pickupDateTimeUtc, row.returnDateTimeUtc]).toEqual(['2026-10-05T21:00:00.000Z', '2026-10-08T17:00:00.000Z']);
    expect(row.timeZone).toBe('America/New_York');
  });
});

describe('MANDATORY one-way: LAX pickup / JFK return', () => {
  it('pickup and return each fire from their own zone; the return reminder can only fire BEFORE the due instant', async () => {
    const row = await create({
      pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/Los_Angeles', pickupTimeZoneSource: 'place',
      returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/New_York',   returnTimeZoneSource: 'place' });
    expect(row.pickupDateTimeUtc).toBe('2026-10-05T21:00:00.000Z');
    expect(row.returnDateTimeUtc).toBe('2026-10-08T14:00:00.000Z');
    expect(await fires(row, 'pickup2', '2026-10-05T19:30:00Z')).toBe(true);

    const due = Date.parse('2026-10-08T14:00:00Z');
    const firing: number[] = [];
    for (let t = Date.parse('2026-10-08T06:00:00Z'); t <= Date.parse('2026-10-08T18:00:00Z'); t += 15 * 60_000) {
      if (await fires(row, 'return2', new Date(t).toISOString())) firing.push(t);
    }
    expect(firing.length).toBeGreaterThan(0);
    expect(Math.max(...firing)).toBeLessThanOrEqual(due);       // never after the car is due
    expect(Math.min(...firing)).toBeGreaterThanOrEqual(due - 3 * 3_600_000);
  });
});

describe('DST fall-back: the explicitly chosen occurrence drives the reminder', () => {
  it('LATER 1:30 AM (EST, 06:30Z) vs EARLIER (EDT, 05:30Z) fire at different instants', async () => {
    const later = await create({ returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place', returnTimeDisambiguation: 'later' });
    const earlier = await create({ returnDateTime: '2026-11-01T01:30', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place', returnTimeDisambiguation: 'earlier' });
    expect([later.returnDateTimeUtc, earlier.returnDateTimeUtc]).toEqual(['2026-11-01T06:30:00.000Z', '2026-11-01T05:30:00.000Z']);
    expect(await fires(later, 'return2', '2026-11-01T06:00:00Z')).toBe(true);
    expect(await fires(earlier, 'return2', '2026-11-01T06:00:00Z')).toBe(false);   // already due
  });
});

describe('legacy rows (no event zones, legacy timeZone only, no UTC)', () => {
  const legacy: Row = { status: 'active', timeZone: 'America/New_York', pickupTimeZone: null, returnTimeZone: null,
    pickupDateTime: '2026-10-05T14:00', pickupDateTimeUtc: null, returnDateTime: '2026-10-08T10:00', returnDateTimeUtc: null,
    pickupReminder24SentAt: null, pickupReminder2SentAt: null, reminderSentAt: null, returnReminder2SentAt: null };
  it('still get the broad 24h pickup + broad return reminders via the naive fallback', async () => {
    expect(await fires(legacy, 'pickup24', '2026-10-04T16:00:00Z')).toBe(true);
    expect(await fires(legacy, 'returnDue', '2026-10-07T12:00:00Z')).toBe(true);
  });
  it('never get the precision 2h tiers (no reliable instant)', async () => {
    for (const iso of ['2026-10-05T11:30:00Z', '2026-10-05T13:00:00Z', '2026-10-05T16:30:00Z']) {
      expect(await fires(legacy, 'pickup2', iso)).toBe(false);
    }
    expect(await fires(legacy, 'return2', '2026-10-08T12:30:00Z')).toBe(false);
  });
});

describe('edit safety at the cron level', () => {
  it('an unrelated edit after a reminder was sent does not make the tier fire again', async () => {
    const row = await create({ returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place' });
    row.returnReminder2SentAt = '2026-10-08T12:05:00.000Z';
    table.set(row.id as string, row);
    const { updateRentalSession } = await lib();
    const after = (await updateRentalSession('u', row.id as string, { notes: 'returned early?', returnDateTime: '2026-10-08T10:00' })) as unknown as Row;
    expect(after.returnReminder2SentAt).toBe('2026-10-08T12:05:00.000Z');
    expect(await fires(after, 'return2', '2026-10-08T13:00:00Z')).toBe(false);
  });
  it('changing the return time DOES re-arm only the return tier', async () => {
    const row = await create({ pickupDateTime: '2026-10-05T14:00', pickupTimeZone: 'America/New_York', pickupTimeZoneSource: 'place',
                               returnDateTime: '2026-10-08T10:00', returnTimeZone: 'America/New_York', returnTimeZoneSource: 'place' });
    Object.assign(row, { pickupReminder2SentAt: 'sent', returnReminder2SentAt: 'sent' });
    table.set(row.id as string, row);
    const { updateRentalSession } = await lib();
    const after = (await updateRentalSession('u', row.id as string, { returnDateTime: '2026-10-08T16:00' })) as unknown as Row;
    expect(after.pickupReminder2SentAt).toBe('sent');
    expect(after.returnReminder2SentAt).toBeNull();
    expect(await fires(after, 'return2', '2026-10-08T18:30:00Z')).toBe(true);   // 16:00 EDT = 20:00Z
  });
});
