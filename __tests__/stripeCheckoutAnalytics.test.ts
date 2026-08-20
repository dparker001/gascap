/**
 * Growth Sprint 1, P0C-1B — regression coverage for the Stripe checkout
 * route's checkout_started first-party analytics write, integrated onto
 * the Stripe Payment Authorization Hardening baseline
 * (app/api/stripe/checkout/route.ts).
 *
 * checkout_started fires strictly after a real stripe.checkout.sessions.
 * create() call succeeds, and only for a genuine canonical Pro Monthly or
 * Pro Lifetime checkout. Price selection is entirely server-owned under the
 * hardened contract — there is no caller-supplied `priceId` field anymore,
 * so Fleet/unknown-tier/unknown-billing are rejected with 400 BEFORE any
 * Stripe session is ever created (a structural change from the pre-hardening
 * behavior, where those cases could still reach Stripe via a legacy
 * `priceId` override and had to be excluded from analytics after the fact).
 *
 * This does NOT test purchase_completed (webhook-authoritative, unchanged —
 * see __tests__/stripeWebhookAnalytics.test.ts) or offer-eligibility helper
 * internals (newMemberOfferStatus/winbackOfferAvailable/foundingStatus are
 * pre-existing and unchanged). It tests only: (1) the analytics classifier,
 * (2) that Fleet/Annual/Lifetime Perks/unknown tier/unknown billing never
 * produce an event, (3) exact event fields/idempotency, (4) offerSource
 * metadata passthrough, (5) analytics-failure isolation, (6) privacy, and
 * (7) that the hardened Price-authorization contract (no caller priceId,
 * canonical Price always used) is preserved and cannot be bypassed to
 * influence analytics.
 *
 * Every external side effect is mocked. No real Stripe call is made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const sessionsCreate = vi.fn(async (..._a: unknown[]) => ({ id: 'cs_test_default', url: 'https://checkout.example/default' }) as unknown);
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: (...a: unknown[]) => sessionsCreate(...(a as [])) } } },
  PRICES: { proMonthly: 'price_pro_monthly', proLifetime: 'price_pro_lifetime', lifetimePerks: 'price_perks' },
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1', email: 'buyer@example.com' } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const findById = vi.fn(async () => ({
  id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
  stripeInterval: null, stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}) as unknown);
vi.mock('@/lib/users', () => ({ findById: (...a: unknown[]) => findById(...(a as [])) }));

vi.mock('@/lib/getBaseUrl', () => ({ getBaseUrl: () => 'https://www.gascap.app' }));

const newMemberOfferStatus = vi.fn(() => ({ eligible: false }));
vi.mock('@/lib/newMemberOffer', () => ({
  newMemberOfferStatus: (...a: unknown[]) => newMemberOfferStatus(...(a as [])),
  NEW_MEMBER_LIFETIME_COUPON: 'coupon_new_member',
}));

const winbackOfferAvailable = vi.fn(() => false);
vi.mock('@/lib/winbackOffer', () => ({
  winbackOfferAvailable: (...a: unknown[]) => winbackOfferAvailable(...(a as [])),
  WINBACK_LIFETIME_COUPON: 'coupon_winback',
}));

const foundingStatus = vi.fn(async () => ({ active: false }));
vi.mock('@/lib/foundingPromo', () => ({
  foundingStatus: (...a: unknown[]) => foundingStatus(...(a as [])),
  FOUNDING_LIFETIME_COUPON: 'coupon_founding',
}));

const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]) =>
  ({ outcome: 'written', id: 'evt_1' }) as { outcome: 'written'; id: string } | { outcome: 'duplicate' });
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])) }));

// ── Helpers ──────────────────────────────────────────────────────────────

function req(body: Record<string, unknown>) {
  return new Request('https://www.gascap.app/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionsCreate.mockResolvedValue({ id: 'cs_test_default', url: 'https://checkout.example/default' });
  findById.mockResolvedValue({
    id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
    stripeInterval: null, stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  newMemberOfferStatus.mockReturnValue({ eligible: false });
  winbackOfferAvailable.mockReturnValue(false);
  foundingStatus.mockResolvedValue({ active: false });
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  return POST(req(body));
}

describe('POST /api/stripe/checkout — checkout_started analytics (hardened contract)', () => {
  it('SC1. Pro Monthly successful session → checkout_started monthly', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_monthly', url: 'https://checkout.example/monthly' });

    const res = await callRoute({ tier: 'pro', billing: 'monthly' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.example/monthly');
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ eventType: 'checkout_started', billing: 'monthly' });
  });

  it('SC2. Pro Lifetime successful session → checkout_started lifetime', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_lifetime', url: 'https://checkout.example/lifetime' });

    const res = await callRoute({ tier: 'pro', billing: 'lifetime' });
    expect(res.status).toBe(200);

    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ eventType: 'checkout_started', billing: 'lifetime' });
  });

  it('SC3. Lifetime Perks → no checkout_started (own session branch, isolated from normal-checkout analytics)', async () => {
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: 'lifetime', stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_perks', url: 'https://checkout.example/perks' });

    const res = await callRoute({ tier: 'pro', billing: 'lifetime-perks' });

    expect(res.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SC4. Annual rejected → 400, no Stripe session, no checkout_started', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'annual' });

    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SC5. Unsupported billing rejected → 400 (hardened runtime allowlist), no Stripe session, no checkout_started', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'mystery-plan' });

    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SC6. Unsupported tier rejected → 400 (hardened runtime allowlist, includes Fleet), no Stripe session, no checkout_started', async () => {
    const res1 = await callRoute({ tier: 'fleet', billing: 'monthly' });
    expect(res1.status).toBe(400);

    const res2 = await callRoute({ tier: 'mystery-tier', billing: 'monthly' });
    expect(res2.status).toBe(400);

    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SC7. Stripe session creation failure → no analytics event, error propagates', async () => {
    sessionsCreate.mockRejectedValueOnce(new Error('stripe unavailable'));

    await expect(callRoute({ tier: 'pro', billing: 'monthly' })).rejects.toThrow('stripe unavailable');
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('SC8. Analytics writer failure — Checkout URL still returned successfully', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_failanalytics', url: 'https://checkout.example/failanalytics' });
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));

    const res = await callRoute({ tier: 'pro', billing: 'monthly' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.example/failanalytics');
  });

  it('SC9. Event fields correct — originPlatform web, emitter server, provider stripe, source stripe_checkout, correct userId', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_fields', url: 'https://checkout.example/fields' });

    await callRoute({ tier: 'pro', billing: 'monthly' });

    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType:      'checkout_started',
      originPlatform: 'web',
      emitter:        'server',
      provider:       'stripe',
      source:         'stripe_checkout',
      userId:         'user-1',
    });
  });

  it('SC10. Idempotency key uses the exact created Stripe Checkout Session ID', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_idem', url: 'https://checkout.example/idem' });

    await callRoute({ tier: 'pro', billing: 'lifetime' });

    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.idempotencyKey).toBe('checkout_started:stripe:cs_test_idem');
  });

  it('SC11. Session ID absent from metadata — allowed ONLY inside idempotencyKey', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_no_meta_sid', url: 'https://checkout.example/no-meta-sid' });

    await callRoute({ tier: 'pro', billing: 'monthly' });

    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const metadata = call.metadata as Record<string, unknown> | undefined;
    expect(metadata).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain('metadata":{"sessionId');
  });

  it('SC12. Privacy — no email/phone/Customer/Subscription/Price/Coupon/amount/billing-identifier PII in metadata', async () => {
    newMemberOfferStatus.mockReturnValue({ eligible: true });
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_privacy', url: 'https://checkout.example/privacy' });

    await callRoute({ tier: 'pro', billing: 'lifetime', newMemberOffer: true });

    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(call);

    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('price_pro_lifetime');
    expect(serialized).not.toContain('coupon_new_member');
    expect(serialized).not.toContain('checkout.example');
    // The Checkout Session ID is allowed ONLY inside idempotencyKey.
    expect(call.metadata).toEqual({ offerSource: 'new_member' });
    expect(call.idempotencyKey).toBe('checkout_started:stripe:cs_test_privacy');
  });

  it('SC13. New-member valid offer — session and analytics both fire, offerSource new_member', async () => {
    newMemberOfferStatus.mockReturnValue({ eligible: true });
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_nm', url: 'https://checkout.example/nm' });

    const res = await callRoute({ tier: 'pro', billing: 'lifetime', newMemberOffer: true });

    expect(res.status).toBe(200);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toEqual({ offerSource: 'new_member' });
  });

  it('SC14. Win-back valid offer — session and analytics both fire, offerSource winback', async () => {
    winbackOfferAvailable.mockReturnValue(true);
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_wb', url: 'https://checkout.example/wb' });

    const res = await callRoute({ tier: 'pro', billing: 'lifetime', winbackOffer: true });

    expect(res.status).toBe(200);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toEqual({ offerSource: 'winback' });
  });

  it('SC15. Founding valid offer — session and analytics both fire, offerSource founding', async () => {
    foundingStatus.mockResolvedValue({ active: true });
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_fnd', url: 'https://checkout.example/fnd' });

    const res = await callRoute({ tier: 'pro', billing: 'lifetime', foundingOffer: true });

    expect(res.status).toBe(200);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toEqual({ offerSource: 'founding' });
  });

  it('SC16. A coupon value matching the historical C4 literal has no special handling — session and analytics fire exactly like any other ignored coupon', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_c4', url: 'https://checkout.example/c4' });

    const res = await callRoute({ tier: 'pro', billing: 'monthly', coupon: 'LIFETIME19' });

    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: unknown; allow_promotion_codes?: boolean };
    expect(createCall.discounts).toBeUndefined();
    expect(createCall.allow_promotion_codes).toBe(true);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ eventType: 'checkout_started', billing: 'monthly' });
  });

  it('SC17. Arbitrary raw coupon is ignored (Stripe Payment Authorization Hardening) but checkout_started still fires for the valid canonical purchase', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_arbcoupon', url: 'https://checkout.example/arbcoupon' });

    const res = await callRoute({ tier: 'pro', billing: 'monthly', coupon: 'attacker-selected-value' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.example/arbcoupon');
    // The arbitrary coupon never reached Stripe — session created without discounts.
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: unknown; allow_promotion_codes?: boolean };
    expect(createCall.discounts).toBeUndefined();
    expect(createCall.allow_promotion_codes).toBe(true);
    // checkout_started still fires normally for the underlying valid Monthly purchase.
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ eventType: 'checkout_started', billing: 'monthly' });
  });

  it('SC18. Hardened route has no caller priceId authority — an extra priceId JSON field cannot change the Stripe line-item Price or the analytics billing', async () => {
    const withPriceId    = await callRoute({ tier: 'pro', billing: 'monthly', priceId: 'price_attacker_supplied' });
    const call1 = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(withPriceId.status).toBe(200);
    expect(call1.line_items[0].price).toBe('price_pro_monthly');
    expect(call1.line_items[0].price).not.toBe('price_attacker_supplied');

    const analyticsCall = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(analyticsCall.billing).toBe('monthly');
  });

  it('SC19. Normal Monthly Stripe line item is always PRICES.proMonthly', async () => {
    await callRoute({ tier: 'pro', billing: 'monthly' });
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_pro_monthly');
  });

  it('SC20. Normal Lifetime Stripe line item is always PRICES.proLifetime', async () => {
    await callRoute({ tier: 'pro', billing: 'lifetime' });
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_pro_lifetime');
  });

  // ── Bonus coverage (beyond the required SC1-20 set) ──────────────────────

  it('Bonus. No offer, no coupon — metadata omitted (not an empty object)', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_plain', url: 'https://checkout.example/plain' });

    await callRoute({ tier: 'pro', billing: 'monthly' });

    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.metadata).toBeUndefined();
  });

  it('Bonus. Duplicate writer outcome — normal successful response, no special handling needed', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_dup', url: 'https://checkout.example/dup' });
    recordAnalyticsEvent.mockResolvedValueOnce({ outcome: 'duplicate' });

    const res = await callRoute({ tier: 'pro', billing: 'monthly' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.example/dup');
  });

  it('Bonus. Stripe session creation occurs before checkout_started analytics write', async () => {
    sessionsCreate.mockResolvedValueOnce({ id: 'cs_test_order', url: 'https://checkout.example/order' });

    await callRoute({ tier: 'pro', billing: 'monthly' });

    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(sessionsCreate.mock.invocationCallOrder[0])
      .toBeLessThan(recordAnalyticsEvent.mock.invocationCallOrder[0]);
  });
});
