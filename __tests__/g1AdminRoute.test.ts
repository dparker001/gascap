/**
 * Gamification G1 — the admin baseline route adds a `gasPoints` section (real users
 * only), leaves every existing section intact, and a GasPoints failure (e.g. the
 * ledger not migrated yet) must not take the baseline down.
 *
 * UTC/ET rollover fix (2026-10-12): this file's `today` fixture used to be
 * `new Date().toISOString().slice(0, 10)` — always UTC. The code under test
 * (lib/gasPointsMetrics.ts) deliberately keys its "last 7 days" window off
 * `gasCapDateKey()`, GasCap's America/New_York business-date convention (see
 * lib/gasCapCalendar.ts). Those two disagree every day during the ~8pm–
 * midnight ET window, when the UTC date has already rolled to tomorrow but
 * the ET date hasn't — exactly when CI runs late-evening Eastern. Fixed by
 * seeding the fixture with the same `gasCapDateKey()` helper the production
 * code uses, and added a dedicated rollover-window test with a pinned clock
 * so this can't silently regress.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gasCapDateKey } from '@/lib/gasCapCalendar';

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

const today = gasCapDateKey(new Date());

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

  describe('UTC/ET rollover window', () => {
    // 01:51 UTC on Oct 12 = 21:51 ET on Oct 11 (EDT, UTC-4) — the exact
    // instant a real CI run hit this bug: new Date().toISOString() reads
    // "2026-10-12" here, a full GasCap calendar day ahead of the ET date
    // gasCapDateKey() (and the production route) actually uses.
    const pinnedUtc = '2026-10-12T01:51:00.000Z';

    afterEach(() => {
      vi.useRealTimers();
    });

    it('counts a check logged under the correct ET date key, even when the UTC date has already rolled over', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(pinnedUtc));

      // Sanity-check the premise: UTC and GasCap (ET) dates genuinely
      // disagree at this instant — if they ever stop disagreeing (e.g. this
      // fixture instant drifts across a DST boundary), this assertion fails
      // loudly instead of the real one silently passing for the wrong reason.
      const utcDateAtPin = new Date(pinnedUtc).toISOString().slice(0, 10);
      const etDateAtPin  = gasCapDateKey(new Date(pinnedUtc));
      expect(etDateAtPin).not.toBe(utcDateAtPin);
      expect(etDateAtPin).toBe('2026-10-11');

      // Seed the ledger using the correct (ET) date key for "right now" —
      // exactly what the production ledger-write path does.
      ledgerFindMany.mockResolvedValue([
        { userId: 'u1', action: 'welcome_bonus', points: 25, sourceRef: null },
        { userId: 'u1', action: 'daily_fuel_check', points: 5, sourceRef: etDateAtPin },
      ]);

      const body = await (await call()).json();
      // Fails against the pre-fix fixture (which would have seeded
      // sourceRef: utcDateAtPin, one day outside the production code's
      // actual 7-day window at this instant) and passes with the fix.
      expect(body.gasPoints.dailyChecksLast7).toBe(1);
    });
  });
});
