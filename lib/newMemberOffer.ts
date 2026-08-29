/**
 * New-member 7-day Lifetime offer.
 *
 * New users — within 7 days of signup, not already on Lifetime — can buy Pro
 * Lifetime at a $10 discount ($9.99 instead of $19.99, 50% off). Eligibility
 * is computed server-side from the account's createdAt, so there's no coupon
 * code to share and the discount can't be abused via a copied checkout link.
 */
import { hasLifetimeEntitlement } from './entitlements';

// Stripe coupon: "$10 off, once". Applied server-side ONLY, on the Lifetime
// checkout, and ONLY for eligible users (see app/api/stripe/checkout/route.ts).
// Not secret; overridable via env if the coupon is ever recreated.
// "$10 off, once" → $19.99 Lifetime becomes $9.99 (50% off).
export const NEW_MEMBER_LIFETIME_COUPON =
  process.env.STRIPE_NEW_MEMBER_COUPON ?? 'BrVUrcM7';

export const NEW_MEMBER_OFFER_DAYS  = 7;
export const NEW_MEMBER_DISCOUNT_USD = 10;

export interface NewMemberOfferStatus {
  eligible: boolean;
  daysLeft: number;
}

/**
 * Is this user inside the 7-day new-member Lifetime window?
 * Excludes anyone already on Lifetime. `createdAt` is an ISO string.
 */
export function newMemberOfferStatus(user: {
  createdAt?: string | null;
  stripeInterval?: string | null;
  revenueCatActive?: boolean;
  revenueCatInterval?: string | null;
}): NewMemberOfferStatus {
  // Already Lifetime → nothing to offer. Provider-neutral — a RevenueCat
  // (native IAP) Lifetime purchaser within their first 7 days would
  // otherwise still be shown this discount despite already owning
  // Lifetime (see lib/entitlements.ts's PROVENANCE INVARIANT; found via
  // the 2026-08-24 provider-neutral audit).
  if (hasLifetimeEntitlement({
    stripeInterval:     user.stripeInterval     ?? null,
    revenueCatActive:   user.revenueCatActive   ?? false,
    revenueCatInterval: user.revenueCatInterval ?? null,
  })) return { eligible: false, daysLeft: 0 };
  if (!user.createdAt) return { eligible: false, daysLeft: 0 };

  const createdMs = new Date(user.createdAt).getTime();
  if (Number.isNaN(createdMs)) return { eligible: false, daysLeft: 0 };

  const elapsedDays = (Date.now() - createdMs) / 86_400_000;
  const daysLeft    = Math.ceil(NEW_MEMBER_OFFER_DAYS - elapsedDays);

  return { eligible: daysLeft > 0, daysLeft: Math.max(0, daysLeft) };
}
