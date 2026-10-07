/**
 * Phase 0.5A — /api/admin/engagement-baseline authorization + loader scope.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('@/lib/adminAuth', () => ({ requireAdmin }));

// Read-only Prisma mock: ONLY read methods exist, so any write would throw.
const userFindMany = vi.fn();
const prismaMock = {
  user: { findMany: userFindMany },
  fillup: { groupBy: vi.fn(async () => [{ userId: 'u1', _count: { _all: 2 }, _min: { createdAt: '2026-09-02T00:00:00.000Z' } }]) },
  favoriteStation: { groupBy: vi.fn(async () => [{ userId: 'u1' }]) },
  vehicle: { groupBy: vi.fn(async () => [{ userId: 'u1' }]) },
  analyticsEvent: {
    groupBy: vi.fn(async () => [
      { eventType: 'paywall_viewed', userId: 'u1', _count: { _all: 2 }, _min: { createdAt: new Date('2026-09-03T00:00:00Z') } },
      { eventType: 'paywall_viewed', userId: null, _count: { _all: 1 }, _min: { createdAt: new Date('2026-09-01T00:00:00Z') } },
    ]),
    findMany: vi.fn(async () => [{ userId: 'u1', createdAt: new Date('2026-09-10T00:00:00Z'), provider: 'stripe', billing: 'monthly' }]),
  },
  revenueCatWebhookEvent: { groupBy: vi.fn(async () => [{ eventType: 'CANCELLATION', _count: { _all: 3 } }]) },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const call = async () => {
  vi.resetModules();
  const { GET } = await import('@/app/api/admin/engagement-baseline/route');
  return GET(new Request('https://x.test/api/admin/engagement-baseline'));
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin', email: 'a@b.c', via: 'session' });
  userFindMany.mockResolvedValue([{
    id: 'u1', createdAt: '2026-09-01T00:00:00.000Z', activeDays: ['2026-09-01'], isProTrial: false, trialExpiresAt: null,
    ambassadorProForLife: false, stripeInterval: null, stripeSubscriptionId: 'sub', revenueCatActive: false, revenueCatInterval: null,
  }]);
});

describe('authorization (fails closed)', () => {
  for (const [status, label] of [[401, 'Unauthorized'], [403, 'Forbidden'], [503, 'Misconfigured']] as const) {
    it(`${status} -> ${label}, and NO data is queried`, async () => {
      requireAdmin.mockResolvedValue({ ok: false, status });
      const res = await call();
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(label);
      expect(userFindMany).not.toHaveBeenCalled();
      expect(prismaMock.analyticsEvent.groupBy).not.toHaveBeenCalled();
    });
  }
});

describe('loader scope & output', () => {
  it('excludes test accounts and admins from the population', async () => {
    await call();
    const arg = userFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ isTestAccount: false, role: { not: 'admin' } });
  });
  it('selects only the columns it needs (no password hash, email, tokens or PII)', async () => {
    await call();
    const select = Object.keys(userFindMany.mock.calls[0][0].select);
    for (const forbidden of ['passwordHash', 'email', 'name', 'phone', 'iosPushToken', 'stripeCustomerId']) {
      expect(select).not.toContain(forbidden);
    }
  });
  it('returns the computed report, uncached, with aggregate-only content', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.population.signups).toBe(1);
    expect(body.paywall.paywall_viewed).toMatchObject({ users: 1, total: 3 }); // anon row counted in total only
    expect(body.cancellation.revenueCat.CANCELLATION).toBe(3);
    expect(JSON.stringify(body)).not.toContain('u1'); // no per-user identifiers in the response
  });
  it('500 with a generic message if loading fails (no internals leaked)', async () => {
    userFindMany.mockRejectedValue(new Error('connection string postgres://secret'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('postgres://');
    spy.mockRestore();
  });
});
