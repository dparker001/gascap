/**
 * Tests for lib/rateLimitDb.ts — the Postgres-backed rate limiter added to
 * close two real gaps: password reset had no rate limiting at all, and OTP
 * send's own local in-memory implementation reset on every deploy.
 *
 * Prisma is mocked with a small in-memory table that mimics the exact
 * semantics the module depends on (unique key, atomic-enough increment).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row { key: string; count: number; resetAt: string }
const table = new Map<string, Row>();

const prismaMock = {
  rateLimitCounter: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => table.get(where.key) ?? null),
    update: vi.fn(async ({ where, data }: { where: { key: string }; data: { count?: { increment: number } } }) => {
      const row = table.get(where.key);
      if (!row) throw new Error('not found');
      if (data.count?.increment) row.count += data.count.increment;
      return row;
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: Row; update: Partial<Row> }) => {
      // Real Prisma upsert updates an existing row rather than erroring — the
      // module's own comment about a lost race refers to a genuinely
      // concurrent INSERT arriving between this call's findUnique and its
      // upsert, which the dedicated race test below simulates directly by
      // pre-seeding the table, not via this mock throwing.
      const existing = table.get(where.key);
      const row = existing ? { ...existing, ...update } : { ...create };
      table.set(where.key, row);
      return row;
    }),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
});

describe('checkRateLimitDb', () => {
  it('allows the first request for a fresh key', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    const res = await checkRateLimitDb('k1', 3, 60_000);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(2);
  });

  it('allows exactly `limit` requests, then rejects', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    for (let i = 0; i < 3; i++) {
      const res = await checkRateLimitDb('k2', 3, 60_000);
      expect(res.allowed).toBe(true);
    }
    const res = await checkRateLimitDb('k2', 3, 60_000);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it('a fresh window starts once the previous one has expired', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    await checkRateLimitDb('k3', 1, 60_000);
    const blocked = await checkRateLimitDb('k3', 1, 60_000);
    expect(blocked.allowed).toBe(false);

    // Simulate the window having expired.
    const row = table.get('k3')!;
    row.resetAt = new Date(Date.now() - 1000).toISOString();

    const fresh = await checkRateLimitDb('k3', 1, 60_000);
    expect(fresh.allowed).toBe(true);
  });

  it('different keys never share a counter', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    for (let i = 0; i < 5; i++) await checkRateLimitDb('a', 5, 60_000);
    const b = await checkRateLimitDb('b', 5, 60_000);
    expect(b.allowed).toBe(true);
    expect(b.remaining).toBe(4);
  });

  it('an existing open window is incremented (not treated as a fresh start)', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    table.set('existing', { key: 'existing', count: 1, resetAt: new Date(Date.now() + 60_000).toISOString() });
    const res = await checkRateLimitDb('existing', 3, 60_000);
    expect(res.allowed).toBe(true);
    expect(table.get('existing')!.count).toBe(2);
  });

  it('recovers when upsert loses a genuine concurrent first-request race', async () => {
    // Simulates two requests for the SAME brand-new key arriving close
    // enough together that both pass findUnique (seeing nothing) before
    // either writes — the real unique-constraint conflict the module's
    // catch block exists for, distinct from the "existing row" case above.
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    prismaMock.rateLimitCounter.upsert.mockImplementationOnce(async () => {
      // The other request won: insert its row now, then report the conflict.
      table.set('race', { key: 'race', count: 1, resetAt: new Date(Date.now() + 60_000).toISOString() });
      throw new Error('unique constraint violation');
    });
    const res = await checkRateLimitDb('race', 3, 60_000);
    expect(res.allowed).toBe(true);
    expect(table.get('race')!.count).toBe(2); // this request's increment landed on the winner's row
  });

  it('reports a sensible resetInSeconds', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    const res = await checkRateLimitDb('k4', 3, 60_000);
    expect(res.resetInSeconds).toBeGreaterThan(0);
    expect(res.resetInSeconds).toBeLessThanOrEqual(60);
  });

  it('never leaks any secret/PII — the result contains only counters', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    const res = await checkRateLimitDb('user@example.com', 3, 60_000);
    expect(Object.keys(res).sort()).toEqual(['allowed', 'remaining', 'resetInSeconds']);
  });
});
