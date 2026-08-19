/**
 * Post-Revision-3/5 fix — verified, tri-state, paginated Stripe Lifetime
 * purchase evidence.
 *
 * WHY THIS EXISTS: the historical reconciliation previously treated
 * `stripeCustomerId` present + no `stripeSubscriptionId` + `stripeInterval
 * === 'lifetime'` as proof of a genuine Stripe Lifetime purchase. That's not
 * sufficient evidence: `stripeCustomerId` gets attached to a User row
 * whenever they merely open Stripe's billing portal ("Manage Billing"), with
 * no purchase involved (see `lib/users.ts`'s `isRealPurchaseOrRenewal`
 * guard, added specifically because this already caused a real bug — a
 * trial user who only opened billing management had their trial silently
 * and permanently wiped). Combined with historical RevenueCat code having
 * separately written `stripeInterval='lifetime'`, `stripeCustomerId` +
 * `stripeInterval==='lifetime'` can exist with NO Stripe Lifetime purchase
 * behind it at all. This checks for an ACTUAL completed Stripe Checkout
 * Session for the Lifetime price — real, verifiable purchase evidence
 * Stripe itself recorded.
 *
 * REVISION 5 FIX — tri-state result, not a boolean:
 *
 * The prior version collapsed "Stripe API failed" into `verified: false`,
 * which is unsafe: a caller using `!verified` as evidence that NO Lifetime
 * purchase exists would treat an outage as proof of absence, and could
 * propose clearing a legitimate customer's `stripeInterval`. This now
 * returns one of three states:
 *
 *   VERIFIED_LIFETIME    — a completed, paid Checkout Session for the
 *                           Lifetime price was found. Positive evidence.
 *   VERIFIED_NO_LIFETIME — every Checkout Session for this customer (all
 *                           pages) was successfully checked and none
 *                           matched. Positive evidence of absence.
 *   INCONCLUSIVE          — Stripe isn't configured, the customer id is
 *                           empty, the Lifetime price id is unavailable, or
 *                           a pagination/request error occurred partway
 *                           through. NOT evidence either way.
 *
 * Only VERIFIED_NO_LIFETIME may ever be used as evidence supporting a
 * destructive legacy `stripeInterval` clear — see
 * `lib/revenueCatHistoricalReconciliation.ts`. INCONCLUSIVE must make that
 * cleanup ineligible, the same discipline `lib/revenueCatApi.ts` applies to
 * a failed RevenueCat lookup.
 *
 * REVISION 5 FIX — full pagination: the prior version listed only the first
 * 100 Checkout Sessions and 10 line items per session, silently missing an
 * older Lifetime purchase past that cutoff. This now exhausts Stripe's
 * `has_more` pagination on both the session list and each session's line
 * items before concluding VERIFIED_NO_LIFETIME.
 */

import { stripe, PRICES } from '@/lib/stripe';

export type StripeLifetimeEvidenceStatus = 'VERIFIED_LIFETIME' | 'VERIFIED_NO_LIFETIME' | 'INCONCLUSIVE';

export interface StripeLifetimeEvidence {
  status: StripeLifetimeEvidenceStatus;
  /** The Checkout Session id, only set when status === 'VERIFIED_LIFETIME' — for audit-trail purposes. */
  sessionId: string | null;
}

interface StripeCheckoutSession {
  id: string;
  mode: string | null;
  payment_status: string | null;
}

/**
 * Page through every Checkout Session for a customer via Stripe's cursor
 * pagination (`starting_after` + `has_more`), never assuming the first page
 * is complete.
 */
async function listAllCheckoutSessions(customerId: string): Promise<StripeCheckoutSession[]> {
  const sessions: StripeCheckoutSession[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe!.checkout.sessions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    sessions.push(...(page.data as StripeCheckoutSession[]));
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return sessions;
}

/**
 * Page through every line item of a single Checkout Session, checking for
 * the Lifetime price on each page rather than only the first.
 */
async function sessionHasLifetimeLineItem(sessionId: string): Promise<boolean> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe!.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (page.data.some((li) => li.price?.id === PRICES.proLifetime)) return true;
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return false;
}

