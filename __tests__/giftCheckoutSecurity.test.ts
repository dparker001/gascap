/**
 * Stripe Payment Authorization Hardening — regression coverage for
 * app/api/stripe/gift-checkout/route.ts's removal of the raw caller-supplied
 * `body.coupon` field.
 *
 * No first-party caller (app/gift/page.tsx) ever sent `coupon` — see the
 * hardening report's full inventory. Before this change, an arbitrary
 * caller could supply any Stripe coupon ID and have it applied to a gift
 * purchase; this proves that capability is gone while Stripe's own
 * customer-facing `allow_promotion_codes` entry field is preserved exactly.
 *
 * No real Stripe call is made.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionsCreate = vi.fn(async (..._a: unknown[]) => ({ id: 'cs_test_gift', url: 'https://checkout.example/gift' }) as unknown);
vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: (...a: unknown[]) => sessionsCreate(...(a as [])) } } },
  PRICES: { proLifetime: 'price_pro_lifetime_canonical' },
}));

vi.mock('@/lib/getBaseUrl', () => ({ getBaseUrl: () => 'https://www.gascap.app' }));

function req(body: Record<string, unknown>) {
  return new Request('https://www.gascap.app/api/stripe/gift-checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionsCreate.mockResolvedValue({ id: 'cs_test_gift', url: 'https://checkout.example/gift' });
});

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/stripe/gift-checkout/route');
  return POST(req(body));
}

const VALID_BODY = { purchaserEmail: 'buyer@example.com', deliverToRecipient: false };

describe('POST /api/stripe/gift-checkout — coupon trust boundary', () => {
  it('SEC-C12. Arbitrary body.coupon cannot control discounts — field is ignored entirely', async () => {
    const res = await callRoute({ ...VALID_BODY, coupon: 'attacker_supplied_coupon' });
    expect(res.status).toBe(200);
    const createCall = sessionsCreate.mock.calls[0][0] as { discounts?: unknown; allow_promotion_codes?: boolean };
    expect(createCall.discounts).toBeUndefined();
    expect(createCall.allow_promotion_codes).toBe(true);
  });

  it('SEC-C12b. No coupon field at all behaves identically to a supplied one — proves the field has zero effect either way', async () => {
    const withCoupon    = await callRoute({ ...VALID_BODY, coupon: 'attacker_supplied_coupon' });
    const withoutCoupon = await callRoute(VALID_BODY);
    expect(withCoupon.status).toBe(withoutCoupon.status);
    const call1 = sessionsCreate.mock.calls[0][0] as { discounts?: unknown };
    const call2 = sessionsCreate.mock.calls[1][0] as { discounts?: unknown };
    expect(call1.discounts).toEqual(call2.discounts);
  });
});
