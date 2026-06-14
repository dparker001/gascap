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
export const WINBACK_GAP_DAYS     = 1;     // days between sequence steps (day 0,1,2)
export const WINBACK_WINDOW_DAYS  = 3;     // offer expires 3 days after a user's 1st email

export interface WinbackUser {
  plan?:                    string | null;
  stripeInterval?:          string | null;
  emailCampaignEnrolledAt?: string | null;
  emailCampaignStep?:       number | null;
  winbackStartedAt?:        string | null;
}

/**
 * Is this a lapsed free user (completed the Pro trial, now on the free plan)?
 * This is the TARGETING check (who belongs in the campaign), independent of the
 * time-limited deadline (see winbackOfferActive).
 *
 * NOTE: trial expiry clears `trialExpiresAt`, so we CANNOT detect lapsed trials
 * by that field — every expired-trial user has it nulled. Instead we use the
 * trial-drip enrollment: anyone who was enrolled in the 5-step trial campaign
 * (emailCampaignEnrolledAt set, or reached the final step) and is now on the
 * free plan went through a Pro trial and lapsed. Active trials are plan='pro',
 * so plan='free' already excludes them; Lifetime owners are excluded too.
 */
export function winbackEligible(user: WinbackUser): boolean {
  if (user.stripeInterval === 'lifetime') return false; // already owns Lifetime
  if (user.plan !== 'free')               return false; // only lapsed free users
  const wentThroughTrial =
    !!user.emailCampaignEnrolledAt || (user.emailCampaignStep ?? 0) >= 5;
  return wentThroughTrial;
}

/**
 * Is the $9.99 deadline still open for this user? The offer is a real 3-day
 * window starting at their FIRST win-back email (winbackStartedAt). Before the
 * sequence starts (winbackStartedAt null) the offer is open — so the in-app
 * banner / checkout work for anyone eligible until their clock starts ticking.
 */
export function winbackOfferActive(user: WinbackUser): boolean {
  const started = user.winbackStartedAt;
  if (!started) return true; // not started yet → still claimable
  const ms = new Date(started).getTime();
  if (Number.isNaN(ms)) return true;
  return (Date.now() - ms) < WINBACK_WINDOW_DAYS * 86_400_000;
}

/** Targeted AND within the 3-day deadline — the gate for showing/applying the offer. */
export function winbackOfferAvailable(user: WinbackUser): boolean {
  return winbackEligible(user) && winbackOfferActive(user);
}
