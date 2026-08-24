/**
 * Provider-neutral Lifetime audit (2026-08-24) — getActiveCredits() in
 * lib/users.ts previously only hid stale free-month referral credits for a
 * Stripe/gift Lifetime member (`stripeInterval === 'lifetime'`). A
 * RevenueCat (native IAP) Lifetime member — who also has no recurring
 * subscription to apply a free-month credit to — would keep seeing these
 * stale, functionally-useless credits on the Rewards page. See
 * docs/reviews/2026-08-24-lifetime-entitlement-check-gap.md.
 */
import { describe, it, expect } from 'vitest';
import { getActiveCredits } from '@/lib/users';
import type { StoredUser } from '@/lib/users';

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

function baseUser(overrides: Partial<StoredUser>): StoredUser {
  return {
    id: 'u1', email: 'u1@example.com', name: 'U1', plan: 'pro', createdAt: '2026-01-01T00:00:00.000Z',
    referralCredits: [{ redeemedAt: null, expiresAt: future } as StoredUser['referralCredits'] extends (infer T)[] ? T : never],
    ...overrides,
  } as StoredUser;
}

describe('getActiveCredits — provider-neutral Lifetime exclusion', () => {
  it('hides active credits for a RevenueCat (native IAP) Lifetime member', () => {
    const user = baseUser({ stripeInterval: undefined, revenueCatActive: true, revenueCatInterval: 'lifetime' });
    expect(getActiveCredits(user)).toEqual([]);
  });

  it('still hides active credits for a Stripe/gift Lifetime member', () => {
    const user = baseUser({ stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null });
    expect(getActiveCredits(user)).toEqual([]);
  });

  it('still shows active, unexpired credits for a non-Lifetime Monthly member', () => {
    const user = baseUser({ stripeInterval: 'monthly', revenueCatActive: false, revenueCatInterval: null });
    expect(getActiveCredits(user)).toHaveLength(1);
  });

  it('RevenueCat Monthly (not Lifetime) still shows active credits', () => {
    const user = baseUser({ stripeInterval: undefined, revenueCatActive: true, revenueCatInterval: 'monthly' });
    expect(getActiveCredits(user)).toHaveLength(1);
  });
});
