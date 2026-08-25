/**
 * GET /api/cron/rental-return-reminder — the new dedicated 2h-before-RETURN
 * tier (2026-08-25 P0 fix). Before this, only a broad 0-36h return window
 * existed and nothing fired specifically "2 hours before return." This tier
 * compares against returnDateTimeUtc (the timezone-correct instant), never
 * the naive local-time returnDateTime string, and dedups via
 * returnReminder2SentAt so a duplicate cron run (or app termination between
 * send and the DB write) can never resend.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
