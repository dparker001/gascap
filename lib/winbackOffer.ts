/**
 * Win-back Lifetime offer.
 *
 * Free users whose Pro trial has expired can buy Pro Lifetime at 50% off
 * ($9.99 instead of $19.99) via the "come back to Pro" campaign. Eligibility is
 * computed server-side from the account (plan='free', had a trial that's now in
 * the past), so there's no shareable code and the discount can't be abused by a
 * copied checkout link. The win-back emails link to /upgrade?wb=1, which asks
 * the server to apply this coupon — the server re-validates eligibility.
 */

// Stripe coupon: "$10 off, once" → $19.99 Lifetime becomes $9.99 (50% off).
// Applied server-side ONLY, on the Lifetime checkout, ONLY for eligible users
// (see app/api/stripe/checkout/route.ts). Not secret; overridable via env.
export const WINBACK_LIFETIME_COUPON =
  process.env.STRIPE_WINBACK_COUPON ?? 'hV3LWKzw';

export const WINBACK_DISCOUNT_USD = 10;
export const WINBACK_PRICE_USD    = 9.99;
export const WINBACK_STEPS        = 3;     // number of emails in the sequence
export const WINBACK_GAP_DAYS     = 4;     // days between sequence steps

export interface WinbackUser {
  plan?:           string | null;
  stripeInterval?: string | null;
  isProTrial?:     boolean;
  trialExpiresAt?: string | null;
}

/**
 * Is this a lapsed free user (had a Pro trial that has since expired)?
 * Excludes anyone already on Lifetime or an active trial.
 */
export function winbackEligible(user: WinbackUser): boolean {
  if (user.stripeInterval === 'lifetime') return false; // already owns Lifetime
  if (user.plan !== 'free')               return false; // only lapsed free users
  if (user.isProTrial)                    return false; // not an active trial
  if (!user.trialExpiresAt)               return false; // must have had a trial
  const ms = new Date(user.trialExpiresAt).getTime();
  if (Number.isNaN(ms)) return false;
  return ms < Date.now();                                // trial is in the past
}
