/**
 * Sprint 2 hardening — centralized Pro entitlement resolution.
 *
 * Before this, "does this user have Pro" was decided by whichever webhook
 * last wrote `plan`, each with its own scattered, provider-specific
 * protection: the Stripe webhook checked `stripeInterval === 'lifetime'`
 * before reverting to free, and separately `setUserPlan` checked
 * `ambassadorProForLife`. Neither knew about the OTHER provider. Concretely:
 * the RevenueCat webhook's EXPIRATION/REFUND handler called
 * `setUserPlan(userId, 'free')` unconditionally — with no check for
 * `stripeInterval === 'lifetime'` at all — so a user who bought Lifetime via
 * Stripe and separately had any RevenueCat entitlement lapse would have their
 * paid Lifetime wiped by an event from a completely different provider.
 *
 * This resolves entitlement from ALL known sources at once, so a downgrade
 * only happens when NO qualifying source remains — never because the
 * specific source that fired the webhook happened to be the last one
 * checked.
 *
 * Known sources today, in the schema as it exists after Sprint 2:
 *   - ambassadorProForLife       (permanent, complimentary)
 *   - stripeInterval === 'lifetime'  (permanent — Stripe OR a gift; see below)
 *   - stripeSubscriptionId != null  (active recurring Stripe subscription)
 *   - revenueCatActive              (active RevenueCat grant — sub or lifetime)
 *   - isProTrial && trialExpiresAt in the future
 *
 * One acknowledged limitation, not solved in Sprint 2: `stripeInterval ===
 * 'lifetime'` cannot currently distinguish a real Stripe purchase from a
 * gifted Lifetime (grantGiftedLifetime writes the identical fields, by
 * design — see lib/users.ts). Both are equally permanent in practice, so
 * this does not create an incorrect-downgrade risk, only an incomplete
 * `sources` label — recorded here as `stripe_or_gift_lifetime` rather than
 * asserting a provenance the data doesn't actually contain.
 *
 * PROVENANCE INVARIANT (post-Sprint-2 Revision 1 — do not violate this):
 * `stripeInterval` is written ONLY from a genuine Stripe/gift grant, never
 * from a RevenueCat grant and never from this resolver's own
 * `effectiveInterval` output. RevenueCat's grant/revoke provenance lives
 * entirely in `revenueCatActive`/`revenueCatInterval`. A caller that writes
 * `effectiveInterval` (or any RC-sourced value) back into `stripeInterval`
 * reintroduces the exact corruption this file exists to prevent: it can
 * either destroy a real Stripe/gift Lifetime's provenance, or manufacture a
 * fake one from a source (RevenueCat, Ambassador) that a later, unrelated
 * event on that OTHER source could then incorrectly treat as permanent. See
 * lib/users.ts's setUserPlan/revokeRevenueCatEntitlement/
 * revokeStripeSubscriptionEntitlement/revokeAmbassadorEntitlement and
 * __tests__/entitlementProvenance.test.ts for the enforcement and the
 * regression coverage.
 */

export interface EntitlementInput {
  ambassadorProForLife: boolean;
  stripeInterval:       string | null;
  stripeSubscriptionId: string | null;
  revenueCatActive:     boolean;
  revenueCatInterval:   string | null;
  isProTrial:           boolean;
  trialExpiresAt:       string | null;
}

export type EntitlementSource =
  | 'ambassador'
  | 'stripe_or_gift_lifetime'
  | 'stripe_subscription'
  | 'revenuecat';

export interface ResolvedEntitlement {
  pro:        boolean;
  /** True if `pro` cannot lapse on its own (no expiry to track). */
  permanent:  boolean;
  sources:    EntitlementSource[];
  trial:      boolean;
  /** The interval to persist on User.plan/stripeInterval if `pro` is true. */
  effectiveInterval: 'monthly' | 'lifetime' | null;
}

function trialActive(input: EntitlementInput, now: number): boolean {
  if (!input.isProTrial || !input.trialExpiresAt) return false;
  const expires = new Date(input.trialExpiresAt).getTime();
  return Number.isFinite(expires) && expires > now;
}

/**
 * Resolve the user's aggregate Pro entitlement from every known source.
 *
 * Pure function — no I/O — so it's directly table-driven-testable without a
 * database. Callers are responsible for loading the input and writing the
 * result back (see lib/users.ts revokeRevenueCatEntitlement /
 * revokeStripeSubscriptionEntitlement, and app/api/native/revenuecat and
 * app/api/stripe/webhook for the call sites).
 */
export function resolveUserEntitlements(
  input: EntitlementInput,
  now: number = Date.now(),
): ResolvedEntitlement {
  const sources: EntitlementSource[] = [];
  let permanent = false;

  if (input.ambassadorProForLife) { sources.push('ambassador'); permanent = true; }
  if (input.stripeInterval === 'lifetime') { sources.push('stripe_or_gift_lifetime'); permanent = true; }
  if (input.stripeSubscriptionId) sources.push('stripe_subscription');
  if (input.revenueCatActive) sources.push('revenuecat');

  const trial = trialActive(input, now);
  // Requirement from the sprint brief: "Trial should not override paid
  // permanent access" — trivially true here since trial never REMOVES a
  // source, it only adds one. Kept as an explicit branch so the intent reads
  // clearly rather than being an accident of boolean-OR ordering.
  const pro = sources.length > 0 || trial;

  let effectiveInterval: 'monthly' | 'lifetime' | null = null;
  if (permanent) effectiveInterval = 'lifetime';
  else if (sources.includes('revenuecat') && input.revenueCatInterval === 'lifetime') effectiveInterval = 'lifetime';
  else if (pro) effectiveInterval = 'monthly';

  return { pro, permanent, sources, trial, effectiveInterval };
}
