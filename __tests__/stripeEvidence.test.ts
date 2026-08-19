/**
 * Post-Sprint-2 Revision 6 P0 — guest-checkout-safe, userId-correlated
 * Stripe Lifetime purchase evidence, plus a conservative live Stripe
 * subscription status matrix.
 *
 * Revision 5 correlated by `stripeCustomerId`, which independent review
 * found unsafe: GasCap's Lifetime checkout does not set
 * `customer_creation: 'always'`, so a genuine guest-checkout Lifetime
 * purchaser can have `stripeCustomerId === null`. This now correlates by
 * GasCap's own `userId` via Stripe's PaymentIntent Search API (the Stripe
 * Node SDK has no `checkout.sessions.search` method — see the module doc
 * comment for why PaymentIntent search is the equivalent, SDK-supported
 * correlation).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const search = vi.fn();
const subscriptionsRetrieve = vi.fn();

vi.mock('@/lib/stripe', () => ({
  stripe: {
    paymentIntents: { search: (...args: unknown[]) => search(...args) },
    subscriptions: { retrieve: (...args: unknown[]) => subscriptionsRetrieve(...args) },
  },
  PRICES: { proLifetime: 'price_lifetime_123' },
}));

import { verifyStripeLifetimePurchase, verifyStripeSubscriptionActive } from '@/lib/stripeEvidence';

beforeEach(() => {
  search.mockReset();
  subscriptionsRetrieve.mockReset();
});

function pi(overrides: Partial<{ id: string; status: string; metadata: Record<string, string> }>) {
  return { id: 'pi_1', status: 'succeeded', metadata: { userId: 'user-1', tier: 'pro', billing: 'lifetime' }, ...overrides };
}

describe('verifyStripeLifetimePurchase', () => {
  it('returns INCONCLUSIVE without calling Stripe when gascapUserId is null', async () => {
    const result = await verifyStripeLifetimePurchase(null);
    expect(result).toEqual({ status: 'INCONCLUSIVE', paymentIntentId: null });
    expect(search).not.toHaveBeenCalled();
  });

  it('a guest checkout (no stripeCustomerId at all) with a succeeded Lifetime PaymentIntent verifies VERIFIED_LIFETIME — the core Revision 6 fix', async () => {
    search.mockResolvedValue({ data: [pi({})], has_more: false });
    const result = await verifyStripeLifetimePurchase('user-1');
    expect(result).toEqual({ status: 'VERIFIED_LIFETIME', paymentIntentId: 'pi_1' });
  });

  it('correlates purely by metadata.userId — the search query never references stripeCustomerId', async () => {
    search.mockResolvedValue({ data: [pi({})], has_more: false });
    await verifyStripeLifetimePurchase('user-1');
    const queryArg = search.mock.calls[0][0].query;
    expect(queryArg).toContain("metadata['userId']:'user-1'");
  });

  it('a customer-backed Lifetime purchase also verifies VERIFIED_LIFETIME', async () => {
    search.mockResolvedValue({ data: [pi({ id: 'pi_2' })], has_more: false });
    const result = await verifyStripeLifetimePurchase('user-1');
    expect(result.status).toBe('VERIFIED_LIFETIME');
  });

  it('a non-succeeded PaymentIntent does not verify', async () => {
    search.mockResolvedValue({ data: [pi({ status: 'requires_payment_method' })], has_more: false });
    const result = await verifyStripeLifetimePurchase('user-1');
    expect(result.status).toBe('VERIFIED_NO_LIFETIME');
  });

  it('a succeeded PaymentIntent for a MONTHLY purchase (billing !== lifetime) does not verify', async () => {
    search.mockResolvedValue({ data: [pi({ metadata: { userId: 'user-1', tier: 'pro', billing: 'monthly' } })], has_more: false });
    const result = await verifyStripeLifetimePurchase('user-1');
    expect(result.status).toBe('VERIFIED_NO_LIFETIME');
  });

  it('no matching PaymentIntents at all reports VERIFIED_NO_LIFETIME (positively checked, not merely assumed)', async () => {
    search.mockResolvedValue({ data: [], has_more: false });
    const result = await verifyStripeLifetimePurchase('user-1');
    expect(result).toEqual({ status: 'VERIFIED_NO_LIFETIME', paymentIntentId: null });
  });

  it('a genuine Stripe API error reports INCONCLUSIVE, never VERIFIED_NO_LIFETIME', async () => {
    search.mockRejectedValue(new Error('Stripe API unavailable'));
    const result = await verifyStripeLifetimePurchase('user-1');
    expect(result).toEqual({ status: 'INCONCLUSIVE', paymentIntentId: null });
  });

  describe('pagination', () => {
    it('follows has_more/page across search result pages to find the Lifetime PaymentIntent on the second page', async () => {
      search
        .mockResolvedValueOnce({ data: [pi({ id: 'pi_1', metadata: { userId: 'user-1', tier: 'pro', billing: 'monthly' } })], has_more: true, next_page: 'page_cursor_1' })
        .mockResolvedValueOnce({ data: [pi({ id: 'pi_2' })], has_more: false });
      const result = await verifyStripeLifetimePurchase('user-1');
      expect(result).toEqual({ status: 'VERIFIED_LIFETIME', paymentIntentId: 'pi_2' });
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls[1][0]).toMatchObject({ page: 'page_cursor_1' });
    });

    it('does not miss a match past the first page — verifies 3 pages are followed before concluding VERIFIED_NO_LIFETIME', async () => {
      search
        .mockResolvedValueOnce({ data: [pi({ id: 'pi_1', metadata: { userId: 'user-1', tier: 'pro', billing: 'monthly' } })], has_more: true, next_page: 'cursor_1' })
        .mockResolvedValueOnce({ data: [pi({ id: 'pi_2', metadata: { userId: 'user-1', tier: 'pro', billing: 'monthly' } })], has_more: true, next_page: 'cursor_2' })
        .mockResolvedValueOnce({ data: [pi({ id: 'pi_3', metadata: { userId: 'user-1', tier: 'pro', billing: 'monthly' } })], has_more: false });
      const result = await verifyStripeLifetimePurchase('user-1');
      expect(result.status).toBe('VERIFIED_NO_LIFETIME');
      expect(search).toHaveBeenCalledTimes(3);
    });
  });
});

describe('verifyStripeSubscriptionActive — conservative status matrix for historical repair only', () => {
  it('returns INCONCLUSIVE without calling Stripe when subscriptionId is null', async () => {
    const result = await verifyStripeSubscriptionActive(null);
    expect(result).toBe('INCONCLUSIVE');
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  const matrix: { status: string; expected: 'VERIFIED_ACTIVE' | 'VERIFIED_INACTIVE' | 'INCONCLUSIVE' }[] = [
    { status: 'active', expected: 'VERIFIED_ACTIVE' },
    { status: 'trialing', expected: 'VERIFIED_ACTIVE' },
    { status: 'canceled', expected: 'VERIFIED_INACTIVE' },
    { status: 'unpaid', expected: 'VERIFIED_INACTIVE' },
    { status: 'incomplete', expected: 'VERIFIED_INACTIVE' },
    { status: 'incomplete_expired', expected: 'VERIFIED_INACTIVE' },
    { status: 'paused', expected: 'VERIFIED_INACTIVE' },
    { status: 'past_due', expected: 'INCONCLUSIVE' },
  ];

  for (const { status, expected } of matrix) {
    it(`status "${status}" => ${expected}`, async () => {
      subscriptionsRetrieve.mockResolvedValue({ status });
      const result = await verifyStripeSubscriptionActive('sub_1');
      expect(result).toBe(expected);
    });
  }

  it('an unrecognized future status is INCONCLUSIVE, not guessed either way', async () => {
    subscriptionsRetrieve.mockResolvedValue({ status: 'some_future_status_not_yet_documented' });
    const result = await verifyStripeSubscriptionActive('sub_1');
    expect(result).toBe('INCONCLUSIVE');
  });

  it('a retrieval failure reports INCONCLUSIVE, never a guess', async () => {
    subscriptionsRetrieve.mockRejectedValue(new Error('not found'));
    const result = await verifyStripeSubscriptionActive('sub_1');
    expect(result).toBe('INCONCLUSIVE');
  });
});
