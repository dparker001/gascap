/**
 * Post-Revision-3/5/6 fix — verified, tri-state, paginated, guest-checkout-
 * safe Stripe Lifetime purchase evidence, plus a conservative live Stripe
 * subscription status check for historical plan repairs only.
 *
 * WHY THIS EXISTS: the historical reconciliation previously treated
 * `stripeCustomerId` present + no `stripeSubscriptionId` + `stripeInterval
 * === 'lifetime'` as proof of a genuine Stripe Lifetime purchase. That's not
 * sufficient evidence: `stripeCustomerId` gets attached to a User row
 * whenever they merely open Stripe's billing portal ("Manage Billing"), with
 * no purchase involved (see `lib/users.ts`'s `isRealPurchaseOrRenewal`
 * guard). This checks for an ACTUAL completed Stripe Checkout Session for
 * the Lifetime price — real, verifiable purchase evidence Stripe itself
 * recorded.
 *
 * REVISION 6 FIX — correlate by GasCap userId, not by stripeCustomerId.
 *
 * Independent review confirmed against `app/api/stripe/checkout/route.ts`
 * that GasCap's Lifetime Checkout Session creation does NOT set
 * `customer_creation: 'always'` — when a user has no existing
 * `stripeCustomerId`, the session is created with `customer_email` and no
 * `customer` field, which Stripe's default payment-mode behavior can
 * fulfill as a GUEST checkout, creating a paid Checkout Session with
 * `session.customer === null` and no Stripe Customer object at all. Every
 * checkout session GasCap creates DOES set `metadata.userId`, unconditionally
 * (both payment and subscription mode) — see the same route.
 *
 * That means "no `stripeCustomerId`" does NOT prove "no Stripe Lifetime
 * purchase" — a genuine guest-checkout Lifetime purchaser can legitimately
 * have `stripeInterval='lifetime'` and `stripeCustomerId=null` at the same
 * time. The previous design would have treated that combination as
 * automatically "not explained" and proposed clearing a real customer's
 * Lifetime marker.
 *
 * `verifyStripeLifetimePurchase` correlates by GasCap's own `userId`,
 * finding evidence regardless of whether the purchase went through a guest
 * checkout or an existing Stripe Customer. `stripeCustomerId` is no longer
 * used at all for this check — the metadata correlation is authoritative
 * and customer-agnostic.
 *
 * IMPLEMENTATION NOTE — documented deviation from a literal
 * "paginate Checkout Sessions globally" design: the Stripe Node SDK has no
 * `checkout.sessions.search` method at all — Stripe's Search API only
 * covers a fixed resource list (PaymentIntents, Charges, Customers,
 * Invoices, Subscriptions, Prices, Products), which does not include
 * Checkout Sessions. Enumerating ALL of GasCap's Checkout Sessions
 * unfiltered (via `.list()`) for every migration candidate would be
 * O(candidates × total-sessions-ever-created) — not viable at any real
 * scale. Instead, this correlates via `stripe.paymentIntents.search()`:
 * GasCap's Lifetime checkout (`app/api/stripe/checkout/route.ts`) sets
 * `payment_intent_data.metadata` with the SAME `userId` (plus `tier` and
 * `billing: 'lifetime'`) on the PaymentIntent that backs every payment-mode
 * Checkout Session — a payment-mode session cannot exist without one. This
 * achieves the identical guarantee the review required (guest-checkout-safe,
 * global, userId-correlated, not gated on stripeCustomerId) via a resource
 * Stripe's Search API actually supports, and is arguably more robust than a
 * price-line-item check since it doesn't depend on the Lifetime price id
 * staying constant over time.
 */

import { stripe } from '@/lib/stripe';

export type StripeLifetimeEvidenceStatus = 'VERIFIED_LIFETIME' | 'VERIFIED_NO_LIFETIME' | 'INCONCLUSIVE';

export interface StripeLifetimeEvidence {
  status: StripeLifetimeEvidenceStatus;
  /** The PaymentIntent id, only set when status === 'VERIFIED_LIFETIME' — for audit-trail purposes. */
  paymentIntentId: string | null;
}

interface StripePaymentIntentEvidence {
  id: string;
  status: string;
  metadata: { userId?: string; tier?: string; billing?: string } | null;
}

/** Escapes a value for safe inclusion in a Stripe Search API query string (single-quoted). */
function escapeSearchQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Page through EVERY PaymentIntent correlated to this GasCap user via
 * `metadata.userId` — set unconditionally on GasCap's Lifetime checkout,
 * regardless of whether it went through a guest checkout
 * (`session.customer === null`) or an existing Stripe Customer.
 */
async function listAllPaymentIntentsByUserId(gascapUserId: string): Promise<StripePaymentIntentEvidence[]> {
  const results: StripePaymentIntentEvidence[] = [];
  let page: string | undefined;
  const query = `metadata['userId']:'${escapeSearchQueryValue(gascapUserId)}'`;
  for (;;) {
    const result = await stripe!.paymentIntents.search({
      query,
      limit: 100,
      ...(page ? { page } : {}),
    });
    results.push(...(result.data as unknown as StripePaymentIntentEvidence[]));
    if (!result.has_more || !result.next_page) break;
    page = result.next_page;
  }
  return results;
}

