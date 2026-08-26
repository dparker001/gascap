/**
 * Phase 5B — Feedback Campaign $9.99 Lifetime offer (web/Stripe side).
 *
 * Deliberately mirrors lib/winbackOffer.ts / lib/foundingPromo.ts: reuse the
 * SAME existing $19.99 Lifetime Stripe Price plus a Stripe Coupon to reach
 * $9.99, rather than creating a second Price object. Eligibility itself
 * lives in lib/feedbackCampaign.ts's getLifetimeOfferStatus() — this file is
 * only the Stripe coupon-ID constant, following the exact convention
 * WINBACK_LIFETIME_COUPON/FOUNDING_LIFETIME_COUPON already established.
 *
 * MANUAL SETUP REQUIRED BEFORE THIS OFFER CAN ACTUALLY BE USED: this coupon
 * ID must exist in Stripe (a "$10 off, once" coupon, same shape as the
 * win-back coupon) before any checkout requesting it will succeed — Stripe
 * returns an error creating a Checkout Session with a coupon ID that
 * doesn't exist. No code here creates that coupon; per Phase 5B
 * instructions, no live Stripe object is created without explicit
 * authorization. Until it's created (or STRIPE_FEEDBACK_LIFETIME_COUPON is
 * set to a real existing coupon ID), the feedback offer checkout path fails
 * closed with a 503, the same way every other missing-secret path in this
 * codebase does — never a silent full-price fallback.
 */
export const FEEDBACK_LIFETIME_COUPON =
  process.env.STRIPE_FEEDBACK_LIFETIME_COUPON ?? null;

export const FEEDBACK_LIFETIME_DISCOUNT_USD = 10;
export const FEEDBACK_LIFETIME_PRICE_USD = 9.99;
