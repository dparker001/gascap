/**
 * Post-Revision-3 fix — verified Stripe Lifetime purchase evidence.
 *
 * The historical reconciliation previously treated `stripeCustomerId`
 * present + no `stripeSubscriptionId` + `stripeInterval === 'lifetime'` as
 * proof of a genuine Stripe Lifetime purchase. That's not sufficient
 * evidence: `stripeCustomerId` gets attached to a User row whenever they
 * merely open Stripe's billing-portal ("Manage Billing"), with no purchase
 * involved (see `lib/users.ts`'s `isRealPurchaseOrRenewal` guard, added
 * specifically because this already caused a real bug — a trial user who
 * only opened billing management had their trial silently and permanently
 * wiped). Combined with historical RevenueCat code having separately
 * written `stripeInterval='lifetime'`, `stripeCustomerId` +
 * `stripeInterval==='lifetime'` can exist with NO Stripe Lifetime purchase
 * behind it at all.
 *
 * This checks for an ACTUAL completed Stripe Checkout Session for the
 * Lifetime price, which is real, verifiable purchase evidence Stripe itself
 * recorded — not an inference from unrelated fields.
 */

import { stripe, PRICES } from '@/lib/stripe';

export interface StripeLifetimeEvidence {
  /** True only if a completed, paid Checkout Session for the Lifetime price was found. */
  verified: boolean;
  /** The Checkout Session id, if verified — for audit-trail purposes. */
  sessionId: string | null;
}

/**
 * Look for a genuine completed Stripe Checkout Session for the GasCap Pro
 * Lifetime price under the given customer. Read-only (list calls only).
 *
 * Returns `{ verified: false, sessionId: null }` — NOT a thrown error — if
 * Stripe isn't configured, the customer id is empty, or no matching session
 * is found. Callers should treat "not verified" as "cannot confirm a Stripe
 * Lifetime purchase from this evidence," not as "confirmed NOT a purchase."
 *
 * Throws only on a genuine Stripe API error (network/auth failure) — same
 * discipline as `lib/revenueCatApi.ts`: a lookup failure must never be
 * silently treated as "not verified."
 */
export async function verifyStripeLifetimePurchase(stripeCustomerId: string | null): Promise<StripeLifetimeEvidence> {
  if (!stripeCustomerId || !stripe || !PRICES.proLifetime) {
    return { verified: false, sessionId: null };
  }

  const sessions = await stripe.checkout.sessions.list({
    customer: stripeCustomerId,
    limit: 100,
  });

  for (const session of sessions.data) {
    if (session.mode !== 'payment' || session.payment_status !== 'paid') continue;
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
    const hasLifetimeLine = lineItems.data.some((li) => li.price?.id === PRICES.proLifetime);
    if (hasLifetimeLine) {
      return { verified: true, sessionId: session.id };
    }
  }

  return { verified: false, sessionId: null };
}
