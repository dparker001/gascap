/**
 * Post-Sprint-2 Revision 1 — retention cron for RateLimitCounter, closing
 * the unbounded-growth gap: without cleanup, every distinct key ever seen
 * (including attacker-varied identifiers used purely to grow the table)
 * leaves a permanent row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type DeleteManyArgs = { where: { resetAt: { lt: Date } } };
const deleteMany = vi.fn(async (_args: DeleteManyArgs) => ({ count: 0 }));
vi.mock('@/lib/prisma', () => ({ prisma: { rateLimitCounter: { deleteMany: (args: DeleteManyArgs) => deleteMany(args) } } }));

const SECRET = 'test-cron-secret';

async function get(secret?: string) {
  const { GET } = await import('@/app/api/cron/cleanup-rate-limits/route');
  const url = secret !== undefined ? `https://x/api/cron/cleanup-rate-limits?secret=${secret}` : 'https://x/api/cron/cleanup-rate-limits';
  return GET(new Request(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
  deleteMany.mockResolvedValue({ count: 0 });
});

describe('GET /api/cron/cleanup-rate-limits', () => {
  it('fails closed with no CRON_SECRET configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await get(SECRET);
    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const res = await get('wrong');
    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes rows whose window closed more than the retention window ago', async () => {
    deleteMany.mockResolvedValue({ count: 42 });
    const res = await get(SECRET);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, deleted: 42 });
    // Cutoff should be roughly 24h in the past, not "now" or "the future".
    const cutoff = deleteMany.mock.calls[0][0].where.resetAt.lt;
    const ageMs = Date.now() - cutoff.getTime();
    expect(ageMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('returns 500 rather than throwing if the delete fails', async () => {
    deleteMany.mockRejectedValueOnce(new Error('db unavailable'));
    const res = await get(SECRET);
    expect(res.status).toBe(500);
  });
});
