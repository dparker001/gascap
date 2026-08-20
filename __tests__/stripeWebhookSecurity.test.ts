/**
 * Stripe Payment Authorization Hardening — regression coverage for
 * app/api/stripe/webhook/route.ts's new provider-authoritative Price
 * verification in checkout.session.completed.
 *
 * Before this hardening, entitlement was granted purely from
 * session.metadata (tier/billing) — values that originate from the
 * checkout REQUEST, not from what Stripe actually sold. This file proves:
 * (1) a genuine canonical Monthly/Lifetime purchase (Price + metadata both
 * agree) still grants entitlement exactly once, (2) any Price/metadata
 * mismatch — in either direction — grants nothing, (3) an unrecognized
 * Price grants nothing, (4) a Stripe API lookup failure fails CLOSED
 * (non-200, so Stripe retries) rather than silently granting or silently
 * dropping the event, (5) Lifetime Perks never runs the normal Pro-upgrade
 * path, even under forged metadata, and (6) gift completions are subject
 * to the same actual-Price check before a Gift record is created.
 *
 * No real Stripe call is made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const constructEvent = vi.fn((..._args: unknown[]) => ({}) as unknown);
type LineItemData = { data: { price: { id: string } | null; quantity: number }[] };
const listLineItems = vi.fn(async (..._a: unknown[]): Promise<LineItemData> => ({ data: [{ price: { id: 'price_pro_monthly_test' }, quantity: 1 }] }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...(a as [])) },
    subscriptions: { cancel: vi.fn(async () => ({})) },
    checkout: { sessions: { listLineItems: (...a: unknown[]) => listLineItems(...(a as [])) } },
  },
  PRICES: {
    proMonthly:    'price_pro_monthly_test',
    proLifetime:   'price_pro_lifetime_test',
    lifetimePerks: 'price_perks_test',
  },
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

const createGift = vi.fn(async () => ({ code: 'GIFT-1', occasion: 'gift', recipientName: null }));
vi.mock('@/lib/email', () => ({
  sendMail: vi.fn(async () => {}),
  giftEmailHtml: vi.fn(() => '<html></html>'),
}));
vi.mock('@/lib/gifts', () => ({ createGift: (...a: unknown[]) => createGift(...(a as [])) }));
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
}

function makeSession(opts: SessionOpts = {}) {
  const metadata: Record<string, string> = { tier: 'pro' };
  if (opts.userId !== null) metadata.userId = opts.userId ?? 'user-1';
  if (opts.billing !== undefined) metadata.billing = opts.billing;
  if (opts.isGift) metadata.isGift = opts.isGift;

  return {
    id: 'cs_test_session_1',
    customer: 'cus_test_1',
    subscription: opts.billing === 'lifetime' ? null : 'sub_test_1',
    payment_status: opts.paymentStatus ?? 'paid',
    payment_intent: 'pi_test_1',
    amount_total: 299,
    currency: 'usd',
    customer_details: { phone: null, email: 'buyer@example.com' },
    metadata,
  };
}

function makeEvent(eventId: string, session: unknown) {
  return { id: eventId, type: 'checkout.session.completed', data: { object: session } };
}

function priceLineItemsOnce(priceId: string | null, quantity = 1) {
  if (priceId === null) listLineItems.mockResolvedValueOnce({ data: [] });
  else listLineItems.mockResolvedValueOnce({ data: [{ price: { id: priceId }, quantity }] });
}

/** Queues a two-line-item response (any second item makes the session
 *  invalid for GasCap's one-Price entitlement contract regardless of what
 *  the first item is). */
function multiLineItemsOnce(firstPriceId: string, firstQuantity = 1) {
  listLineItems.mockResolvedValueOnce({
    data: [
      { price: { id: firstPriceId }, quantity: firstQuantity },
      { price: { id: 'price_second_item_test' }, quantity: 1 },
    ],
  });
}

