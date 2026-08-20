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
  paidCampaignEnrolledAt: string | null;
  paidCampaignStep: number | null;
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'user-1', plan: 'pro', ambassadorProForLife: false,
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

describe('enrollPaidCampaign — provider-provenance fix (Growth Sprint 1, P0B)', () => {
  // The original bug lived HERE, not in setUserPlan/revokeRevenueCatEntitlement
  // above — enrollPaidCampaign unconditionally wrote `interval` into
  // stripeInterval, and was called from both the Stripe AND RevenueCat
  // webhooks with each provider's own interval. None of the tests above
  // would have caught this, because none of them call enrollPaidCampaign —
  // exactly why the bug survived despite this file's existing coverage.

  it('P1. Stripe Monthly paid flow still writes/retains Stripe Monthly provenance', async () => {
    table.set('user-1', makeRow({ stripeInterval: null }));
    const { enrollPaidCampaign } = await getUsersModule();
    await enrollPaidCampaign('user-1', 'monthly', { persistStripeProvenance: true });
    expect(table.get('user-1')!.stripeInterval).toBe('monthly');
    expect(table.get('user-1')!.paidCampaignStep).toBe(1);
    expect(table.get('user-1')!.paidCampaignEnrolledAt).not.toBeNull();
  });

  it('P2. Stripe Lifetime paid flow still writes/retains Stripe Lifetime provenance', async () => {
    table.set('user-1', makeRow({ stripeInterval: null }));
    const { enrollPaidCampaign } = await getUsersModule();
    await enrollPaidCampaign('user-1', 'lifetime', { persistStripeProvenance: true });
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime');
  });

  it('P3. RevenueCat Monthly first purchase does NOT create/change stripeInterval', async () => {
    table.set('user-1', makeRow({ stripeInterval: null }));
    const { enrollPaidCampaign } = await getUsersModule();
    await enrollPaidCampaign('user-1', 'monthly', { persistStripeProvenance: false });
    expect(table.get('user-1')!.stripeInterval).toBeNull();
    // Paid-campaign enrollment itself is unaffected by the provenance flag.
    expect(table.get('user-1')!.paidCampaignStep).toBe(1);
    expect(table.get('user-1')!.paidCampaignEnrolledAt).not.toBeNull();
  });

  it('P4. RevenueCat Lifetime first purchase does NOT create/change stripeInterval', async () => {
    table.set('user-1', makeRow({ stripeInterval: null }));
    const { enrollPaidCampaign } = await getUsersModule();
    await enrollPaidCampaign('user-1', 'lifetime', { persistStripeProvenance: false });
    expect(table.get('user-1')!.stripeInterval).toBeNull();
  });

  it('P5. If a RevenueCat buyer already has legitimate Stripe Lifetime provenance, RevenueCat paid-campaign enrollment does NOT overwrite or clear it', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime' }));
    const { enrollPaidCampaign } = await getUsersModule();
    // A RevenueCat monthly grant enrolling this same (already Stripe-Lifetime) user.
    await enrollPaidCampaign('user-1', 'monthly', { persistStripeProvenance: false });
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime'); // untouched, not overwritten with 'monthly' or cleared
  });

  it('P6. RevenueCat Lifetime followed by RevenueCat revocation cannot survive solely because RevenueCat polluted stripeInterval — this is the exact bug scenario', async () => {
    table.set('user-1', makeRow({ stripeInterval: null }));
    const { setUserPlan, enrollPaidCampaign, revokeRevenueCatEntitlement } = await getUsersModule();

    // Full realistic sequence: RC Lifetime grant (setUserPlan), then the
    // welcome-campaign enrollment that used to corrupt stripeInterval.
    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' } });
    await enrollPaidCampaign('user-1', 'lifetime', { persistStripeProvenance: false });
    expect(table.get('user-1')!.stripeInterval).toBeNull(); // the fix: never contaminated

    // RevenueCat later revokes/refunds. With the bug, stripeInterval='lifetime'
    // would have made this a permanent, unrevocable entitlement — resolved.pro
    // would incorrectly stay true forever. With the fix, no independent
    // entitlement source survives, so the user correctly downgrades.
    const resolved = await revokeRevenueCatEntitlement('user-1');
    expect(resolved.pro).toBe(false);
    expect(table.get('user-1')!.plan).toBe('free');
  });

  it('P6b. the same revocation, but a genuine independent Stripe Lifetime DOES survive — proves the fix does not over-correct into destroying real provenance', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime' })); // genuine prior Stripe purchase
    const { setUserPlan, enrollPaidCampaign, revokeRevenueCatEntitlement } = await getUsersModule();

    await setUserPlan('user-1', 'pro', { revenueCat: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' } });
    await enrollPaidCampaign('user-1', 'monthly', { persistStripeProvenance: false });
    expect(table.get('user-1')!.stripeInterval).toBe('lifetime'); // the real Stripe provenance, untouched

    const resolved = await revokeRevenueCatEntitlement('user-1');
    expect(resolved.pro).toBe(true); // genuinely still Pro via the real Stripe Lifetime
    expect(table.get('user-1')!.plan).toBe('pro');
  });
});
