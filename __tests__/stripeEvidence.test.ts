/**
 * Revision 3/4 P0 — verified Stripe Lifetime purchase evidence, replacing
 * the insufficient `stripeCustomerId + stripeInterval==='lifetime'` heuristic.
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
  it('returns not-verified without calling Stripe when stripeCustomerId is null', async () => {
    const result = await verifyStripeLifetimePurchase(null);
    expect(result).toEqual({ verified: false, sessionId: null });
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('a completed payment-mode session with a Lifetime line item verifies true', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }] });
    listLineItems.mockResolvedValue({ data: [{ price: { id: 'price_lifetime_123' } }] });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ verified: true, sessionId: 'cs_1' });
  });

  it('a session in subscription mode (not "payment") does not verify, even if paid', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'subscription', payment_status: 'paid' }] });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result.verified).toBe(false);
    expect(listLineItems).not.toHaveBeenCalled();
  });

  it('an unpaid payment-mode session does not verify', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'unpaid' }] });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result.verified).toBe(false);
    expect(listLineItems).not.toHaveBeenCalled();
  });

  it('a paid payment-mode session whose line items do NOT include the Lifetime price does not verify — the exact scenario a bare stripeCustomerId cannot distinguish (e.g. billing-portal-only customer, or a paid non-Lifetime purchase)', async () => {
    listSessions.mockResolvedValue({ data: [{ id: 'cs_1', mode: 'payment', payment_status: 'paid' }] });
    listLineItems.mockResolvedValue({ data: [{ price: { id: 'price_some_other_thing' } }] });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ verified: false, sessionId: null });
  });

  it('no sessions at all returns not-verified', async () => {
    listSessions.mockResolvedValue({ data: [] });
    const result = await verifyStripeLifetimePurchase('cus_1');
    expect(result).toEqual({ verified: false, sessionId: null });
  });

  it('propagates a genuine Stripe API error rather than treating it as not-verified', async () => {
    listSessions.mockRejectedValue(new Error('Stripe API unavailable'));
    await expect(verifyStripeLifetimePurchase('cus_1')).rejects.toThrow('Stripe API unavailable');
  });
});
