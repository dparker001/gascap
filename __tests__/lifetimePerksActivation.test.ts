/**
 * Stripe Payment Authorization Hardening — Lifetime Perks Activation
 * Correction. Regression coverage for app/api/stripe/webhook/route.ts's
 * invoice.payment_succeeded handler.
 *
 * The hardened checkout.session.completed Perks branch deliberately never
 * calls setUserPlan() or setLifetimePerksActive() — activation is owned
 * entirely by invoice.payment_succeeded. That handler previously resolved
 * the GasCap user via findByStripeCustomer(customerId) BEFORE inspecting
 * the subscription at all — which meant a genuine Lifetime owner whose
 * original purchase went through a guest Checkout Session (stripeCustomerId
 * still null) could never have their first Lifetime Perks subscription
 * activated: the brand-new Stripe Customer created for that subscription
 * would never resolve through the old customer-first lookup.
 *
 * This file proves: (1) the existing-customer path still works exactly as
 * before, (2) the null-stripeCustomerId / new-Customer path now activates
 * correctly by resolving identity from the subscription's own trusted
 * metadata.userId, safely binding the Customer ID with no other field
 * touched, (3) activation is independent of event order, (4)/(5) Customer
 * ID / metadata identity mismatches never activate and never overwrite,
 * (6) missing metadata.userId never activates, (7) a subscription-retrieve
 * failure fails closed rather than falling through to generic renewal
 * logic, and (8)/(9)/(10) line-item shape verification (Price, metadata,
 * item count, quantity) matches the same rigor already applied to
 * checkout.session.completed.
 *
 * No real Stripe call is made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const constructEvent = vi.fn((..._args: unknown[]) => ({}) as unknown);
const subscriptionsRetrieve = vi.fn(async (..._a: unknown[]) => ({
  items: { data: [{ price: { id: 'price_perks_test' }, quantity: 1 }] },
  metadata: { userId: 'user-1', tier: 'pro', billing: 'lifetime-perks' },
}) as unknown);
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...(a as [])) },
    subscriptions: {
      cancel: vi.fn(async () => ({})),
      retrieve: (...a: unknown[]) => subscriptionsRetrieve(...(a as [])),
    },
    checkout: { sessions: { listLineItems: vi.fn(async () => ({ data: [] })) } },
  },
  PRICES: {
    proMonthly:    'price_pro_monthly_test',
    proLifetime:   'price_pro_lifetime_test',
    lifetimePerks: 'price_perks_test',
  },
}));

const setUserPlan = vi.fn(async (..._args: unknown[]) => ({}));
const findByStripeCustomer = vi.fn(async () => null as unknown);
const findById = vi.fn(async () => null as unknown);
const bindStripeCustomerIdIfMissing = vi.fn(async () => ({ bound: true }));
const findByReferralCode = vi.fn(async () => null as unknown);
const creditVerifiedReferral = vi.fn(async () => false);
const getActiveCredits = vi.fn(() => []);
const enrollPaidCampaign = vi.fn(async () => {});
const enrollEngagementCampaign = vi.fn(async () => {});
const setEarlyUpgradeBonus = vi.fn(async () => {});
const markMilestoneSent = vi.fn(async () => {});
const updateUserProfile = vi.fn(async () => {});
const clearStripeSubscriptionId = vi.fn(async () => {});
const setLifetimePerksActive = vi.fn(async () => {});
const clearLifetimePerks = vi.fn(async () => {});
const markFoundingMember = vi.fn(async () => {});
const revokeStripeSubscriptionEntitlement = vi.fn(async () => ({ pro: false, sources: [] }));

vi.mock('@/lib/users', () => ({
  setUserPlan: (...a: unknown[]) => setUserPlan(...(a as [])),
  findByStripeCustomer: (...a: unknown[]) => findByStripeCustomer(...(a as [])),
  findById: (...a: unknown[]) => findById(...(a as [])),
  bindStripeCustomerIdIfMissing: (...a: unknown[]) => bindStripeCustomerIdIfMissing(...(a as [])),
  findByReferralCode: (...a: unknown[]) => findByReferralCode(...(a as [])),
  creditVerifiedReferral: (...a: unknown[]) => creditVerifiedReferral(...(a as [])),
  getActiveCredits: (...a: unknown[]) => getActiveCredits(...(a as [])),
  enrollPaidCampaign: (...a: unknown[]) => enrollPaidCampaign(...(a as [])),
  enrollEngagementCampaign: (...a: unknown[]) => enrollEngagementCampaign(...(a as [])),
  setEarlyUpgradeBonus: (...a: unknown[]) => setEarlyUpgradeBonus(...(a as [])),
  markMilestoneSent: (...a: unknown[]) => markMilestoneSent(...(a as [])),
  updateUserProfile: (...a: unknown[]) => updateUserProfile(...(a as [])),
  clearStripeSubscriptionId: (...a: unknown[]) => clearStripeSubscriptionId(...(a as [])),
  setLifetimePerksActive: (...a: unknown[]) => setLifetimePerksActive(...(a as [])),
  clearLifetimePerks: (...a: unknown[]) => clearLifetimePerks(...(a as [])),
  markFoundingMember: (...a: unknown[]) => markFoundingMember(...(a as [])),
  revokeStripeSubscriptionEntitlement: (...a: unknown[]) => revokeStripeSubscriptionEntitlement(...(a as [])),
}));

const updateGhlContactPlan = vi.fn(async () => true);
vi.mock('@/lib/ghl', () => ({ updateGhlContactPlan: (...a: unknown[]) => updateGhlContactPlan(...(a as [])) }));

const recordAnalyticsEvent = vi.fn(async (..._args: unknown[]) => ({ outcome: 'written' as const, id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));

vi.mock('@/lib/email', () => ({
  sendMail: vi.fn(async () => {}),
  giftEmailHtml: vi.fn(() => '<html></html>'),
}));
vi.mock('@/lib/gifts', () => ({ createGift: vi.fn(async () => ({ code: 'GIFT-1', occasion: 'gift', recipientName: null })) }));
vi.mock('@/lib/getawayPromo', () => ({
  getawayPromoActive: vi.fn(() => false),
  GETAWAY_DISCLOSURE: { full: [], short: '' },
}));
vi.mock('@/lib/emailCampaign', () => ({ sendReferralCreditEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailCampaignPaid', () => ({ sendPaidCampaignEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailEngagement', () => ({ sendMilestoneEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/userPush', () => ({ sendUserPush: vi.fn(async () => {}) }));

// ── Helpers ──────────────────────────────────────────────────────────────

const LIFETIME_USER = {
  id: 'user-1', email: 'buyer@example.com', name: 'Test Buyer', plan: 'pro',
  stripeInterval: 'lifetime', stripeCustomerId: undefined as string | undefined,
  isProTrial: false, paidCampaignEnrolledAt: '2026-01-01', engagementEnrolledAt: '2026-01-01',
  referredBy: null, referralRewardCredited: false, isTestAccount: false, stripeSubscriptionId: null,
};

function makeInvoice(customerId: string | null, subId: string | undefined) {
  return {
    customer: customerId,
    subscription: subId,
    amount_paid: 999,
  };
}

function makeEvent(eventId: string, invoice: unknown) {
  return { id: eventId, type: 'invoice.payment_succeeded', data: { object: invoice } };
}

function makeSub(overrides: Partial<{
  priceId: string | null; quantity: number; itemCount: number;
  userId: string | null; tier: string | null; billing: string | null;
}> = {}) {
  const priceId   = overrides.priceId   === undefined ? 'price_perks_test' : overrides.priceId;
  const quantity  = overrides.quantity  ?? 1;
  const itemCount = overrides.itemCount ?? 1;
  const items = Array.from({ length: itemCount }, (_, i) => ({
    price: priceId ? { id: i === 0 ? priceId : 'price_second_item_test' } : null,
    quantity,
  }));
  return {
    items: { data: items },
    metadata: {
      ...(overrides.userId  !== undefined ? (overrides.userId  === null ? {} : { userId:  overrides.userId  }) : { userId: 'user-1' }),
      ...(overrides.tier    !== undefined ? (overrides.tier    === null ? {} : { tier:    overrides.tier    }) : { tier: 'pro' }),
      ...(overrides.billing !== undefined ? (overrides.billing === null ? {} : { billing: overrides.billing }) : { billing: 'lifetime-perks' }),
    },
  };
}

async function postWebhook(eventId: string, invoice: unknown) {
  constructEvent.mockReturnValueOnce(makeEvent(eventId, invoice));
  const { POST } = await import('@/app/api/stripe/webhook/route');
  const req = new Request('https://www.gascap.app/api/stripe/webhook', {
    method: 'POST',
    headers: new Headers({ 'stripe-signature': 'test-sig' }),
    body: 'raw-body-placeholder',
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  subscriptionsRetrieve.mockResolvedValue(makeSub());
  findById.mockResolvedValue({ ...LIFETIME_USER });
  findByStripeCustomer.mockResolvedValue(undefined);
  bindStripeCustomerIdIfMissing.mockResolvedValue({ bound: true });
});

describe('Stripe webhook — invoice.payment_succeeded Lifetime Perks activation', () => {
  it('LP-I1. Existing Customer — activates once, no setUserPlan, no stripeInterval mutation', async () => {
    findByStripeCustomer.mockResolvedValueOnce({ ...LIFETIME_USER, stripeCustomerId: 'cus_existing' });
    findById.mockResolvedValueOnce({ ...LIFETIME_USER, stripeCustomerId: 'cus_existing' });

    const res = await postWebhook('evt_lp1', makeInvoice('cus_existing', 'sub_perks_1'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).toHaveBeenCalledTimes(1);
    expect(setLifetimePerksActive).toHaveBeenCalledWith('user-1', 'sub_perks_1');
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(bindStripeCustomerIdIfMissing).not.toHaveBeenCalled();
  });

  it('LP-I2. Lifetime guest buyer / new Customer — resolves via subscription metadata, binds Customer ID, activates, no generic entitlement mutation', async () => {
    findByStripeCustomer.mockResolvedValueOnce(undefined);
    findById.mockResolvedValueOnce({ ...LIFETIME_USER, stripeCustomerId: undefined });

    const res = await postWebhook('evt_lp2', makeInvoice('cus_new', 'sub_perks_2'));

    expect(res.status).toBe(200);
    expect(bindStripeCustomerIdIfMissing).toHaveBeenCalledWith('user-1', 'cus_new');
    expect(setLifetimePerksActive).toHaveBeenCalledTimes(1);
    expect(setLifetimePerksActive).toHaveBeenCalledWith('user-1', 'sub_perks_2');
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('LP-I3. Event-order independence — activates for the null-stripeCustomerId user with NO prior checkout.session.completed dependency', async () => {
    // This test never invokes checkout.session.completed at all — the
    // invoice handler is the only thing exercised, proving it does not
    // implicitly depend on state that only that other handler would set.
    findByStripeCustomer.mockResolvedValueOnce(undefined);
    findById.mockResolvedValueOnce({ ...LIFETIME_USER, stripeCustomerId: undefined });

    const res = await postWebhook('evt_lp3', makeInvoice('cus_new_2', 'sub_perks_3'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).toHaveBeenCalledTimes(1);
  });

  it('LP-I4. Customer/user mismatch — stored user has a DIFFERENT stripeCustomerId — no overwrite, no activation', async () => {
    findByStripeCustomer.mockResolvedValueOnce(undefined);
    findById.mockResolvedValueOnce({ ...LIFETIME_USER, stripeCustomerId: 'cus_other' });

    const res = await postWebhook('evt_lp4', makeInvoice('cus_new', 'sub_perks_4'));

    expect(res.status).toBe(200);
    expect(bindStripeCustomerIdIfMissing).not.toHaveBeenCalled();
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });

  it('LP-I5. Customer mapping / metadata disagree — findByStripeCustomer resolves a DIFFERENT user than metadata.userId — no activation for either, no identity guessing', async () => {
    findByStripeCustomer.mockResolvedValueOnce({ ...LIFETIME_USER, id: 'user-A', stripeCustomerId: 'cus_existing' });
    findById.mockResolvedValueOnce({ ...LIFETIME_USER, id: 'user-1', stripeCustomerId: undefined }); // metadata.userId='user-1'

    const res = await postWebhook('evt_lp5', makeInvoice('cus_existing', 'sub_perks_5'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
    expect(bindStripeCustomerIdIfMissing).not.toHaveBeenCalled();
  });

  it('LP-I6. Missing metadata.userId — no activation, no email fallback', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce(makeSub({ userId: null }));

    const res = await postWebhook('evt_lp6', makeInvoice('cus_x', 'sub_perks_6'));

    expect(res.status).toBe(200);
    expect(findById).not.toHaveBeenCalled();
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });

  it('LP-I6b. metadata.userId present but does not resolve to any GasCap user — no activation', async () => {
    findById.mockResolvedValueOnce(undefined);

    const res = await postWebhook('evt_lp6b', makeInvoice('cus_x', 'sub_perks_6b'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });

  it('LP-I7. Subscription lookup failure — retryable fail-closed, no Perks activation, no accidental generic renewal', async () => {
    subscriptionsRetrieve.mockRejectedValueOnce(new Error('Stripe API unavailable'));

    const res = await postWebhook('evt_lp7', makeInvoice('cus_x', 'sub_fail'));

    expect(res.status).not.toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(creditVerifiedReferral).not.toHaveBeenCalled();
  });

  it('LP-I8. Wrong Perks metadata (canonical Price, tier/billing do not match) — no activation', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce(makeSub({ billing: 'monthly' }));

    const res = await postWebhook('evt_lp8', makeInvoice('cus_x', 'sub_perks_8'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });

  it('LP-I9. Multiple subscription items — no activation', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce(makeSub({ itemCount: 2 }));

    const res = await postWebhook('evt_lp9', makeInvoice('cus_x', 'sub_perks_9'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });

  it('LP-I10. Quantity != 1 — no activation', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce(makeSub({ quantity: 2 }));

    const res = await postWebhook('evt_lp10', makeInvoice('cus_x', 'sub_perks_10'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });

  it('Non-Perks invoice (standard renewal) is unaffected — resolves via findByStripeCustomer, no Perks path entered', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce({
      items: { data: [{ price: { id: 'price_pro_monthly_test' }, quantity: 1 }] },
      metadata: {},
    });
    findByStripeCustomer.mockResolvedValueOnce({ ...LIFETIME_USER, plan: 'pro', stripeCustomerId: 'cus_existing' });

    const res = await postWebhook('evt_renewal', makeInvoice('cus_existing', 'sub_monthly_1'));

    expect(res.status).toBe(200);
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
  });
});