/**
 * Look for a genuine completed Stripe Checkout Session for the GasCap Pro
 * Lifetime price under the given customer. Read-only (list calls only).
 * Exhausts pagination on both the session list and each session's line
 * items before concluding `VERIFIED_NO_LIFETIME`.
 *
 * Returns `INCONCLUSIVE` — never a thrown error — if Stripe isn't
 * configured, the customer id is empty, the Lifetime price id is
 * unavailable, or a Stripe API call fails partway through. Callers MUST
 * treat `INCONCLUSIVE` as "cannot confirm or rule out a Stripe Lifetime
 * purchase," never as evidence of absence.
 */
export async function verifyStripeLifetimePurchase(stripeCustomerId: string | null): Promise<StripeLifetimeEvidence> {
  if (!stripeCustomerId || !stripe || !PRICES.proLifetime) {
    return { status: 'INCONCLUSIVE', sessionId: null };
  }

  let sessions: StripeCheckoutSession[];
  try {
    sessions = await listAllCheckoutSessions(stripeCustomerId);
  } catch (err) {
    console.error(`[stripeEvidence] Checkout Session list failed for ${stripeCustomerId}:`, err);
    return { status: 'INCONCLUSIVE', sessionId: null };
  }

  const candidateSessions = sessions.filter((s) => s.mode === 'payment' && s.payment_status === 'paid');

  for (const session of candidateSessions) {
    let hasLifetimeLine: boolean;
    try {
      hasLifetimeLine = await sessionHasLifetimeLineItem(session.id);
    } catch (err) {
      console.error(`[stripeEvidence] line item check failed for session ${session.id}:`, err);
      return { status: 'INCONCLUSIVE', sessionId: null };
    }
    if (hasLifetimeLine) {
      return { status: 'VERIFIED_LIFETIME', sessionId: session.id };
    }
  }

  return { status: 'VERIFIED_NO_LIFETIME', sessionId: null };
}

export type StripeSubscriptionVerificationStatus = 'VERIFIED_ACTIVE' | 'VERIFIED_INACTIVE' | 'INCONCLUSIVE';

/**
 * Post-Revision-5 fix — for HISTORICAL PLAN REPAIR ONLY, verify a stored
 * `stripeSubscriptionId` against Stripe's live subscription status, rather
 * than trusting the stored id's mere presence.
 *
 * During normal runtime, GasCap's existing billing/access policy DOES treat
 * `stripeSubscriptionId != null` as sufficient — the Stripe webhook keeps it
 * fresh, clearing it on `customer.subscription.deleted`. This function does
 * NOT change that policy (see `lib/entitlements.ts`).
 *
 * But the historical reconciliation is a REPAIR tool operating on
 * potentially stale legacy data — a `plan='free' → plan='pro'` repair must
 * not fire off a stale subscription id that Stripe would actually report as
 * canceled (e.g. from an ever-missed webhook delivery). This checks Stripe
 * directly, live, before that specific kind of decision.
 *
 * GasCap's policy only ever clears `stripeSubscriptionId` on Stripe's
 * `customer.subscription.deleted` event — so any status other than
 * `'canceled'` is treated as still granting access, matching that same
 * policy rather than introducing a new one.
 *
 * Returns `INCONCLUSIVE` (never a thrown error) if Stripe isn't configured
 * or the retrieval fails for any reason — callers MUST treat that as "do
 * not repair the plan on this evidence alone," never as confirmation either
 * way.
 */
export async function verifyStripeSubscriptionActive(subscriptionId: string | null): Promise<StripeSubscriptionVerificationStatus> {
  if (!subscriptionId || !stripe) {
    return 'INCONCLUSIVE';
  }
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription.status === 'canceled' ? 'VERIFIED_INACTIVE' : 'VERIFIED_ACTIVE';
  } catch (err) {
    console.error(`[stripeEvidence] subscription status retrieval failed for ${subscriptionId}:`, err);
    return 'INCONCLUSIVE';
  }
}
