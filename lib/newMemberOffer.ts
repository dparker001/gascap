/**
 * New-member 7-day Lifetime offer.
 *
 * New users — within 7 days of signup, not already on Lifetime — can buy Pro
 * Lifetime at a $5 discount ($14.99 instead of $19.99). Eligibility is computed
 * server-side from the account's createdAt, so there's no coupon code to share
 * and the discount can't be abused via a copied checkout link.
 */

// Stripe coupon: "$5 off, once". Applied server-side ONLY, on the Lifetime
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
}): NewMemberOfferStatus {
  // Already Lifetime → nothing to offer
  if (user.stripeInterval === 'lifetime') return { eligible: false, daysLeft: 0 };
  if (!user.createdAt) return { eligible: false, daysLeft: 0 };

  const createdMs = new Date(user.createdAt).getTime();
  if (Number.isNaN(createdMs)) return { eligible: false, daysLeft: 0 };

  const elapsedDays = (Date.now() - createdMs) / 86_400_000;
  const daysLeft    = Math.ceil(NEW_MEMBER_OFFER_DAYS - elapsedDays);

  return { eligible: daysLeft > 0, daysLeft: Math.max(0, daysLeft) };
}
