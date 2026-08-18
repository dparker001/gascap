/**
 * Integration/transition tests for the entitlement-provenance corruption fix
 * (ChatGPT Sprint 2 Revision 1, P0 finding #1).
 *
 * Unlike __tests__/entitlements.test.ts (which tests the pure resolver in
 * isolation and never caught this), these tests exercise the REAL
 * lib/users.ts write paths — setUserPlan, revokeRevenueCatEntitlement,
 * revokeStripeSubscriptionEntitlement, revokeAmbassadorEntitlement — against
 * an in-memory Prisma stand-in, so an actual database-write regression (like
 * the original bug) would fail here even though the pure resolver was
 * correct all along.
 *
 * The bug: `stripeInterval` was being used for two incompatible purposes —
 * (a) genuine Stripe/gift Lifetime provenance and (b) the RevenueCat grant's
 * own interval / the resolver's aggregate effectiveInterval, both written
 * into the SAME column. That let an RC grant silently destroy a real
 * Stripe/gift Lifetime, and let an RC-only Lifetime survive its own refund
 * by having already manufactured a fake Stripe/gift Lifetime on revoke.
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
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'user-1', plan: 'pro', ambassadorProForLife: false,
    stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
    revenueCatActive: false, revenueCatInterval: null, revenueCatProductId: null,
    isProTrial: false, trialExpiresAt: null, lifetimePurchasedAt: null,
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

describe('entitlement provenance — integration', () => {
  it('1. Stripe Lifetime → RC Monthly grant → RC expiration => Lifetime remains', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime' }));
    const { setUserPlan, revokeRevenueCatEntitlement } = await getUsersModule();

    // RC monthly grant arrives on top of the existing Stripe Lifetime.
    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' } });
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime'); // NOT overwritten by RC

    // RC expires.
    const resolved = await revokeRevenueCatEntitlement('user-1');
    expect(resolved.pro).toBe(true);
    expect(table.get('user-1')!.plan).toBe('pro');
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime'); // survives intact
  });

  it('2. Gift Lifetime → RC Monthly → RC expiration => Lifetime remains', async () => {
    // Gifted lifetime is indistinguishable from a real Stripe lifetime in the
    // schema (both set stripeInterval='lifetime') — same assertion as case 1,
    // named separately per the review's explicit test list.
    table.set('user-1', makeRow({ stripeInterval: 'lifetime' }));
    const { setUserPlan, revokeRevenueCatEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' } });
    await revokeRevenueCatEntitlement('user-1');
    expect(table.get('user-1')!.plan).toBe('pro');
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime');
  });

  it('3. RC Lifetime only → RC refund => Free', async () => {
    table.set('user-1', makeRow({ stripeInterval: null }));
    const { setUserPlan, revokeRevenueCatEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' } });
    // Grant must NOT have fabricated a Stripe/gift Lifetime provenance.
    expect(table.get('user-1')!.stripeInterval).toBeNull();

    const resolved = await revokeRevenueCatEntitlement('user-1');
    expect(resolved.pro).toBe(false);
    expect(table.get('user-1')!.plan).toBe('free');
  });

  it('4. Stripe Monthly + RC Lifetime → Stripe deletion → RC refund => Free', async () => {
    table.set('user-1', makeRow({ stripeSubscriptionId: 'sub_1' }));
    const { setUserPlan, revokeStripeSubscriptionEntitlement, revokeRevenueCatEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' } });

    const afterStripeDelete = await revokeStripeSubscriptionEntitlement('user-1');
    expect(afterStripeDelete.pro).toBe(true); // RC lifetime still covers them
    expect(table.get('user-1')!.plan).toBe('pro');
    expect(table.get('user-1')!.stripeInterval).toBeNull(); // never fabricated

    const afterRcRefund = await revokeRevenueCatEntitlement('user-1');
    expect(afterRcRefund.pro).toBe(false);
    expect(table.get('user-1')!.plan).toBe('free');
  });

  it('5. Stripe Lifetime + RC Lifetime → RC refund => Stripe Lifetime remains', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime' }));
    const { setUserPlan, revokeRevenueCatEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' } });
    const resolved = await revokeRevenueCatEntitlement('user-1');
    expect(resolved.pro).toBe(true);
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime');
  });

  it('6. RC Monthly + Stripe cancellation => Pro via RC', async () => {
    table.set('user-1', makeRow({ stripeSubscriptionId: 'sub_1' }));
    const { setUserPlan, revokeStripeSubscriptionEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' } });
    const resolved = await revokeStripeSubscriptionEntitlement('user-1');
    expect(resolved.pro).toBe(true);
    expect(resolved.sources).toEqual(['revenuecat']);
    expect(table.get('user-1')!.plan).toBe('pro');
  });

  it('7. Ambassador + Stripe Monthly → Stripe cancellation → revoke Ambassador => Free if no other source', async () => {
    table.set('user-1', makeRow({ ambassadorProForLife: true, stripeSubscriptionId: 'sub_1' }));
    const { revokeStripeSubscriptionEntitlement, revokeAmbassadorEntitlement } = await getUsersModule();

    const afterStripeCancel = await revokeStripeSubscriptionEntitlement('user-1');
    expect(afterStripeCancel.pro).toBe(true); // Ambassador still covers them

    const afterAmbassadorRevoke = await revokeAmbassadorEntitlement('user-1');
    expect(afterAmbassadorRevoke.pro).toBe(false);
    expect(table.get('user-1')!.plan).toBe('free');
  });

  it('8. Multiple valid sources removed one at a time => only final removal downgrades', async () => {
    table.set('user-1', makeRow({ ambassadorProForLife: true, stripeSubscriptionId: 'sub_1' }));
    const { setUserPlan, revokeStripeSubscriptionEntitlement, revokeRevenueCatEntitlement, revokeAmbassadorEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' } });

    const r1 = await revokeStripeSubscriptionEntitlement('user-1');
    expect(r1.pro).toBe(true);
    expect(table.get('user-1')!.plan).toBe('pro');

    const r2 = await revokeRevenueCatEntitlement('user-1');
    expect(r2.pro).toBe(true); // Ambassador alone still qualifies
    expect(table.get('user-1')!.plan).toBe('pro');

    const r3 = await revokeAmbassadorEntitlement('user-1');
    expect(r3.pro).toBe(false); // nothing left
    expect(table.get('user-1')!.plan).toBe('free');
  });

  it('an RC grant never writes stripeInterval even when RC product is lifetime and no prior Stripe state exists', async () => {
    table.set('user-1', makeRow());
    const { setUserPlan } = await getUsersModule();
    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' } });
    expect(table.get('user-1')!.stripeInterval).toBeNull();
    expect(table.get('user-1')!.revenueCatInterval).toBe('lifetime');
    // Lifetime getaway-reminder marker is Stripe-only by design (native IAP
    // Lifetime purchases are explicitly excluded from that promo) — must NOT
    // be set by an RC grant.
    expect(table.get('user-1')!.lifetimePurchasedAt).toBeNull();
  });

  it('a genuine Stripe lifetime purchase still sets lifetimePurchasedAt and stripeInterval', async () => {
    table.set('user-1', makeRow());
    const { setUserPlan } = await getUsersModule();
    await setUserPlan('user-1', 'pro', { interval: 'lifetime' });
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime');
    expect(table.get('user-1')!.lifetimePurchasedAt).not.toBeNull();
  });

  it('an RC grant still ends an active trial (isRealPurchaseOrRenewal via revenueCat.active)', async () => {
    table.set('user-1', makeRow({ plan: 'free', isProTrial: true, trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }));
    const { setUserPlan } = await getUsersModule();
    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' } });
    expect(table.get('user-1')!.isProTrial).toBe(false);
    expect(table.get('user-1')!.trialExpiresAt).toBeNull();
  });
});
