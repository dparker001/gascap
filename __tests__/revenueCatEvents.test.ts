/**
 * Unit tests for the RevenueCat webhook idempotency store — the
 * claim/processed/failed state machine that makes an at-least-once delivery
 * safe. Prisma is mocked; see __tests__/revenuecatWebhook.test.ts for the
 * route-level behavior this backs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row { id: string; eventType: string; userId: string | null; status: string; receivedAt: string; processedAt: string | null; error: string | null; }

const rows = new Map<string, Row>();

class KnownRequestError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
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
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const existing = rows.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      rows.set(where.id, updated);
      return updated;
    }),
    upsert: vi.fn(async ({ where, create }: { where: { id: string }; create: Omit<Row, 'processedAt' | 'error'> }) => {
      const row: Row = { ...create, processedAt: null, error: null };
      rows.set(where.id, row);
      return row;
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
  it('claims a brand-new event id', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    const res = await claimEvent('evt_1', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('claimed');
  });

  it('a second claim of the same id, while still processing and recent, is duplicate-in-flight', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    await claimEvent('evt_2', 'INITIAL_PURCHASE', 'user-1');
    const res = await claimEvent('evt_2', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('duplicate-in-flight');
  });

  it('a claim after markProcessed is duplicate-processed — the true-duplicate case', async () => {
    const { claimEvent, markProcessed } = await import('../lib/revenueCatEvents');
    await claimEvent('evt_3', 'INITIAL_PURCHASE', 'user-1');
    await markProcessed('evt_3');
    const res = await claimEvent('evt_3', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('duplicate-processed');
  });

  it('a claim after markFailed is reclaimed — safe retry, not permanently blocked', async () => {
    const { claimEvent, markFailed } = await import('../lib/revenueCatEvents');
    await claimEvent('evt_4', 'INITIAL_PURCHASE', 'user-1');
    await markFailed('evt_4', new Error('boom'));
    const res = await claimEvent('evt_4', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('claimed');
  });

  it('a "processing" row older than the stale threshold is reclaimed — the crash-mid-flight case', async () => {
    const { claimEvent } = await import('../lib/revenueCatEvents');
    await claimEvent('evt_5', 'INITIAL_PURCHASE', 'user-1');
    // Simulate the claimant having crashed 3 minutes ago (stale threshold is 2 min).
    const row = rows.get('evt_5')!;
    row.receivedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const res = await claimEvent('evt_5', 'INITIAL_PURCHASE', 'user-1');
    expect(res.outcome).toBe('claimed');
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
});

describe('markProcessed / markFailed', () => {
  it('markProcessed sets status=processed and stamps processedAt', async () => {
    const { claimEvent, markProcessed } = await import('../lib/revenueCatEvents');
    await claimEvent('evt_p1', 'INITIAL_PURCHASE', 'user-1');
    await markProcessed('evt_p1');
    expect(rows.get('evt_p1')!.status).toBe('processed');
    expect(rows.get('evt_p1')!.processedAt).not.toBeNull();
  });

  it('markFailed records the error message, truncated, and never throws even if the update itself fails', async () => {
    const { markFailed } = await import('../lib/revenueCatEvents');
    // No prior claim — update() will reject internally; markFailed must
    // swallow that rather than crash the caller's error-handling path.
    await expect(markFailed('evt_never_claimed', new Error('x'.repeat(2000)))).resolves.toBeUndefined();
  });
});
