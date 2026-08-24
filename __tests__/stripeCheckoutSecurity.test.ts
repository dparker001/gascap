/**
 * Stripe Payment Authorization Hardening — regression coverage for
 * app/api/stripe/checkout/route.ts's removal of the caller-controlled
 * `body.priceId` override and the new runtime tier/billing allowlist.
 *
 * Before this hardening, a caller could supply an arbitrary body.priceId
 * that overrode the server's own canonical Price lookup, and an unknown
 * billing string silently fell through to Pro Monthly. This file proves:
 * (1) normal Monthly/Lifetime checkout always uses the canonical server
 * Price regardless of what a caller sends as `priceId` (now a no-op field,
 * since it's no longer read at all), (2) unknown billing/tier are rejected
 * with 400 rather than mapped to any entitlement, (3) Annual is still
 * rejected, and (4) Lifetime Perks still creates only its own canonical
 * Perks session.
 *
 * No real Stripe call is made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionsCreate = vi.fn(async (..._a: unknown[]) => ({ id: 'cs_test_default', url: 'https://checkout.example/default' }) as unknown);
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: (...a: unknown[]) => sessionsCreate(...(a as [])) } } },
  PRICES: { proMonthly: 'price_pro_monthly_canonical', proLifetime: 'price_pro_lifetime_canonical', lifetimePerks: 'price_perks_canonical' },
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
});

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  return POST(req(body));
}

describe('POST /api/stripe/checkout — Stripe Payment Authorization Hardening', () => {
  it('SEC-C1. Normal Pro Monthly uses the canonical server Price', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'monthly' });
    expect(res.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_pro_monthly_canonical');
  });

  it('SEC-C2. Normal Pro Lifetime uses the canonical server Price', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'lifetime' });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_pro_lifetime_canonical');
  });

  it('SEC-C3. Caller-supplied priceId cannot override the canonical Monthly price (field is ignored)', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'monthly', priceId: 'price_attacker_supplied' });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_pro_monthly_canonical');
    expect(createCall.line_items[0].price).not.toBe('price_attacker_supplied');
  });

  it('SEC-C4. Caller-supplied priceId cannot override the canonical Lifetime price (field is ignored)', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', priceId: 'price_attacker_supplied' });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_pro_lifetime_canonical');
    expect(createCall.line_items[0].price).not.toBe('price_attacker_supplied');
  });

  it('SEC-C5. Unknown billing cannot silently become Monthly — 400, no session created', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'mystery-plan' });
    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('SEC-C6. Unknown tier cannot create an arbitrary checkout even with a supplied Price — 400, no session created', async () => {
    const res = await callRoute({ tier: 'fleet', billing: 'monthly', priceId: 'price_attacker_supplied' });
    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('SEC-C6b. A wholly unrecognized tier string is also rejected — 400, no session created', async () => {
    const res = await callRoute({ tier: 'mystery-tier', billing: 'monthly' });
    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('SEC-C7. Annual still has the existing rejection behavior — 400, no session created', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'annual' });
    expect(res.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('SEC-C8. Lifetime Perks still creates only its own canonical Perks Checkout Session', async () => {
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: 'lifetime', stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime-perks' });
    expect(res.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_perks_canonical');
  });

  // ── Provider-neutral Lifetime Perks eligibility ──────────────────────────
  // Found via live native IAP testing (2026-08-24): the gate previously
  // checked `user.stripeInterval === 'lifetime'` only, which permanently
  // 403'd a genuine RevenueCat (native IAP) Lifetime owner trying to buy the
  // Stripe-billed Perks add-on. See
  // docs/reviews/2026-08-24-lifetime-entitlement-check-gap.md. Perks itself
  // is unchanged — still only ever purchasable here via Stripe; only the
  // "already Lifetime" prerequisite is now provider-neutral.

  it('SEC-C8b. A RevenueCat (native IAP) Lifetime owner can also buy Lifetime Perks', async () => {
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'lifetime',
      stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime-perks' });
    expect(res.status).toBe(200);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const createCall = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    expect(createCall.line_items[0].price).toBe('price_perks_canonical');
  });

  it('SEC-C8c. A RevenueCat Monthly (not Lifetime) subscriber is still rejected from Lifetime Perks', async () => {
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'monthly',
      stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime-perks' });
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('SEC-C8d. A non-Lifetime, non-RevenueCat user is still rejected from Lifetime Perks', async () => {
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
      stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime-perks' });
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('SEC-C8e. A RevenueCat Lifetime owner is excluded from the founding discount even while the promo is active — already Lifetime', async () => {
    foundingStatus.mockResolvedValue({ active: true });
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'lifetime',
      stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', foundingOffer: true });
    expect(res.status).toBe(200);
    // Before the fix, a RevenueCat Lifetime owner's stripeInterval (null)
    // !== 'lifetime' would pass the old check and apply the founding
    // coupon anyway, despite already owning Lifetime.
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: unknown; allow_promotion_codes?: boolean };
    expect(createCall.discounts).toBeUndefined();
    expect(createCall.allow_promotion_codes).toBe(true);
  });

  it('SEC-C8f. A genuinely non-Lifetime user still gets the founding discount while the promo is active', async () => {
    foundingStatus.mockResolvedValue({ active: true });
    findById.mockResolvedValueOnce({
      id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
      stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
      stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', foundingOffer: true });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: { coupon: string }[] };
    expect(createCall.discounts).toEqual([{ coupon: 'coupon_founding' }]);
  });

  it('SEC-C9. request body no longer has any effect from a priceId field — response identical with or without it', async () => {
    const withPriceId    = await callRoute({ tier: 'pro', billing: 'monthly', priceId: 'price_whatever' });
    const withoutPriceId = await callRoute({ tier: 'pro', billing: 'monthly' });
    expect(withPriceId.status).toBe(withoutPriceId.status);
    const call1 = sessionsCreate.mock.calls[0][0] as { line_items: { price: string }[] };
    const call2 = sessionsCreate.mock.calls[1][0] as { line_items: { price: string }[] };
    expect(call1.line_items[0].price).toBe(call2.line_items[0].price);
  });

  // ── Coupon trust boundary ──────────────────────────────────────────────
  // The checkout route has no `body.coupon` contract at all — there is no
  // caller-controlled way to name a Stripe Coupon ID. A coupon is only ever
  // set from a server-validated offer flag (new-member/winback/founding).
  // (A prior allowlist for exactly one raw campaign coupon — C4/LIFETIME19 —
  // was removed 2026-08-20: that coupon never existed in Stripe, and the
  // client-side gating that was supposed to route it only through Lifetime
  // billing was itself wired to the wrong billing type, so the dead path
  // could 500 a real Monthly checkout if ever reached.)

  it('SEC-C10. Arbitrary caller-selected Coupon ID field is never sent to Stripe — checkout still succeeds, falls back to allow_promotion_codes', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'monthly', coupon: 'attacker-selected-value' });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: unknown; allow_promotion_codes?: boolean };
    expect(createCall.discounts).toBeUndefined();
    expect(createCall.allow_promotion_codes).toBe(true);
  });

  it('SEC-C10b. Even a value matching the historical C4 coupon literal is ignored — no coupon allowlist survives the removal', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'monthly', coupon: 'LIFETIME19' });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: unknown; allow_promotion_codes?: boolean };
    expect(createCall.discounts).toBeUndefined();
    expect(createCall.allow_promotion_codes).toBe(true);
  });

  it('SEC-C11. Server-controlled offer (new-member) still applies its own resolved coupon, independent of any caller-supplied coupon', async () => {
    newMemberOfferStatus.mockReturnValue({ eligible: true });
    await callRoute({ tier: 'pro', billing: 'lifetime', newMemberOffer: true, coupon: 'attacker_supplied_coupon' });

    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: { coupon: string }[] };
    // The server-resolved new-member coupon constant is applied — the
    // caller-supplied `coupon` field is fully overwritten by the eligible
    // offer branch (lib/newMemberOffer), never reaches Stripe unmodified.
    expect(createCall.discounts).toEqual([{ coupon: 'coupon_new_member' }]);
  });

  it('SEC-C13. No coupon and no eligible offer — allow_promotion_codes:true is preserved exactly as before', async () => {
    await callRoute({ tier: 'pro', billing: 'monthly' });
    const createCall = sessionsCreate.mock.calls[0][0] as { allow_promotion_codes?: boolean; discounts?: unknown };
    expect(createCall.allow_promotion_codes).toBe(true);
    expect(createCall.discounts).toBeUndefined();
  });
});
