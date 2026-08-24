/**
 * Provider-neutral Lifetime audit (2026-08-24) — regression coverage for
 * pure eligibility functions that previously checked `stripeInterval`
 * only, meaning a RevenueCat (native IAP) Lifetime owner would incorrectly
 * still be shown an offer meant only for non-Lifetime users. See
 * docs/reviews/2026-08-24-lifetime-entitlement-check-gap.md.
 */
import { describe, it, expect } from 'vitest';
import { winbackEligible } from '@/lib/winbackOffer';
import { newMemberOfferStatus } from '@/lib/newMemberOffer';
import { getawayOfferStatus } from '@/lib/getawayPromo';

describe('winbackEligible — provider-neutral Lifetime exclusion', () => {
  it('excludes a RevenueCat Lifetime owner even if plan were somehow free', () => {
    // plan='free' alone already excludes a real RC Lifetime owner in practice
    // (their plan is always 'pro'), but the check itself must still be
    // correct in isolation.
    expect(winbackEligible({
      plan: 'free', stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'lifetime',
      emailCampaignEnrolledAt: '2026-01-01T00:00:00.000Z',
    })).toBe(false);
  });

  it('still excludes a Stripe/gift Lifetime owner', () => {
    expect(winbackEligible({
      plan: 'free', stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null,
      emailCampaignEnrolledAt: '2026-01-01T00:00:00.000Z',
    })).toBe(false);
  });

  it('still allows a genuinely lapsed free user through', () => {
    expect(winbackEligible({
      plan: 'free', stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
      emailCampaignEnrolledAt: '2026-01-01T00:00:00.000Z',
    })).toBe(true);
  });
});

describe('newMemberOfferStatus — provider-neutral Lifetime exclusion', () => {
  const recentSignup = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it('excludes a RevenueCat Lifetime owner within their first 7 days', () => {
    const status = newMemberOfferStatus({
      createdAt: recentSignup, stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'lifetime',
    });
    expect(status.eligible).toBe(false);
  });

  it('still excludes a Stripe/gift Lifetime owner', () => {
    const status = newMemberOfferStatus({
      createdAt: recentSignup, stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null,
    });
    expect(status.eligible).toBe(false);
  });

  it('still allows a genuinely new, non-Lifetime signup', () => {
    const status = newMemberOfferStatus({
      createdAt: recentSignup, stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
    });
    expect(status.eligible).toBe(true);
  });
});

describe('getawayOfferStatus — provider-neutral Lifetime exclusion', () => {
  it('marks a RevenueCat Lifetime owner as already-Lifetime (not eligible for the "buy to get" enticement)', () => {
    const status = getawayOfferStatus({ stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'lifetime' });
    expect(status.eligible).toBe(false);
  });

  it('still marks a Stripe/gift Lifetime owner as already-Lifetime', () => {
    const status = getawayOfferStatus({ stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null });
    expect(status.eligible).toBe(false);
  });

  it('still marks a genuinely non-Lifetime user as eligible while the promo is active', () => {
    const status = getawayOfferStatus({ stripeInterval: null, revenueCatActive: false, revenueCatInterval: null });
    expect(status.eligible).toBe(status.active); // eligible iff the promo itself is active
  });

  it('RevenueCat Monthly (not Lifetime) does not count as already-Lifetime', () => {
    const status = getawayOfferStatus({ stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'monthly' });
    expect(status.eligible).toBe(status.active);
  });
});
