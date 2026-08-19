/**
 * Revision 3/5 P0 — verified, tri-state, paginated Stripe Lifetime purchase
 * evidence, replacing the insufficient `stripeCustomerId +
 * stripeInterval==='lifetime'` heuristic and the earlier boolean-only design
 * that collapsed a Stripe API failure into "not verified."
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const listSessions = vi.fn();
const listLineItems = vi.fn();

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: {
        list: (...args: unknown[]) => listSessions(...args),
        listLineItems: (...args: unknown[]) => listLineItems(...args),
      },
    },
  },
  PRICES: { proLifetime: 'price_lifetime_123' },
}));

import { verifyStripeLifetimePurchase } from '@/lib/stripeEvidence';

beforeEach(() => {
  listSessions.mockReset();
  listLineItems.mockReset();
});

describe('verifyStripeLifetimePurchase', () => {
  it('returns INCONCLUSIVE without calling Stripe when stripeCustomerId is null', async () => {
    const result = await verifyStripeLifetimePurchase(null);
    expect(result).toEqual({ status: 'INCONCLUSIVE', sessionId: null });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('a completed payment-mode session with a Lifetime line item verifies VERIFIED_LIFETIME', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }], has_more: false });
    listLineItems.mockResolvedValue({ data: [{ price: { id: 'price_lifetime_123' } }], has_more: false });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ status: 'VERIFIED_LIFETIME', sessionId: 'cs_1' });
  });

  it('a session in subscription mode (not "payment") does not verify — reports VERIFIED_NO_LIFETIME', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'subscription', payment_status: 'paid' }], has_more: false });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result.status).toBe('VERIFIED_NO_LIFETIME');
    expect(listLineItems).not.toHaveBeenCalled();
  });

  it('an unpaid payment-mode session does not verify — reports VERIFIED_NO_LIFETIME', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'unpaid' }], has_more: false });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result.status).toBe('VERIFIED_NO_LIFETIME');
    expect(listLineItems).not.toHaveBeenCalled();
  });

  it('a paid payment-mode session whose line items do NOT include the Lifetime price reports VERIFIED_NO_LIFETIME — the exact scenario a bare stripeCustomerId cannot distinguish', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }], has_more: false });
    listLineItems.mockResolvedValue({ data: [{ price: { id: 'price_some_other_thing' } }], has_more: false });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ status: 'VERIFIED_NO_LIFETIME', sessionId: null });
  });

  it('no sessions at all reports VERIFIED_NO_LIFETIME (positively checked, not merely assumed)', async () => {
    listSessions.mockResolvedValue({ data: [], has_more: false });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ status: 'VERIFIED_NO_LIFETIME', sessionId: null });
  });

  it('a genuine Stripe API error on the session list reports INCONCLUSIVE, never VERIFIED_NO_LIFETIME', async () => {
    listSessions.mockRejectedValue(new Error('Stripe API unavailable'));
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ status: 'INCONCLUSIVE', sessionId: null });
  });

  it('a Stripe API error on line-item pagination reports INCONCLUSIVE, not VERIFIED_NO_LIFETIME, even though the session list itself succeeded', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }], has_more: false });
    listLineItems.mockRejectedValue(new Error('line items unavailable'));
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result.status).toBe('INCONCLUSIVE');
  });

  describe('pagination', () => {
    it('follows has_more/starting_after across session list pages to find a Lifetime purchase on the second page', async () => {
      listSessions
        .mockResolvedValueOnce({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }], has_more: true })
        .mockResolvedValueOnce({ data: [{ id: 'cs_2', mode: 'payment', payment_status: 'paid' }], has_more: false });
      listLineItems
        .mockResolvedValueOnce({ data: [{ price: { id: 'price_some_other_thing' } }], has_more: false })
        .mockResolvedValueOnce({ data: [{ price: { id: 'price_lifetime_123' } }], has_more: false });
      const result = await verifyStripeLifetimePurchase('cus_1');
      expect(result).toEqual({ status: 'VERIFIED_LIFETIME', sessionId: 'cs_2' });
      expect(listSessions).toHaveBeenCalledTimes(2);
      expect(listSessions.mock.calls[1][0]).toMatchObject({ starting_after: 'cs_1' });
    });

    it('does not miss a session-101+ purchase — verifies at least 3 pages are followed', async () => {
      listSessions
        .mockResolvedValueOnce({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }], has_more: true })
        .mockResolvedValueOnce({ data: [{ id: 'cs_2', mode: 'payment', payment_status: 'paid' }], has_more: true })
        .mockResolvedValueOnce({ data: [{ id: 'cs_3', mode: 'payment', payment_status: 'paid' }], has_more: false });
      listLineItems.mockResolvedValue({ data: [{ price: { id: 'price_lifetime_123' } }], has_more: false });
      // Non-matching first two, matching on the third page — proves all 3 pages are actually consulted in order.
      listLineItems
        .mockResolvedValueOnce({ data: [{ price: { id: 'price_other' } }], has_more: false })
        .mockResolvedValueOnce({ data: [{ price: { id: 'price_other' } }], has_more: false })
        .mockResolvedValueOnce({ data: [{ price: { id: 'price_lifetime_123' } }], has_more: false });
      const result = await verifyStripeLifetimePurchase('cus_1');
      expect(result).toEqual({ status: 'VERIFIED_LIFETIME', sessionId: 'cs_3' });
      expect(listSessions).toHaveBeenCalledTimes(3);
    });

    it('follows has_more/starting_after across a single session\'s line-item pages to find the Lifetime price', async () => {
      listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }], has_more: false });
      listLineItems
        .mockResolvedValueOnce({ data: [{ id: 'li_1', price: { id: 'price_other' } }], has_more: true })
        .mockResolvedValueOnce({ data: [{ id: 'li_2', price: { id: 'price_lifetime_123' } }], has_more: false });
      const result = await verifyStripeLifetimePurchase('cus_1');
      expect(result).toEqual({ status: 'VERIFIED_LIFETIME', sessionId: 'cs_1' });
      expect(listLineItems).toHaveBeenCalledTimes(2);
      expect(listLineItems.mock.calls[1][1]).toMatchObject({ starting_after: 'li_1' });
    });
  });
});
