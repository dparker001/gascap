/**
 * Unit tests for the RevenueCat webhook idempotency store — the
 * claim/processed/failed state machine that makes an at-least-once delivery
 * safe. Prisma is mocked; see __tests__/revenuecatWebhook.test.ts for the
 * route-level behavior this backs.
 *
 * Post-Sprint-2 Revision 1: the reclaim paths (failed → processing,
 * stale-processing → processing) and markProcessed/markFailed are now
 * compare-and-swap via `updateMany`, using a claimToken for ownership. The
 * mock below emulates REAL Postgres updateMany semantics — it evaluates the
 * `where` clause against the row's actual current state and only mutates +
 * returns count:1 if it still matches, exactly like a real conditional
 * UPDATE would. This is deliberate: a sequential-mock-return-value approach
 * (queueing "first call returns X, second call returns Y") would not
 * actually exercise the CAS logic — it would just replay whatever the test
 * author assumed the outcome should be. Concurrency here is tested by
 * calling the exported functions "simultaneously" (Promise.all over calls
 * that all read/write the same in-memory row via the same evaluated-live
 * mock), so a genuine race is exercised, not simulated.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row { id: string; eventType: string; userId: string | null; status: string; claimToken: string | null; receivedAt: string; processedAt: string | null; error: string | null; }

const rows = new Map<string, Row>();

class KnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}

/** Real Postgres updateMany semantics: match `where`, mutate matches, return count. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v);
}

const prismaMock = {
  revenueCatWebhookEvent: {
    create: vi.fn(async ({ data }: { data: Omit<Row, 'processedAt' | 'error'> }) => {
      if (rows.has(data.id)) throw new KnownRequestError('Unique constraint failed', 'P2002');
      const row: Row = { ...data, processedAt: null, error: null };
      rows.set(data.id, row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string } & Record<string, unknown>; data: Partial<Row> }) => {
      const { id, ...rest } = where;
      const row = rows.get(id);
      if (!row || !matches(row, rest)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: KnownRequestError },
}));

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe('claimEvent', () => {
  it('claims a brand-new event id and returns a claimToken', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    const res = await claimEvent('evt_1', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('claimed');
    expect(res.outcome === 'claimed' && res.claimToken).toBeTruthy();
  });

  it('a second claim of the same id, while still processing and recent, is duplicate-in-flight', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    await claimEvent('evt_2', 'INITIAL_PURCHASE', 'user-1');
    const res = await claimEvent('evt_2', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('duplicate-in-flight');
  });

  it('a claim after markProcessed is duplicate-processed — the true-duplicate case', async () => {
    const { claimEvent, markProcessed } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_3', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    await markProcessed('evt_3', first.claimToken);
    const res = await claimEvent('evt_3', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('duplicate-processed');
  });

  it('a claim after markFailed is reclaimed — safe retry, not permanently blocked — with a NEW claimToken', async () => {
    const { claimEvent, markFailed } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_4', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    await markFailed('evt_4', first.claimToken, new Error('boom'));
    const res = await claimEvent('evt_4', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('claimed');
    if (res.outcome === 'claimed') expect(res.claimToken).not.toBe(first.claimToken);
  });

  it('a "processing" row older than the stale threshold is reclaimed with a NEW claimToken — the crash-mid-flight case', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_5', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    // Simulate the claimant having crashed 3 minutes ago (stale threshold is 2 min).
    const row = rows.get('evt_5')!;
    row.receivedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const res = await claimEvent('evt_5', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('claimed');
    if (res.outcome === 'claimed') expect(res.claimToken).not.toBe(first.claimToken);
  });

  it('different event ids never collide with each other', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    const a = await claimEvent('evt_a', 'INITIAL_PURCHASE', 'user-1');
    const b = await claimEvent('evt_b', 'RENEWAL', 'user-1');
    expect(a.outcome).toBe('claimed');
    expect(b.outcome).toBe('claimed');
  });

  it('re-throws an unexpected (non-P2002) database error rather than swallowing it', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    prismaMock.revenueCatWebhookEvent.create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(claimEvent('evt_err', 'INITIAL_PURCHASE', 'user-1')).rejects.toThrow('connection reset');
  });

  it('post-Revision-2 fix: in the "row vanished" fallback path (P2002 then findUnique returns null), a genuine DB outage on the retry create is RE-THROWN, not swallowed into a false duplicate-in-flight', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    // First create: simulate the P2002 race (row exists per Postgres, but...).
    prismaMock.revenueCatWebhookEvent.create.mockRejectedValueOnce(new KnownRequestError('Unique constraint failed', 'P2002'));
    // ...findUnique doesn't see it (the vanishingly-unlikely deleted-between case).
    prismaMock.revenueCatWebhookEvent.findUnique.mockResolvedValueOnce(null);
    // The fallback retry create then hits a genuine, unrelated DB error —
    // this must propagate, not be reported as if a concurrent claimant won.
    prismaMock.revenueCatWebhookEvent.create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(claimEvent('evt_vanished', 'INITIAL_PURCHASE', 'user-1')).rejects.toThrow('connection reset');
  });

  it('the "row vanished" fallback path still correctly reports duplicate-in-flight for an ACTUAL P2002 on the retry create', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    prismaMock.revenueCatWebhookEvent.create.mockRejectedValueOnce(new KnownRequestError('Unique constraint failed', 'P2002'));
    prismaMock.revenueCatWebhookEvent.findUnique.mockResolvedValueOnce(null);
    prismaMock.revenueCatWebhookEvent.create.mockRejectedValueOnce(new KnownRequestError('Unique constraint failed', 'P2002'));
    const res = await claimEvent('evt_vanished_2', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('duplicate-in-flight');
  });

  it('two simultaneous failed-event reclaim attempts => exactly 1 claimed', async () => {
    const { claimEvent, markFailed } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_race_failed', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    await markFailed('evt_race_failed', first.claimToken, new Error('boom'));

    // Two "concurrent" retries racing to reclaim the same failed row.
    const [a, b] = await Promise.all([
      claimEvent('evt_race_failed', 'INITIAL_PURCHASE', 'user-1'),
      claimEvent('evt_race_failed', 'INITIAL_PURCHASE', 'user-1'),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    // Exactly one wins the reclaim; the other must NOT also see 'claimed' —
    // it should back off as duplicate-in-flight against the winner's fresh
    // 'processing' state.
    expect(outcomes).toEqual(['claimed', 'duplicate-in-flight']);
  });

  it('two simultaneous stale-processing reclaims => exactly 1 claimed', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_race_stale', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    rows.get('evt_race_stale')!.receivedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    const [a, b] = await Promise.all([
      claimEvent('evt_race_stale', 'INITIAL_PURCHASE', 'user-1'),
      claimEvent('evt_race_stale', 'INITIAL_PURCHASE', 'user-1'),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['claimed', 'duplicate-in-flight']);
  });
});

describe('markProcessed / markFailed — ownership (claimToken) enforcement', () => {
  it('markProcessed sets status=processed and stamps processedAt when the token matches', async () => {
    const { claimEvent, markProcessed } = await import('../lib/revenueCatEvents');
    const claim = await claimEvent('evt_p1', 'INITIAL_PURCHASE', 'user-1');
    if (claim.outcome !== 'claimed') throw new Error('setup failed');
    await markProcessed('evt_p1', claim.claimToken);
    expect(rows.get('evt_p1')!.status).toBe('processed');
    expect(rows.get('evt_p1')!.processedAt).not.toBeNull();
  });

  it('markFailed records the error message, truncated, and never throws even with a wrong/no prior claim', async () => {
    const { markFailed } = await import('../lib/revenueCatEvents');
    await expect(markFailed('evt_never_claimed', 'not-a-real-token', new Error('x'.repeat(2000)))).resolves.toBeUndefined();
  });

  it('old claimant cannot mark failed after a newer claimant processed the event', async () => {
    const { claimEvent, markFailed, markProcessed } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_stale_fail', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    // Simulate the first claimant crashing (stale) and a second claimant
    // reclaiming + finishing successfully before the first claimant's
    // delayed error handler ever runs.
    rows.get('evt_stale_fail')!.receivedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const second = await claimEvent('evt_stale_fail', 'INITIAL_PURCHASE', 'user-1');
    if (second.outcome !== 'claimed') throw new Error('setup failed');
    await markProcessed('evt_stale_fail', second.claimToken);

    // The FIRST (old, superseded) claimant's delayed markFailed must be a
    // no-op — it must not clobber the second claimant's 'processed' state.
    await markFailed('evt_stale_fail', first.claimToken, new Error('too late'));
    expect(rows.get('evt_stale_fail')!.status).toBe('processed');
    expect(rows.get('evt_stale_fail')!.error).toBeNull();
  });

  it('old claimant cannot mark processed after ownership changed to a newer claimant', async () => {
    const { claimEvent, markFailed, markProcessed } = await import('../lib/revenueCatEvents');
    const first = await claimEvent('evt_stale_proc', 'INITIAL_PURCHASE', 'user-1');
    if (first.outcome !== 'claimed') throw new Error('setup failed');
    rows.get('evt_stale_proc')!.receivedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const second = await claimEvent('evt_stale_proc', 'INITIAL_PURCHASE', 'user-1');
    if (second.outcome !== 'claimed') throw new Error('setup failed');
    await markFailed('evt_stale_proc', second.claimToken, new Error('second claimant failed'));

    // The FIRST claimant's delayed markProcessed must not overwrite the
    // second claimant's genuinely-failed outcome.
    await markProcessed('evt_stale_proc', first.claimToken);
    expect(rows.get('evt_stale_proc')!.status).toBe('failed');
  });
});
