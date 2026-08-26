/**
 * Phase 5B — server-side gate for the post-feedback $9.99 Lifetime offer in
 * app/api/stripe/checkout/route.ts. Same mocking pattern as
 * __tests__/stripeCheckoutSecurity.test.ts: no real Stripe/Prisma call is
 * made — lib/feedbackCampaign and lib/feedbackLifetimeOffer are mocked
 * directly so this file only exercises the route's own gating logic.
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
vi.mock('@/lib/newMemberOffer', () => ({ newMemberOfferStatus: () => ({ eligible: false }), NEW_MEMBER_LIFETIME_COUPON: 'coupon_new_member' }));
vi.mock('@/lib/winbackOffer', () => ({ winbackOfferAvailable: () => false, WINBACK_LIFETIME_COUPON: 'coupon_winback' }));
vi.mock('@/lib/foundingPromo', () => ({ foundingStatus: async () => ({ active: false }), FOUNDING_LIFETIME_COUPON: 'coupon_founding' }));
vi.mock('@/lib/analyticsEvents', () => ({ recordAnalyticsEvent: vi.fn(async () => ({ outcome: 'written', id: 'evt' })) }));

interface LifetimeOfferStatusMock {
  lifetimeOfferEligible: boolean; lifetimeOfferExpiresAt: string | null; alreadyLifetime: boolean; converted: boolean;
}
const getLifetimeOfferStatus = vi.fn(async (): Promise<LifetimeOfferStatusMock> => ({
  lifetimeOfferEligible: false, lifetimeOfferExpiresAt: null, alreadyLifetime: false, converted: false,
}));
const markLifetimeOfferRedeemStarted = vi.fn(async () => {});
vi.mock('@/lib/feedbackCampaign', () => ({
  getLifetimeOfferStatus: (...a: unknown[]) => getLifetimeOfferStatus(...(a as [])),
  markLifetimeOfferRedeemStarted: (...a: unknown[]) => markLifetimeOfferRedeemStarted(...(a as [])),
}));

let feedbackCoupon: string | null = 'coupon_feedback_test';
vi.mock('@/lib/feedbackLifetimeOffer', () => ({ get FEEDBACK_LIFETIME_COUPON() { return feedbackCoupon; } }));

function req(body: Record<string, unknown>) {
  return new Request('https://www.gascap.app/api/stripe/checkout', { method: 'POST', body: JSON.stringify(body) });
}
async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  return POST(req(body));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  feedbackCoupon = 'coupon_feedback_test';
  sessionsCreate.mockResolvedValue({ id: 'cs_test_default', url: 'https://checkout.example/default' });
  findById.mockResolvedValue({
    id: 'user-1', email: 'buyer@example.com', stripeCustomerId: null,
    stripeInterval: null, stripeSubscriptionId: null, isProTrial: false, trialExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  getLifetimeOfferStatus.mockResolvedValue({ lifetimeOfferEligible: false, lifetimeOfferExpiresAt: null, alreadyLifetime: false, converted: false });
});

describe('POST /api/stripe/checkout — Phase 5B feedback-offer gate', () => {
  it('rejects the feedback-offer checkout when the server says the user is not eligible', async () => {
    getLifetimeOfferStatus.mockResolvedValue({ lifetimeOfferEligible: false, lifetimeOfferExpiresAt: null, alreadyLifetime: false, converted: false });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', feedbackOffer: true });
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('creates a checkout session with the feedback coupon when eligible', async () => {
    getLifetimeOfferStatus.mockResolvedValue({ lifetimeOfferEligible: true, lifetimeOfferExpiresAt: new Date().toISOString(), alreadyLifetime: false, converted: false });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', feedbackOffer: true });
    expect(res.status).toBe(200);
    const call = sessionsCreate.mock.calls[0][0] as { discounts?: { coupon: string }[] };
    expect(call.discounts?.[0]?.coupon).toBe('coupon_feedback_test');
    expect(markLifetimeOfferRedeemStarted).toHaveBeenCalledWith('user-1');
  });

  it('fails closed (503) when eligible but the coupon has not been configured yet', async () => {
    feedbackCoupon = null;
    getLifetimeOfferStatus.mockResolvedValue({ lifetimeOfferEligible: true, lifetimeOfferExpiresAt: new Date().toISOString(), alreadyLifetime: false, converted: false });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', feedbackOffer: true });
    expect(res.status).toBe(503);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('a plain Lifetime checkout with no feedbackOffer flag never calls getLifetimeOfferStatus', async () => {
    const res = await callRoute({ tier: 'pro', billing: 'lifetime' });
    expect(res.status).toBe(200);
    expect(getLifetimeOfferStatus).not.toHaveBeenCalled();
    const call = sessionsCreate.mock.calls[0][0] as { discounts?: unknown };
    expect(call.discounts).toBeUndefined();
  });

  it('an ineligible caller cannot bypass the gate by also setting an unrelated offer flag', async () => {
    getLifetimeOfferStatus.mockResolvedValue({ lifetimeOfferEligible: false, lifetimeOfferExpiresAt: null, alreadyLifetime: true, converted: false });
    const res = await callRoute({ tier: 'pro', billing: 'lifetime', feedbackOffer: true, winbackOffer: true });
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
