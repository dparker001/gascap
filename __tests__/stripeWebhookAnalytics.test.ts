/**
 * Growth Sprint 1, P0B — regression coverage for the Stripe webhook's new
 * purchase_completed first-party analytics write, added in
 * app/api/stripe/webhook/route.ts's checkout.session.completed handler.
 *
 * This does NOT test entitlement logic (setUserPlan, GHL sync, emails,
 * referral credit, etc.) — those are pre-existing and unchanged. It tests
 * only: (1) the analytics classifier (which combinations of billing
 * metadata + payment_status produce a call, and with what exact fields),
 * (2) that gift/lifetime-perks/annual/unknown-billing/unpaid never produce
 * one, and (3) that an analytics failure never affects the rest of the
 * webhook's behavior.
 *
 * Every external side effect is mocked. Prisma/DB-level idempotency
 * (P2002-as-duplicate) is already covered in __tests__/analyticsEvents.test.ts
 * and is not re-tested here — recordAnalyticsEvent itself is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const constructEvent = vi.fn((..._args: unknown[]) => ({}) as unknown);
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...(a as [])) },
    subscriptions: { cancel: vi.fn(async () => ({})) },
  },
  PRICES: { lifetimePerks: 'price_perks_test' },
}));

const setUserPlan = vi.fn(async (..._args: unknown[]) => ({}));
const findByStripeCustomer = vi.fn(async () => null as unknown);
const findById = vi.fn(async () => ({
  id: 'user-1', email: 'buyer@example.com', name: 'Test Buyer',
  phone: '555-0100', isProTrial: false, paidCampaignEnrolledAt: '2026-01-01',
  engagementEnrolledAt: '2026-01-01', referredBy: null, referralRewardCredited: false,
  isTestAccount: false, stripeSubscriptionId: null,
}) as unknown);
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

interface SessionOpts {
  userId?: string | null;
  billing?: string;
  paymentStatus?: string;
  isGift?: string;
  offerSource?: string;
  amountTotal?: number;
  currency?: string;
}

function makeSession(opts: SessionOpts = {}) {
  const metadata: Record<string, string> = { tier: 'pro' };
  if (opts.userId !== null) metadata.userId = opts.userId ?? 'user-1';
  if (opts.billing !== undefined) metadata.billing = opts.billing;
  if (opts.isGift) metadata.isGift = opts.isGift;
  if (opts.offerSource) metadata.offerSource = opts.offerSource;

  return {
    id: 'cs_test_session_1',
    customer: 'cus_test_1',
    subscription: opts.billing === 'lifetime' ? null : 'sub_test_1',
    payment_status: opts.paymentStatus ?? 'paid',
    payment_intent: 'pi_test_1',
    amount_total: opts.amountTotal ?? 299,
    currency: opts.currency ?? 'usd',
    customer_details: { phone: null, email: 'buyer@example.com' },
    metadata,
  };
}

function makeEvent(eventId: string, session: unknown) {
  return { id: eventId, type: 'checkout.session.completed', data: { object: session } };
}

async function postWebhook(eventId: string, session: unknown) {
  constructEvent.mockReturnValueOnce(makeEvent(eventId, session));
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
  findById.mockResolvedValue({
    id: 'user-1', email: 'buyer@example.com', name: 'Test Buyer',
    phone: '555-0100', isProTrial: false, paidCampaignEnrolledAt: '2026-01-01',
    engagementEnrolledAt: '2026-01-01', referredBy: null, referralRewardCredited: false,
    isTestAccount: false, stripeSubscriptionId: null,
  });
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

describe('Stripe webhook — purchase_completed analytics', () => {
  it('A. paid monthly — writes exactly one purchase_completed event with the expected fields', async () => {
    const res = await postWebhook('evt_test_purchase_123', makeSession({ billing: 'monthly', paymentStatus: 'paid' }));
    expect(res.status).toBe(200);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'purchase_completed',
      originPlatform: 'web',
      emitter: 'webhook',
      provider: 'stripe',
      billing: 'monthly',
      userId: 'user-1',
      idempotencyKey: 'stripe:evt_test_purchase_123',
    });
  });

  it('B. paid lifetime — billing is lifetime', async () => {
    await postWebhook('evt_lifetime_1', makeSession({ billing: 'lifetime', paymentStatus: 'paid' }));
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.billing).toBe('lifetime');
  });

  it('C. gift purchase — no purchase_completed analytics call', async () => {
    await postWebhook('evt_gift_1', makeSession({ billing: 'lifetime', paymentStatus: 'paid', isGift: 'true', userId: null }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('D. unpaid — entitlement still runs, no analytics call', async () => {
    await postWebhook('evt_unpaid_1', makeSession({ billing: 'monthly', paymentStatus: 'unpaid' }));
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('E. no_payment_required — no analytics call', async () => {
    await postWebhook('evt_free_1', makeSession({ billing: 'monthly', paymentStatus: 'no_payment_required' }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('F. lifetime-perks — REQUIRED regression: not miscounted as monthly, no analytics call at all', async () => {
    await postWebhook('evt_perks_1', makeSession({ billing: 'lifetime-perks', paymentStatus: 'paid' }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('G. annual — no analytics call', async () => {
    await postWebhook('evt_annual_1', makeSession({ billing: 'annual', paymentStatus: 'paid' }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('H. unknown/missing billing metadata — no analytics call', async () => {
    await postWebhook('evt_missing_billing_1', makeSession({ paymentStatus: 'paid' }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('I. analytics failure does not affect entitlement or the rest of the webhook', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const res = await postWebhook('evt_fail_1', makeSession({ billing: 'monthly', paymentStatus: 'paid' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    // Downstream side effects (GHL sync, paid-campaign enrollment) still ran.
    expect(updateGhlContactPlan).toHaveBeenCalledTimes(1);
  });

  it('J. idempotency key uses the exact Stripe event id', async () => {
    await postWebhook('evt_test_purchase_123', makeSession({ billing: 'monthly', paymentStatus: 'paid' }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.idempotencyKey).toBe('stripe:evt_test_purchase_123');
  });

  it('metadata is small and non-PII — no email, customer ID, session ID, or payment intent', async () => {
    await postWebhook('evt_meta_1', makeSession({ billing: 'monthly', paymentStatus: 'paid', offerSource: 'founding' }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const metadata = call.metadata as Record<string, unknown>;
    expect(metadata).toEqual({ tier: 'pro', amountTotal: 299, currency: 'usd', offerSource: 'founding' });
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('cus_test_1');
    expect(serialized).not.toContain('cs_test_session_1');
    expect(serialized).not.toContain('pi_test_1');
    expect(serialized).not.toContain('sub_test_1');
  });

  it('the analytics call is awaited before the handler returns — recordAnalyticsEvent resolves before POST does', async () => {
    let resolved = false;
    recordAnalyticsEvent.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
      return { outcome: 'written' as const, id: 'evt_1' };
    });
    await postWebhook('evt_await_1', makeSession({ billing: 'monthly', paymentStatus: 'paid' }));
    expect(resolved).toBe(true);
  });
});
