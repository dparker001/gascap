/**
 * lib/users.ts's reconcileRevenueCatState() — the single choke point for
 * EVERY server reconciliation path (on-demand sync via
 * app/api/user/sync-revenuecat, AND webhook reconciliation via
 * syncRevenueCatEntitlementFromProvider, used by CANCELLATION/
 * REFUND_REVERSED). The Lifetime cross-account ownership invariant must be
 * enforced HERE, not only in the HTTP route, so no current or future caller
 * can bypass it (2026-08-24 final blocker).
 *
 * Uses the same in-memory Prisma stand-in as __tests__/entitlementProvenance.test.ts
 * so these are real writes against lib/users.ts's actual write path, not a
 * mocked reconcile function — a regression here would actually persist a
 * fraudulent Lifetime grant.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row {
  id: string;
  plan: string;
  ambassadorProForLife: boolean;
  stripeInterval: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  revenueCatActive: boolean;
  revenueCatInterval: string | null;
  revenueCatProductId: string | null;
  isProTrial: boolean;
  trialExpiresAt: string | null;
  lifetimePurchasedAt: string | null;
  paidCampaignEnrolledAt: string | null;
  paidCampaignStep: number | null;
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'user-1', plan: 'free', ambassadorProForLife: false,
    stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
    revenueCatActive: false, revenueCatInterval: null, revenueCatProductId: null,
    isProTrial: false, trialExpiresAt: null, lifetimePurchasedAt: null,
    paidCampaignEnrolledAt: null, paidCampaignStep: null,
    ...overrides,
  };
}

function select<T extends Row>(row: T, fields?: Record<string, boolean>): Partial<T> {
  if (!fields) return row;
  const out: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) out[key] = row[key];
  return out;
}

const prismaMock = {
  user: {
    update: vi.fn(async ({ where, data, select: sel }: { where: { id: string }; data: Partial<Row>; select?: Record<string, boolean> }) => {
      const row = table.get(where.id);
      if (!row) throw new Error(`no such user ${where.id}`);
      Object.assign(row, data);
      return select(row, sel);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; lifetimePurchasedAt?: null }; data: Partial<Row> }) => {
      const row = table.get(where.id);
      if (!row) return { count: 0 };
      if ('lifetimePurchasedAt' in where && row.lifetimePurchasedAt !== null) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findUnique: vi.fn(async ({ where, select: sel }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = table.get(where.id);
      return row ? select(row, sel) : null;
    }),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
});

async function getUsersModule() {
  vi.resetModules();
  return import('@/lib/users');
}

function lifetimeState(originalCustomerId: string | null) {
  return {
    customerFound: true, active: true as const, interval: 'lifetime' as const,
    productId: 'gascap_pro_lifetime', customerId: 'user-1', originalCustomerId,
  };
}

function monthlyState(originalCustomerId: string | null = null) {
  return {
    customerFound: true, active: true as const, interval: 'monthly' as const,
    productId: 'gascap_pro_monthly', customerId: 'user-1', originalCustomerId,
  };
}

describe('reconcileRevenueCatState — Lifetime ownership invariant enforced at the choke point', () => {
  it('A. Lifetime + originalCustomerId === userId → ownership proven, writes and continues', async () => {
    table.set('user-1', makeRow());
    const { reconcileRevenueCatState } = await getUsersModule();

    const resolved = await reconcileRevenueCatState('user-1', lifetimeState('user-1'));
    expect(resolved.pro).toBe(true);
    // RC-only Lifetime is provenance-distinct from stripeInterval==='lifetime'
    // (see lib/entitlements.ts) — `permanent` stays false, but `effectiveInterval`
    // still correctly resolves to 'lifetime'.
    expect(resolved.effectiveInterval).toBe('lifetime');
    expect(table.get('user-1')!.plan).toBe('pro');
    expect(table.get('user-1')!.revenueCatActive).toBe(true);
    expect(table.get('user-1')!.revenueCatInterval).toBe('lifetime');
    expect(table.get('user-1')!.stripeInterval).toBeNull(); // never fabricated
  });

  it('B. Lifetime + originalCustomerId names a DIFFERENT user → throws CrossAccountLifetimeOwnershipError BEFORE any write', async () => {
    table.set('user-1', makeRow());
    const { reconcileRevenueCatState, CrossAccountLifetimeOwnershipError } = await getUsersModule();

    await expect(reconcileRevenueCatState('user-1', lifetimeState('a-different-gascap-user-id')))
      .rejects.toThrow(CrossAccountLifetimeOwnershipError);

    // No write occurred at all — row is exactly as it started.
    expect(table.get('user-1')).toEqual(makeRow());
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('C. Lifetime + originalCustomerId === null (unprovable) → throws UnverifiableLifetimeOwnershipError BEFORE any write, fails closed', async () => {
    table.set('user-1', makeRow());
    const { reconcileRevenueCatState, UnverifiableLifetimeOwnershipError } = await getUsersModule();

    await expect(reconcileRevenueCatState('user-1', lifetimeState(null)))
      .rejects.toThrow(UnverifiableLifetimeOwnershipError);

    expect(table.get('user-1')).toEqual(makeRow());
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('D. Monthly is unaffected by the Lifetime ownership check, including when originalCustomerId is null or mismatched', async () => {
    table.set('user-1', makeRow());
    const { reconcileRevenueCatState } = await getUsersModule();

    const resolved = await reconcileRevenueCatState('user-1', monthlyState(null));
    expect(resolved.pro).toBe(true);
    expect(table.get('user-1')!.revenueCatInterval).toBe('monthly');

    table.set('user-1', makeRow());
    const resolved2 = await reconcileRevenueCatState('user-1', monthlyState('someone-else'));
    expect(resolved2.pro).toBe(true);
    expect(table.get('user-1')!.revenueCatInterval).toBe('monthly');
  });

  it('E. syncRevenueCatEntitlementFromProvider() (the webhook-path entry point) inherits the same guard automatically', async () => {
    table.set('user-1', makeRow());
    vi.doMock('@/lib/revenueCatApi', () => ({
      fetchAuthoritativeRevenueCatState: vi.fn(async () => lifetimeState('a-different-gascap-user-id')),
    }));
    const { syncRevenueCatEntitlementFromProvider, CrossAccountLifetimeOwnershipError } = await getUsersModule();

    await expect(syncRevenueCatEntitlementFromProvider('user-1'))
      .rejects.toThrow(CrossAccountLifetimeOwnershipError);
    expect(table.get('user-1')).toEqual(makeRow());

    vi.doUnmock('@/lib/revenueCatApi');
  });
});
