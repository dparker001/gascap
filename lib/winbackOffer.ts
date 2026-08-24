import { hasLifetimeEntitlement } from './entitlements';

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
// Days between sequence steps. Was 1 (three emails on consecutive days), which
// made sense when the deadline was a rolling 3-day per-user window. With a
// fixed end-of-August deadline, a 3-day burst would land the "last call" email
// ~20 days before the offer actually closes. At 10 days the three emails spread
// across the campaign and step 3 arrives near the real deadline.
export const WINBACK_GAP_DAYS     = 10;

/**
 * Hard campaign deadline for the $9.99 price — replaces the old rolling
 * per-user 3-day window. Everyone eligible gets the same end date, so the
 * emails can name a real calendar date instead of "3 days from whenever
 * your first email happened to land."
 *
 * Override in Railway (WINBACK_END_DATE) to extend or end it early without a
 * deploy. Expressed in ET, the business's timezone.
 */
export const WINBACK_END_DATE =
  process.env.WINBACK_END_DATE ?? '2026-08-31T23:59:59-04:00';

/**
 * Should users whose sequence STALLED long ago be resumed mid-sequence?
 *
 * 181 users received step 1 on 2026-06-15 and then froze, because the old
 * per-user 3-day window closed before the next send. Moving to a campaign-wide
 * deadline silently made all of them eligible again — one cron run would have
 * sent 181 step-2 emails referencing an offer they last heard about two months
 * ago. Off by default so that can't happen unintentionally; set
 * WINBACK_RESUME_STALLED=true in Railway to deliberately re-engage them.
 */
export const WINBACK_RESUME_STALLED = process.env.WINBACK_RESUME_STALLED === 'true';

/** A sequence is "stalled" if its last email predates the current campaign. */
export function winbackStalled(lastSentAt?: string | null): boolean {
  if (!lastSentAt) return false;
  const ms = new Date(lastSentAt).getTime();
  if (Number.isNaN(ms)) return false;
  return (Date.now() - ms) > 30 * 86_400_000;
}

/** Human-readable deadline for email copy, e.g. "August 31". */
export function winbackDeadlineLabel(locale: 'en' | 'es' = 'en'): string {
  const d = new Date(WINBACK_END_DATE);
  if (Number.isNaN(d.getTime())) return locale === 'es' ? 'pronto' : 'soon';
  return d.toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'long', day: 'numeric', timeZone: 'America/New_York',
  });
}

/** Whole days remaining before the offer closes (0 once it has passed). */
export function winbackDaysLeft(): number {
  const ms = new Date(WINBACK_END_DATE).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

export interface WinbackUser {
  plan?:                    string | null;
  stripeInterval?:          string | null;
  revenueCatActive?:        boolean;
  revenueCatInterval?:      string | null;
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
  // Provider-neutral — a RevenueCat (native IAP) Lifetime owner already owns
  // Lifetime just as much as a Stripe/gift one (see lib/entitlements.ts).
  // In practice `plan !== 'free'` below already excludes any active
  // RevenueCat Lifetime owner (their plan is 'pro', never 'free'), so this
  // is defense-in-depth / correctness rather than a live exploitable gap —
  // fixed for consistency per the 2026-08-24 provider-neutral audit.
  if (hasLifetimeEntitlement({
    stripeInterval:     user.stripeInterval     ?? null,
    revenueCatActive:   user.revenueCatActive   ?? false,
    revenueCatInterval: user.revenueCatInterval ?? null,
  })) return false;
  if (user.plan !== 'free')               return false; // only lapsed free users
  const wentThroughTrial =
    !!user.emailCampaignEnrolledAt || (user.emailCampaignStep ?? 0) >= 5;
  return wentThroughTrial;
}

/**
 * Is the $9.99 offer still open? A single campaign-wide deadline
 * (WINBACK_END_DATE) rather than the old rolling per-user 3-day window, so
 * every eligible user sees the same end date and the emails can name a real
 * calendar date. Takes an optional user arg purely to keep the old call
 * signature working at existing call sites.
 */
export function winbackOfferActive(_user?: WinbackUser): boolean {
  const end = new Date(WINBACK_END_DATE).getTime();
  if (Number.isNaN(end)) return false; // malformed env value → fail closed
  return Date.now() < end;
}

/** Targeted AND before the campaign deadline — the gate for showing/applying the offer. */
export function winbackOfferAvailable(user: WinbackUser): boolean {
  return winbackEligible(user) && winbackOfferActive(user);
}
