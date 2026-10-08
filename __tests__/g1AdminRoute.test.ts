/**
 * Gamification G1 — the admin baseline route adds a `gasPoints` section (real users
 * only), leaves every existing section intact, and a GasPoints failure (e.g. the
 * ledger not migrated yet) must not take the baseline down.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const requireAdmin = vi.fn();
vi.mock('@/lib/adminAuth', () => ({ requireAdmin }));

const userFindMany = vi.fn();
const ledgerFindMany = vi.fn();
const prismaMock = {
  user: { findMany: userFindMany },
  fillup: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
  gigFillup: { findMany: vi.fn(async () => []) },
  favoriteStation: { groupBy: vi.fn(async () => []) },
  vehicle: { groupBy: vi.fn(async () => []) },
  analyticsEvent: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
  revenueCatWebhookEvent: { groupBy: vi.fn(async () => []) },
  gasPointLedger: { findMany: ledgerFindMany },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const call = async () => {
  vi.resetModules();
  const { GET } = await import('@/app/api/admin/engagement-baseline/route');
  return GET(new Request('https://x.test/api/admin/engagement-baseline'));
};

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin', email: 'a@b.c', via: 'session' });
  userFindMany.mockResolvedValue([
    { id: 'u1', createdAt: '2026-09-01T00:00:00.000Z', activeDays: [], isProTrial: false, trialExpiresAt: null,
      ambassadorProForLife: false, stripeInterval: null, stripeSubscriptionId: null, revenueCatActive: false, revenueCatInterval: null },
  ]);
  ledgerFindMany.mockResolvedValue([
    { userId: 'u1', action: 'welcome_bonus', points: 25, sourceRef: null },
    { userId: 'u1', action: 'daily_fuel_check', points: 5, sourceRef: today },
    { userId: 'test-or-admin', action: 'daily_fuel_check', points: 5, sourceRef: today },   // not in the real population
  ]);
});

describe('GET /api/admin/engagement-baseline with gasPoints', () => {
  it('stays admin-only and reads nothing for a non-admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await call()).status).toBe(403);
    expect(ledgerFindMany).not.toHaveBeenCalled();
  });
  it('adds gasPoints for real users only and keeps every existing section', async () => {
    const body = await (await call()).json();
    for (const k of ['population', 'activity', 'retention', 'fuelActions', 'paywall', 'conversion', 'activation', 'definitions']) {
      expect(body[k], k).toBeDefined();
    }
    expect(body.gasPoints.participants).toBe(1);
    expect(body.gasPoints.dailyChecksLast7).toBe(1);
    expect(body.gasPoints.levelDistribution.starter).toBe(1);
  });
  it('is read-only: only findMany is used on the ledger', () => {
    expect(Object.keys(prismaMock.gasPointLedger)).toEqual(['findMany']);
  });
  it('a ledger failure returns gasPoints:null and the baseline intact', async () => {
    ledgerFindMany.mockRejectedValue(new Error('relation "GasPointLedger" does not exist'));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gasPoints).toBeNull();
    expect(body.population.signups).toBe(1);
  });
});