/**
 * Look for a genuine, succeeded PaymentIntent for the GasCap Pro Lifetime
 * purchase, correlated by GasCap's own `userId` (via `metadata.userId`,
 * set on every checkout GasCap creates) — NOT by `stripeCustomerId`, which
 * a genuine guest-checkout Lifetime purchaser may never have. Read-only
 * (search calls only). Exhausts pagination before concluding
 * `VERIFIED_NO_LIFETIME`.
 *
 * Returns `INCONCLUSIVE` — never a thrown error — if Stripe isn't
 * configured, `gascapUserId` is empty, or a Stripe API call fails at any
 * point (including partway through pagination). Callers MUST treat
 * `INCONCLUSIVE` as "cannot confirm or rule out a Stripe Lifetime
 * purchase," never as evidence of absence — an incomplete scan must never
 * become `VERIFIED_NO_LIFETIME`.
 */
export async function verifyStripeLifetimePurchase(gascapUserId: string | null): Promise<StripeLifetimeEvidence> {
  if (!gascapUserId || !stripe) {
    return { status: 'INCONCLUSIVE', paymentIntentId: null };
  }

  let intents: StripePaymentIntentEvidence[];
  try {
    intents = await listAllPaymentIntentsByUserId(gascapUserId);
  } catch (err) {
    console.error(`[stripeEvidence] PaymentIntent search failed for userId ${gascapUserId}:`, err);
    return { status: 'INCONCLUSIVE', paymentIntentId: null };
  }

  const match = intents.find(
    (pi) => pi.status === 'succeeded' && pi.metadata?.billing === 'lifetime' && pi.metadata?.tier === 'pro',
  );
  if (match) {
    return { status: 'VERIFIED_LIFETIME', paymentIntentId: match.id };
  }

  return { status: 'VERIFIED_NO_LIFETIME', paymentIntentId: null };
}

export type StripeSubscriptionVerificationStatus = 'VERIFIED_ACTIVE' | 'VERIFIED_INACTIVE' | 'INCONCLUSIVE';

/**
 * Post-Revision-6 fix — a CONSERVATIVE, explicit status matrix for the
 * HISTORICAL PLAN REPAIR tool only. Revision 5's `status !== 'canceled' =>
 * active` was too permissive — it would have allowed a repair (free ->
 * pro) to fire from `incomplete`, `incomplete_expired`, `unpaid`, or
 * `paused`, none of which represent a subscription a customer is actually
 * paying for right now.
 *
 * This does NOT change GasCap's normal runtime billing policy (see
 * `lib/entitlements.ts`, which still treats `stripeSubscriptionId != null`
 * as sufficient during normal operation — the webhook keeps that field
 * fresh). This function is used ONLY to gate a historical repair decision.
 *
 * `past_due` is deliberately `INCONCLUSIVE`, not `VERIFIED_ACTIVE` or
 * `VERIFIED_INACTIVE` — GasCap has no existing, documented policy on
 * whether a past-due subscription should retain Pro access, and this
 * migration must not invent one. An `INCONCLUSIVE` result here simply means
 * this SPECIFIC evidence can't justify an automatic repair on its own;
 * another independently confirmed source still can.
 */
const VERIFIED_ACTIVE_STATUSES = new Set(['active', 'trialing']);
const VERIFIED_INACTIVE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);

/**
 * For HISTORICAL PLAN REPAIR ONLY, verify a stored `stripeSubscriptionId`
 * against Stripe's live subscription status, rather than trusting the
 * stored id's mere presence — see the module doc comment and
 * `VERIFIED_ACTIVE_STATUSES`/`VERIFIED_INACTIVE_STATUSES` above for exactly
 * which statuses count as which, and why `past_due` is neither.
 *
 * Returns `INCONCLUSIVE` (never a thrown error) if Stripe isn't configured,
 * the retrieval fails for any reason, or the status isn't one of the
 * explicitly-classified values above — callers MUST treat that as "do not
 * repair the plan on this evidence alone."
 */
export async function verifyStripeSubscriptionActive(subscriptionId: string | null): Promise<StripeSubscriptionVerificationStatus> {
  if (!subscriptionId || !stripe) {
    return 'INCONCLUSIVE';
  }
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (VERIFIED_ACTIVE_STATUSES.has(subscription.status)) return 'VERIFIED_ACTIVE';
    if (VERIFIED_INACTIVE_STATUSES.has(subscription.status)) return 'VERIFIED_INACTIVE';
    return 'INCONCLUSIVE'; // e.g. past_due, or any future/unrecognized status
  } catch (err) {
    console.error(`[stripeEvidence] subscription status retrieval failed for ${subscriptionId}:`, err);
    return 'INCONCLUSIVE';
  }
}
