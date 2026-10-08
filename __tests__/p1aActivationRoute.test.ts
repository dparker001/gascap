/**
 * Phase 1 P1-A — /api/admin/engagement-baseline now also returns `activation`.
 * Phase 0.5 fields must be unchanged, the endpoint stays admin-only and
 * read-only, kWh gig rows are never loaded, and an activation failure must
 * not take the baseline down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('@/lib/adminAuth', () => ({ requireAdmin }));

const T0 = Date.now() - 60 * 86_400_000;           // signed up 60 days ago → fully matured
const iso = (ms: number) => new Date(ms).toISOString();

const userFindMany = vi.fn();
const fillupFindMany = vi.fn();
const gigFindMany = vi.fn();
const prismaMock = {
  user: { findMany: userFindMany },
  fillup: {
    groupBy: vi.fn(async () => [{ userId: 'u1', _count: { _all: 2 }, _min: { createdAt: iso(T0 + 86_400_000) } }]),
    findMany: fillupFindMany,
  },
  gigFillup: { findMany: gigFindMany },
  favoriteStation: { groupBy: vi.fn(async () => []) },
  vehicle: { groupBy: vi.fn(async () => [{ userId: 'u1' }]) },
  analyticsEvent: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
  revenueCatWebhookEvent: { groupBy: vi.fn(async () => []) },
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
    id: 'u1', createdAt: iso(T0), activeDays: [], isProTrial: false, trialExpiresAt: null,
    ambassadorProForLife: false, stripeInterval: null, stripeSubscriptionId: null, revenueCatActive: false, revenueCatInterval: null,
  }]);
  fillupFindMany.mockResolvedValue([
    { userId: 'u1', createdAt: iso(T0 + 2 * 86_400_000), gallonsPumped: 10, pricePerGallon: 3.5, totalCost: 35, rentalSessionId: null },
    { userId: 'u1', createdAt: iso(T0 + 5 * 86_400_000), gallonsPumped: 8, pricePerGallon: 3.6, totalCost: 28.8, rentalSessionId: 'r1' },
  ]);
  gigFindMany.mockResolvedValue([]);
});

describe('GET /api/admin/engagement-baseline with activation', () => {
  it('stays admin-only and queries nothing for a non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await call();
    expect(res.status).toBe(403);
    expect(fillupFindMany).not.toHaveBeenCalled();
    expect(gigFindMany).not.toHaveBeenCalled();
  });

  it('adds `activation` and leaves every Phase 0.5 section in place', async () => {
    const body = await (await call()).json();
    for (const k of ['population', 'activity', 'retention', 'fuelActions', 'paywall', 'conversion', 'cancellation', 'funnel', 'definitions', 'dataQuality']) {
      expect(body[k], k).toBeDefined();
    }
    expect(body.fuelActions.usersWithSecondFillup).toBe(1);        // all-time historical, unchanged
    expect(body.activation.activated30d).toMatchObject({ users: 1, eligible: 1, rate: 100 });
    expect(body.activation.firstAction14d).toMatchObject({ users: 1, eligible: 1 });
    expect(body.activation.vehicleToFirstAction14d).toMatchObject({ users: 1, eligible: 1 });
  });

  it('loads only gallon-based gig rows (kWh never read) and is read-only', async () => {
    await call();
    expect(gigFindMany.mock.calls[0][0].where).toEqual({ energyUnit: 'gal' });
    expect(Object.keys(prismaMock.gigFillup)).toEqual(['findMany']);
    expect(Object.keys(prismaMock.fillup).sort()).toEqual(['findMany', 'groupBy']);
  });

  it('an activation failure returns activation:null and the baseline intact', async () => {
    fillupFindMany.mockRejectedValue(new Error('boom'));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activation).toBeNull();
    expect(body.population.signups).toBe(1);
  });
});