function priceLineItemsFails(err: Error) {
  listLineItems.mockRejectedValueOnce(err);
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

describe('Stripe webhook — checkout.session.completed Price authorization', () => {
  it('SEC-W1. Canonical Pro Monthly Price + matching metadata → setUserPlan once as Pro Monthly', async () => {
    priceLineItemsOnce('price_pro_monthly_test');
    const res = await postWebhook('evt_w1', makeSession({ billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    expect(setUserPlan).toHaveBeenCalledWith('user-1', 'pro', expect.objectContaining({ interval: 'monthly' }));
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it('SEC-W2. Canonical Pro Lifetime Price + matching metadata → setUserPlan once as Pro Lifetime', async () => {
    priceLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w2', makeSession({ billing: 'lifetime' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    expect(setUserPlan).toHaveBeenCalledWith('user-1', 'pro', expect.objectContaining({ interval: 'lifetime' }));
  });

  it('SEC-W3. Monthly metadata + wrong Price → NO setUserPlan, NO purchase_completed', async () => {
    priceLineItemsOnce('price_some_other_product');
    const res = await postWebhook('evt_w3', makeSession({ billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W4. Lifetime metadata + wrong Price → NO setUserPlan, NO purchase_completed', async () => {
    priceLineItemsOnce('price_some_other_product');
    const res = await postWebhook('evt_w4', makeSession({ billing: 'lifetime' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W5. Canonical Monthly Price + lifetime metadata → NO entitlement (Price/metadata disagree)', async () => {
    priceLineItemsOnce('price_pro_monthly_test');
    const res = await postWebhook('evt_w5', makeSession({ billing: 'lifetime' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W6. Canonical Lifetime Price + monthly metadata → NO entitlement (Price/metadata disagree)', async () => {
    priceLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w6', makeSession({ billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W7. Unknown Price → NO entitlement', async () => {
    priceLineItemsOnce('price_totally_unrecognized');
    const res = await postWebhook('evt_w7', makeSession({ billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W8. Line-item Stripe API lookup fails → fail closed (non-200, retryable), NO entitlement', async () => {
    priceLineItemsFails(new Error('Stripe API unavailable'));
    const res = await postWebhook('evt_w8', makeSession({ billing: 'monthly' }));
    expect(res.status).not.toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W8b. Empty line items (no price at all) also fails closed, not treated as a deterministic mismatch', async () => {
    priceLineItemsOnce(null);
    const res = await postWebhook('evt_w8b', makeSession({ billing: 'monthly' }));
    expect(res.status).not.toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('SEC-W9. Lifetime Perks canonical Price + expected metadata → NO generic setUserPlan, NO purchase_completed, NO ordinary paid-campaign enrollment, NO ordinary plan onboarding', async () => {
    priceLineItemsOnce('price_perks_test');
    const res = await postWebhook('evt_w9', makeSession({ billing: 'lifetime-perks' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(enrollPaidCampaign).not.toHaveBeenCalled();
    expect(enrollEngagementCampaign).not.toHaveBeenCalled();
    expect(setLifetimePerksActive).not.toHaveBeenCalled();
    expect(updateGhlContactPlan).not.toHaveBeenCalled();
  });

  it('SEC-W10. Lifetime Perks Price + forged monthly metadata → NO generic entitlement', async () => {
    priceLineItemsOnce('price_perks_test');
    const res = await postWebhook('evt_w10', makeSession({ billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W10b. Lifetime Perks Price + forged lifetime metadata → NO generic entitlement, stripeInterval never touched', async () => {
    priceLineItemsOnce('price_perks_test');
    const res = await postWebhook('evt_w10b', makeSession({ billing: 'lifetime' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('SEC-W11. Gift completion + canonical Lifetime Price → existing gift behavior succeeds', async () => {
    priceLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w11', makeSession({ billing: 'lifetime', isGift: 'true', userId: null }));
    expect(res.status).toBe(200);
    expect(createGift).toHaveBeenCalledTimes(1);
  });

  it('SEC-W12. Gift metadata + wrong Price → Gift record NOT created', async () => {
    priceLineItemsOnce('price_some_other_product');
    const res = await postWebhook('evt_w12', makeSession({ billing: 'lifetime', isGift: 'true', userId: null }));
    expect(res.status).toBe(200);
    expect(createGift).not.toHaveBeenCalled();
  });

  it('SEC-W12b. Gift + lookup failure → fails closed, Gift record NOT created', async () => {
    priceLineItemsFails(new Error('Stripe API unavailable'));
    const res = await postWebhook('evt_w12b', makeSession({ billing: 'lifetime', isGift: 'true', userId: null }));
    expect(res.status).not.toBe(200);
    expect(createGift).not.toHaveBeenCalled();
  });

  it('SEC-W13. Multiple line items — first item is canonical Pro Lifetime, second item exists → NO setUserPlan, NO purchase_completed, NO onboarding', async () => {
    multiLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w13', makeSession({ billing: 'lifetime' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(enrollPaidCampaign).not.toHaveBeenCalled();
    expect(enrollEngagementCampaign).not.toHaveBeenCalled();
    expect(updateGhlContactPlan).not.toHaveBeenCalled();
  });

  it('SEC-W14. Canonical Price but quantity !== 1 → NO entitlement', async () => {
    priceLineItemsOnce('price_pro_monthly_test', 2);
    const res = await postWebhook('evt_w14', makeSession({ billing: 'monthly' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W15. Line item missing a Price ID → fails closed (incomplete evidence), NO entitlement', async () => {
    listLineItems.mockResolvedValueOnce({ data: [{ price: null, quantity: 1 }] });
    const res = await postWebhook('evt_w15', makeSession({ billing: 'monthly' }));
    expect(res.status).not.toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W16. Gift with canonical Lifetime first item PLUS a second line item → createGift NOT called', async () => {
    multiLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w16', makeSession({ billing: 'lifetime', isGift: 'true', userId: null }));
    expect(res.status).toBe(200);
    expect(createGift).not.toHaveBeenCalled();
  });

  // ── payment_status authorization policy ─────────────────────────────────
  // 'paid' and 'no_payment_required' (an intentional 100%-off Stripe
  // Promotion Code) both authorize entitlement; 'unpaid' does not. The
  // payment_status gate runs BEFORE any line-item lookup, so these
  // 'unpaid' tests deliberately do NOT queue a listLineItems response —
  // the webhook must never reach that call for an unauthorized status.

  it('SEC-W17. Canonical Pro Monthly + payment_status=unpaid → NO setUserPlan, NO purchase_completed, NO onboarding, deterministic 200 (no infinite retry)', async () => {
    const res = await postWebhook('evt_w17', makeSession({ billing: 'monthly', paymentStatus: 'unpaid' }));
    expect(res.status).toBe(200);
    expect(listLineItems).not.toHaveBeenCalled();
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
    expect(enrollPaidCampaign).not.toHaveBeenCalled();
  });

  it('SEC-W18. Canonical Pro Lifetime + payment_status=unpaid → NO entitlement', async () => {
    const res = await postWebhook('evt_w18', makeSession({ billing: 'lifetime', paymentStatus: 'unpaid' }));
    expect(res.status).toBe(200);
    expect(listLineItems).not.toHaveBeenCalled();
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('SEC-W19. Canonical Pro Monthly + payment_status=no_payment_required → entitlement DOES grant, purchase_completed does NOT emit', async () => {
    priceLineItemsOnce('price_pro_monthly_test');
    const res = await postWebhook('evt_w19', makeSession({ billing: 'monthly', paymentStatus: 'no_payment_required' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W20. Canonical Pro Lifetime + payment_status=no_payment_required → entitlement DOES grant, purchase_completed does NOT emit', async () => {
    priceLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w20', makeSession({ billing: 'lifetime', paymentStatus: 'no_payment_required' }));
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SEC-W21. Gift canonical Lifetime + payment_status=unpaid → createGift NOT called', async () => {
    const res = await postWebhook('evt_w21', makeSession({ billing: 'lifetime', paymentStatus: 'unpaid', isGift: 'true', userId: null }));
    expect(res.status).toBe(200);
    expect(listLineItems).not.toHaveBeenCalled();
    expect(createGift).not.toHaveBeenCalled();
  });

  it('SEC-W22. Gift canonical Lifetime + payment_status=no_payment_required → existing Gift creation is allowed', async () => {
    priceLineItemsOnce('price_pro_lifetime_test');
    const res = await postWebhook('evt_w22', makeSession({ billing: 'lifetime', paymentStatus: 'no_payment_required', isGift: 'true', userId: null }));
    expect(res.status).toBe(200);
    expect(createGift).toHaveBeenCalledTimes(1);
  });

  it('SEC-W23. Unknown/unexpected payment_status → fails closed, NO entitlement', async () => {
    const res = await postWebhook('evt_w23', makeSession({ billing: 'monthly', paymentStatus: 'requires_payment_method' }));
    expect(res.status).toBe(200);
    expect(listLineItems).not.toHaveBeenCalled();
    expect(setUserPlan).not.toHaveBeenCalled();
  });
});
