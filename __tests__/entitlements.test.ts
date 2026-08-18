/**
 * Table-driven tests for the centralized entitlement resolver — the fix for
 * the reconciliation gap found during Sprint 2 inspection: a RevenueCat
 * webhook could revert a user to free with no awareness that a Stripe
 * subscription, a Lifetime purchase, a gift, or Ambassador status still
 * legitimately entitled them to Pro.
 *
 * Pure function, no mocks needed — see lib/entitlements.ts.
 */
import { describe, it, expect } from 'vitest';
import { resolveUserEntitlements, type EntitlementInput } from '../lib/entitlements';

const NOW = new Date('2026-08-19T12:00:00Z').getTime();

const BASE: EntitlementInput = {
  ambassadorProForLife: false,
  stripeInterval:       null,
  stripeSubscriptionId: null,
  revenueCatActive:     false,
  revenueCatInterval:   null,
  isProTrial:           false,
  trialExpiresAt:       null,
};

function resolve(overrides: Partial<EntitlementInput>) {
  return resolveUserEntitlements({ ...BASE, ...overrides }, NOW);
}

describe('resolveUserEntitlements — the combinations from the Sprint 2 brief', () => {
  it('Stripe monthly active + RevenueCat expiration → Pro', () => {
    // "RevenueCat expiration" is modeled as revenueCatActive already cleared
    // by the caller (revokeRevenueCatEntitlement clears it BEFORE resolving)
    // — this is the state the resolver sees after that clear.
    const r = resolve({ stripeSubscriptionId: 'sub_123', revenueCatActive: false });
    expect(r.pro).toBe(true);
    expect(r.sources).toEqual(['stripe_subscription']);
    expect(r.permanent).toBe(false);
  });

  it('RevenueCat monthly active + Stripe deletion → Pro', () => {
    const r = resolve({ stripeSubscriptionId: null, revenueCatActive: true, revenueCatInterval: 'monthly' });
    expect(r.pro).toBe(true);
    expect(r.sources).toEqual(['revenuecat']);
  });

  it('Stripe lifetime + RevenueCat refund → Pro (permanent)', () => {
    const r = resolve({ stripeInterval: 'lifetime', revenueCatActive: false });
    expect(r.pro).toBe(true);
    expect(r.permanent).toBe(true);
    expect(r.sources).toEqual(['stripe_or_gift_lifetime']);
    expect(r.effectiveInterval).toBe('lifetime');
  });

  it('Ambassador Pro-for-Life + all paid subscriptions expire → Pro', () => {
    const r = resolve({ ambassadorProForLife: true, stripeSubscriptionId: null, revenueCatActive: false });
    expect(r.pro).toBe(true);
    expect(r.permanent).toBe(true);
    expect(r.sources).toEqual(['ambassador']);
  });

  it('No entitlement + expired trial → Free', () => {
    const r = resolve({ isProTrial: true, trialExpiresAt: '2020-01-01T00:00:00.000Z' });
    expect(r.pro).toBe(false);
    expect(r.trial).toBe(false);
  });

  it('Gifted lifetime + Stripe failure → Pro', () => {
    // Gifted lifetime is indistinguishable in the schema from a real Stripe
    // lifetime purchase (see lib/entitlements.ts header) — both set
    // stripeInterval='lifetime'. That is itself documented as a known
    // limitation, not something this test papers over.
    const r = resolve({ stripeInterval: 'lifetime', stripeSubscriptionId: null });
    expect(r.pro).toBe(true);
    expect(r.permanent).toBe(true);
  });
});

describe('resolveUserEntitlements — additional coverage', () => {
  it('nothing at all → Free, no sources', () => {
    const r = resolve({});
    expect(r.pro).toBe(false);
    expect(r.sources).toEqual([]);
    expect(r.effectiveInterval).toBeNull();
  });

  it('active trial alone → Pro, not permanent, not a "source" in the durable sense', () => {
    const r = resolve({ isProTrial: true, trialExpiresAt: new Date(NOW + 86_400_000).toISOString() });
    expect(r.pro).toBe(true);
    expect(r.trial).toBe(true);
    expect(r.permanent).toBe(false);
    expect(r.sources).toEqual([]);
  });

  it('trial does not override or hide a paid permanent source', () => {
    const r = resolve({
      ambassadorProForLife: true,
      isProTrial: true,
      trialExpiresAt: new Date(NOW + 86_400_000).toISOString(),
    });
    expect(r.pro).toBe(true);
    expect(r.permanent).toBe(true);
    expect(r.sources).toEqual(['ambassador']);
  });

  it('multiple simultaneous sources all appear', () => {
    const r = resolve({
      ambassadorProForLife: true,
      stripeSubscriptionId: 'sub_1',
      revenueCatActive: true,
      revenueCatInterval: 'monthly',
    });
    expect(r.pro).toBe(true);
    expect(r.permanent).toBe(true); // ambassador alone makes it permanent
    expect(r.sources).toEqual(['ambassador', 'stripe_subscription', 'revenuecat']);
  });

  it('RevenueCat lifetime alone sets effectiveInterval to lifetime even though nothing is "permanent"', () => {
    // Not flagged `permanent` because a RevenueCat non-consumable CAN still
    // be refunded (REFUND event) — 'permanent' here specifically means "has
    // no natural expiry", which only ambassador/stripe-lifetime satisfy in
    // this model. This is a deliberate, narrower definition than "lifetime
    // product" — documented via this test rather than only in a comment.
    const r = resolve({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
    expect(r.pro).toBe(true);
    expect(r.permanent).toBe(false);
    expect(r.effectiveInterval).toBe('lifetime');
  });

  it('an expired trial with no other source is indistinguishable from never having one', () => {
    const withExpiredTrial = resolve({ isProTrial: true, trialExpiresAt: '2020-01-01T00:00:00.000Z' });
    const withNoTrialFlag  = resolve({ isProTrial: false, trialExpiresAt: null });
    expect(withExpiredTrial).toEqual(withNoTrialFlag);
  });

  it('isProTrial=true with no trialExpiresAt does not count as an active trial', () => {
    const r = resolve({ isProTrial: true, trialExpiresAt: null });
    expect(r.trial).toBe(false);
    expect(r.pro).toBe(false);
  });

  it('a trial expiring at exactly `now` is treated as expired, not active', () => {
    const r = resolve({ isProTrial: true, trialExpiresAt: new Date(NOW).toISOString() });
    expect(r.trial).toBe(false);
  });
});
