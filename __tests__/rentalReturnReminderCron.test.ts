/**
 * GET /api/cron/rental-return-reminder — the new dedicated 2h-before-RETURN
 * tier (2026-08-25 P0 fix). Before this, only a broad 0-36h return window
 * existed and nothing fired specifically "2 hours before return." This tier
 * compares against returnDateTimeUtc (the timezone-correct instant), never
 * the naive local-time returnDateTime string, and dedups via
 * returnReminder2SentAt, so a row already stamped is excluded from the next
 * run. That prevents ordinary repeat sends; it is NOT an atomic claim across
 * overlapping executions (tracked separately).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

process.env.CRON_SECRET = 'test-cron-secret';

interface Session { id: string; user: { id: string; email: string; name: string | null; locale: string | null } }

let returnDue: Session[] = [];
let pickup24: Session[] = [];
let pickup2: Session[] = [];
let return2: Session[] = [];

const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
  // Route which fixture to return based on the distinguishing dedup column
  // in the where clause — mirrors how the real four-way Promise.all resolves.
  if ('returnReminder2SentAt' in args.where) return return2;
  if ('pickupReminder24SentAt' in args.where) return pickup24;
  if ('pickupReminder2SentAt' in args.where) return pickup2;
  return returnDue;
});
const update = vi.fn(async (_args?: unknown) => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: { rentalSession: { findMany: (a: { where: Record<string, unknown> }) => findMany(a), update: (args: unknown) => update(args) } } }));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/userPush', () => ({ sendUserPush: vi.fn(async () => {}) }));
vi.mock('@/lib/emailLog', () => ({ logEmail: vi.fn(async () => {}), logEmailError: vi.fn(async () => {}) }));

const USER = { id: 'user-1', email: 'renter@example.com', name: 'Renter', locale: 'en' };

async function get() {
  const { GET } = await import('@/app/api/cron/rental-return-reminder/route');
  return GET(new Request('https://www.gascap.app/api/cron/rental-return-reminder?secret=test-cron-secret'));
}

beforeEach(() => {
  vi.clearAllMocks();
  returnDue = []; pickup24 = []; pickup2 = []; return2 = [];
});

describe('GET /api/cron/rental-return-reminder — return2 tier', () => {
  it('1. queries the return2 tier against returnDateTimeUtc with its own returnReminder2SentAt dedup — not the naive returnDateTime string', async () => {
    await get();
    const return2Call = findMany.mock.calls.find((c) => 'returnReminder2SentAt' in c[0].where);
    expect(return2Call).toBeTruthy();
    const where = return2Call![0].where as Record<string, unknown>;
    expect(where.returnDateTimeUtc).toBeTruthy();
    expect(where.returnReminder2SentAt).toBeNull();
    expect(where).not.toHaveProperty('returnDateTime');
  });

  it('sends the return2 reminder and stamps returnReminder2SentAt (not reminderSentAt)', async () => {
    return2 = [{ id: 'rs-1', user: USER }];
    const res = await get();
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 'rs-1' }, data: { returnReminder2SentAt: expect.any(String) } });
  });

  it('6. a duplicate cron run does not resend — a session already excluded by returnReminder2SentAt != null never appears as a candidate', async () => {
    // Simulate: the query itself (mocked here) already filters out sent
    // records — the real DB enforces this via the where clause proven in
    // test 1. A second "run" against an empty candidate list confirms no
    // resend occurs when the record is no longer a candidate.
    return2 = [];
    const res = await get();
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('8. the return2 tier is independent of the broad return tier — both can run in the same pass without double-sending the SAME tier twice', async () => {
    returnDue = [{ id: 'rs-2', user: USER }];
    return2   = [{ id: 'rs-2', user: USER }]; // same session, legitimately eligible for both distinct tiers
    const res = await get();
    const json = await res.json();
    expect(json.sent).toBe(2); // one 'return' email, one 'return2' email — two distinct tiers, not a duplicate of one
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('DB query failure returns 500 without throwing unhandled', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'));
    const res = await get();
    expect(res.status).toBe(500);
  });

  it('rejects a missing/wrong secret', async () => {
    const { GET } = await import('@/app/api/cron/rental-return-reminder/route');
    const res = await GET(new Request('https://www.gascap.app/api/cron/rental-return-reminder?secret=wrong'));
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// ── 2026-10-02: pickup tiers + broad return tier on the UTC instant ──────────
// Tiny evaluator for the subset of Prisma `where` syntax these queries use, so
// the test checks what a real row would MATCH, not just the clause's shape.
type Row = Record<string, unknown>;
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
function whereFor(dedupKey: string) {
  const call = findMany.mock.calls.find((c) => dedupKey in c[0].where);
  expect(call).toBeTruthy();
  return call![0].where as Record<string, unknown>;
}

// An Orlando (ET, UTC-4 in October) rental picked up at 2:00 PM local.
const ET_RENTAL: Row = {
  status: 'active',
  pickupDateTime: '2026-10-05T14:00', pickupDateTimeUtc: '2026-10-05T18:00:00.000Z',
  returnDateTime: '2026-10-08T10:00', returnDateTimeUtc: '2026-10-08T14:00:00.000Z',
  pickupReminder24SentAt: null, pickupReminder2SentAt: null, reminderSentAt: null, returnReminder2SentAt: null,
};

describe('pickup reminder tiers use the timezone-correct instant', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('the "2h before pickup" tier does NOT fire 6.5h early for an ET renter', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T11:30:00Z')); // 7:30 AM ET
    await get();
    expect(matches(ET_RENTAL, whereFor('pickupReminder2SentAt'))).toBe(false);
  });

  it('the "2h before pickup" tier fires inside the real window (1.5h before, 12:30 PM ET)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T16:30:00Z'));
    await get();
    expect(matches(ET_RENTAL, whereFor('pickupReminder2SentAt'))).toBe(true);
  });

  it('the "24h before pickup" tier fires ~24h before the real instant, not 4h earlier', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T18:00:00Z')); // exactly 24h before pickup
    await get();
    expect(matches(ET_RENTAL, whereFor('pickupReminder24SentAt'))).toBe(true);
    findMany.mockClear();
    vi.setSystemTime(new Date('2026-10-04T12:30:00Z')); // 29.5h before — outside the 20–26h tier
    await get();
    expect(matches(ET_RENTAL, whereFor('pickupReminder24SentAt'))).toBe(false);
  });

  it('a null-UTC (legacy) row NEVER matches the precision 2h pickup tier — a naive fallback would send it hours early', async () => {
    const legacy = { ...ET_RENTAL, pickupDateTimeUtc: null };
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const now of ['2026-10-05T11:30:00Z', '2026-10-05T12:30:00Z', '2026-10-05T16:30:00Z']) {
      findMany.mockClear(); vi.setSystemTime(new Date(now));
      await get();
      const where = whereFor('pickupReminder2SentAt');
      expect(where).not.toHaveProperty('OR');
      expect(where).not.toHaveProperty('pickupDateTime');
      expect(matches(legacy, where)).toBe(false);
    }
  });

  it('a null-UTC (legacy) row still gets the broad 24h pickup reminder via the local-string fallback', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T16:00:00Z')); // naive "2026-10-05T14:00" is 22h after this instant → inside 20–26h
    await get();
    const legacy = { ...ET_RENTAL, pickupDateTimeUtc: null };
    expect(matches(legacy, whereFor('pickupReminder24SentAt'))).toBe(true);
  });

  it('return2 remains UTC-only (no OR / no naive fallback)', async () => {
    await get();
    const where = whereFor('returnReminder2SentAt');
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('returnDateTime');
    expect(matches({ ...ET_RENTAL, returnDateTimeUtc: null }, where)).toBe(false);
  });

  it('the broad return tier also windows on returnDateTimeUtc, with the same legacy fallback', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    await get();
    const where = whereFor('reminderSentAt');
    expect(where).not.toHaveProperty('returnDateTime');
    expect(matches(ET_RENTAL, where)).toBe(true);
    expect(matches({ ...ET_RENTAL, returnDateTimeUtc: null }, where)).toBe(true);
  });
});
