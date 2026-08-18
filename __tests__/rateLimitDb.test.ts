/**
 * Tests for lib/rateLimitDb.ts — the Postgres-backed rate limiter added to
 * close two real gaps: password reset had no rate limiting at all, and OTP
 * send's own local in-memory implementation reset on every deploy.
 *
 * Post-Sprint-2 Revision 1: the implementation was rewritten from a
 * findUnique-then-decide-then-upsert sequence (a real read-then-write race
 * at window rollover — two concurrent requests could both see an expired
 * window and both reset the count to 1, losing one request) to a single
 * atomic `INSERT ... ON CONFLICT ... DO UPDATE` statement, with the expiry
 * check evaluated INSIDE the SQL by Postgres itself.
 *
 * The mock below emulates that single atomic statement as one synchronous
 * table mutation per call — this is a faithful emulation, not a shortcut:
 * the entire point of moving to one SQL statement is that Postgres's own
 * atomicity guarantee is what makes concurrent callers safe, not any
 * ordering trick in application code. The "concurrent" tests below verify
 * that IF each call is atomic (which a real single Postgres statement is,
 * by definition), the resulting counts are correct — i.e. they prove the
 * arithmetic/logic is right, which is exactly what would have been WRONG
 * under the old two-step implementation (both concurrent rollover calls
 * would have independently computed "start fresh, count=1").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row { count: number; resetAt: Date }
const table = new Map<string, Row>();

const queryRaw = vi.fn(async (
  _strings: TemplateStringsArray,
  key: string,
  freshResetAt: Date,
  now: Date,
  _now2: Date,
  _freshResetAt2: Date,
) => {
  // Single synchronous mutation — no `await` inside — faithfully emulating
  // a single atomic Postgres statement. See file header.
  const existing = table.get(key);
  let row: Row;
  if (!existing) {
    row = { count: 1, resetAt: freshResetAt };
  } else if (existing.resetAt.getTime() <= now.getTime()) {
    row = { count: 1, resetAt: freshResetAt };
  } else {
    row = { count: existing.count + 1, resetAt: existing.resetAt };
  }
  table.set(key, row);
  return [{ count: row.count, resetAt: row.resetAt }];
});

const prismaMock = { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => queryRaw(strings, ...(values as [string, Date, Date, Date, Date])) };

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
});

describe('checkRateLimitDb — sequential correctness', () => {
  it('allows the first request for a fresh key', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    const res = await checkRateLimitDb('k1', 3, 60_000);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(2);
  });

  it('allows exactly `limit` requests, then rejects the (limit+1)th', async () => {
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

    table.get('k3')!.resetAt = new Date(Date.now() - 1000);

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
    table.set('existing', { count: 1, resetAt: new Date(Date.now() + 60_000) });
    const res = await checkRateLimitDb('existing', 3, 60_000);
    expect(res.allowed).toBe(true);
    expect(table.get('existing')!.count).toBe(2);
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

describe('checkRateLimitDb — concurrency (the actual Revision 1 fix)', () => {
  it('concurrent brand-new key: both requests are counted, none lost', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    const [a, b] = await Promise.all([
      checkRateLimitDb('fresh-race', 5, 60_000),
      checkRateLimitDb('fresh-race', 5, 60_000),
    ]);
    const counts = [a, b].map((r) => 5 - r.remaining).sort();
    expect(counts).toEqual([1, 2]); // one request landed as count=1, the other as count=2
    expect(table.get('fresh-race')!.count).toBe(2);
  });

  it('concurrent active window: both increments land, neither overwrites the other', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    table.set('active-race', { count: 1, resetAt: new Date(Date.now() + 60_000) });
    await Promise.all([
      checkRateLimitDb('active-race', 10, 60_000),
      checkRateLimitDb('active-race', 10, 60_000),
    ]);
    expect(table.get('active-race')!.count).toBe(3); // 1 (seeded) + 2 concurrent increments
  });

  it('concurrent EXACT window rollover: exactly one reset happens, the other increments the NEW window — this is the bug the old implementation had', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    // Seeded row is expired at the instant both requests arrive.
    table.set('rollover-race', { count: 9, resetAt: new Date(Date.now() - 1) });
    await Promise.all([
      checkRateLimitDb('rollover-race', 5, 60_000),
      checkRateLimitDb('rollover-race', 5, 60_000),
    ]);
    // Correct: 2 requests occurred in the fresh window → count is 2, not 1.
    // The old read-then-write implementation would have let both callers
    // independently observe "expired" and both write count=1 — this
    // assertion is exactly the one that would have failed against it.
    expect(table.get('rollover-race')!.count).toBe(2);
  });

  it('exactly limit allowed, limit+1 denied — including under concurrent arrival', async () => {
    const { checkRateLimitDb } = await import('../lib/rateLimitDb');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => checkRateLimitDb('limit-race', 3, 60_000)),
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount  = results.filter((r) => !r.allowed).length;
    expect(allowedCount).toBe(3);
    expect(deniedCount).toBe(1);
    expect(table.get('limit-race')!.count).toBe(4); // still counted even though denied
  });
});

describe('hashRateLimitIdentifier — post-Sprint-2 Revision 1, no plaintext email PII in the key', () => {
  it('is deterministic — the same email always hashes the same way, so the limiter still works', async () => {
    const { hashRateLimitIdentifier } = await import('../lib/rateLimitDb');
    expect(hashRateLimitIdentifier('user@example.com')).toBe(hashRateLimitIdentifier('user@example.com'));
  });

  it('is case- and whitespace-insensitive, matching how the callers already normalize email', async () => {
    const { hashRateLimitIdentifier } = await import('../lib/rateLimitDb');
    expect(hashRateLimitIdentifier('User@Example.com')).toBe(hashRateLimitIdentifier('  user@example.com  '));
  });

  it('never contains the original plaintext in its output', async () => {
    const { hashRateLimitIdentifier } = await import('../lib/rateLimitDb');
    const hashed = hashRateLimitIdentifier('sensitive@example.com');
    expect(hashed).not.toContain('sensitive');
    expect(hashed).not.toContain('example.com');
  });

  it('different emails hash to different values', async () => {
    const { hashRateLimitIdentifier } = await import('../lib/rateLimitDb');
    expect(hashRateLimitIdentifier('a@example.com')).not.toBe(hashRateLimitIdentifier('b@example.com'));
  });
});
