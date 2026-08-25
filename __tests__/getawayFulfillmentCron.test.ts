/**
 * GET /api/cron/getaway-fulfillment — the recurring job for the 72-hour
 * getaway verification hold. Exercises auth, the candidate query shape, and
 * that it delegates entirely to attemptGetawayFulfillment() (no fulfillment
 * logic duplicated here) — including staying idempotent across repeated
 * runs and never treating an ambiguous Marketing Boost result as a reason
 * to retry automatically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.CRON_SECRET = 'test-cron-secret';

interface Candidate { id: string; email: string; }
let candidates: Candidate[] = [];
const findMany = vi.fn(async (_args?: { where: Record<string, unknown> }) => candidates);
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findMany: (args?: { where: Record<string, unknown> }) => findMany(args) } } }));

type Outcome =
  | { outcome: 'sent'; destination: string }
  | { outcome: 'manual_required'; destination: string }
  | { outcome: 'ambiguous'; destination: string }
  | { outcome: 'not_ready'; reason: string };
const attemptGetawayFulfillment = vi.fn(async (_id: string): Promise<Outcome> => ({ outcome: 'sent', destination: 'atlanta' }));
vi.mock('@/lib/getawayFulfillment', () => ({
  attemptGetawayFulfillment: (id: string) => attemptGetawayFulfillment(id),
}));

async function get(secret?: string) {
  const { GET } = await import('@/app/api/cron/getaway-fulfillment/route');
  const url = secret !== undefined ? `https://www.gascap.app/api/cron/getaway-fulfillment?secret=${secret}` : 'https://www.gascap.app/api/cron/getaway-fulfillment';
  return GET(new Request(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  candidates = [];
  attemptGetawayFulfillment.mockResolvedValue({ outcome: 'sent', destination: 'atlanta' });
});

describe('GET /api/cron/getaway-fulfillment', () => {
  it('rejects a missing/wrong secret', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('wrong')).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries only pending, destination-chosen, non-revoked, hold-elapsed-or-null rows', async () => {
    await get('test-cron-secret');
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({
      getawayFulfillmentStatus: 'pending',
      getawayDestinationId: { not: null },
      getawayQualificationRevokedAt: null,
    });
    expect(args.where.OR).toEqual([
      { getawayHoldUntil: null },
      { getawayHoldUntil: { lte: expect.any(String) } },
    ]);
  });

  it('15. idempotent — a candidate already fulfilled by a prior run (attemptGetawayFulfillment returns not_ready/not_pending) is simply skipped, not re-sent', async () => {
    candidates = [{ id: 'u1', email: 'a@example.com' }];
    attemptGetawayFulfillment.mockResolvedValue({ outcome: 'not_ready', reason: 'not_pending' });
    const res = await get('test-cron-secret');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, sent: 0, skipped: 1 });
    expect(attemptGetawayFulfillment).toHaveBeenCalledTimes(1);
  });

  it('16. ambiguous Marketing Boost result is counted separately — never retried automatically within the same or a later run (no direct MB call happens here at all; it is fully owned by attemptGetawayFulfillment)', async () => {
    candidates = [{ id: 'u1', email: 'a@example.com' }];
    attemptGetawayFulfillment.mockResolvedValue({ outcome: 'ambiguous', destination: 'atlanta' });
    const res = await get('test-cron-secret');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, ambiguous: 1, sent: 0 });
    expect(attemptGetawayFulfillment).toHaveBeenCalledTimes(1); // exactly once — no in-cron retry loop
  });

  it('aggregates multiple candidates independently — one failure does not block another', async () => {
    candidates = [{ id: 'u1', email: 'a@example.com' }, { id: 'u2', email: 'b@example.com' }, { id: 'u3', email: 'c@example.com' }];
    attemptGetawayFulfillment
      .mockResolvedValueOnce({ outcome: 'sent', destination: 'atlanta' })
      .mockRejectedValueOnce(new Error('unexpected'))
      .mockResolvedValueOnce({ outcome: 'manual_required', destination: 'miami' });
    const res = await get('test-cron-secret');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, sent: 1, manualRequired: 1, errors: 1, candidates: 3 });
  });

  it('DB query failure returns 500 without throwing unhandled', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    const res = await get('test-cron-secret');
    expect(res.status).toBe(500);
  });
});
