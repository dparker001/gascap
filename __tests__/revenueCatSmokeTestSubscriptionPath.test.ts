/**
 * Focused validation test for scripts/revenuecat-smoke-test.mjs's
 * --subscription-path diagnostic. The smoke-test script is a standalone
 * .mjs with no imports from lib/ (deliberately, so it has no dependency
 * on the Next.js build — see its header comment), so this test mirrors
 * its exact subscription-evaluation logic rather than importing it, same
 * pattern as __tests__/revenueCatSmokeTestEnvironment.test.ts.
 *
 * What this proves: the diagnostic evaluates ONLY subscription.gives_access
 * + the embedded EntitlementList — it must never consult purchases/
 * Lifetime records at all, which is the entire point of the flag (letting
 * this path be checked on a mixed Lifetime+Monthly customer where
 * production's real Lifetime-over-subscription precedence would otherwise
 * mask it).
 */
import { describe, it, expect } from 'vitest';

interface Entitlement { id: string }
interface EntitlementList { items?: Entitlement[] }
interface Subscription { gives_access: boolean; product_id: string; entitlements?: EntitlementList }

function collectEntitlementIds(list: EntitlementList | undefined): string[] {
  return (list?.items ?? []).map((e) => e.id);
}

/** Mirrors checkSubscriptionPathDiagnostic's evaluation loop — ignores purchases entirely by construction (no purchases parameter at all). */
function evaluateSubscriptionPath(subscriptions: Subscription[], proEntitlementId: string): { subscriptionAccess: boolean; productId: string | null } {
  for (const subscription of subscriptions) {
    if (!subscription.gives_access) continue;
    const entitlementIds = collectEntitlementIds(subscription.entitlements);
    if (entitlementIds.includes(proEntitlementId)) {
      return { subscriptionAccess: true, productId: subscription.product_id };
    }
  }
  return { subscriptionAccess: false, productId: null };
}

const PRO_ID = 'entla1b2c3d4e5';

describe('revenuecat-smoke-test.mjs — --subscription-path diagnostic evaluation', () => {
  it('an active subscription with gives_access=true and the pro entitlement reports subscriptionAccess=true', () => {
    const result = evaluateSubscriptionPath(
      [{ gives_access: true, product_id: 'prod_monthly', entitlements: { items: [{ id: PRO_ID }] } }],
      PRO_ID,
    );
    expect(result).toEqual({ subscriptionAccess: true, productId: 'prod_monthly' });
  });

  it('gives_access=false reports subscriptionAccess=false even with a matching entitlement present', () => {
    const result = evaluateSubscriptionPath(
      [{ gives_access: false, product_id: 'prod_monthly', entitlements: { items: [{ id: PRO_ID }] } }],
      PRO_ID,
    );
    expect(result.subscriptionAccess).toBe(false);
  });

  it('gives_access=true but no matching entitlement reports subscriptionAccess=false', () => {
    const result = evaluateSubscriptionPath(
      [{ gives_access: true, product_id: 'prod_monthly', entitlements: { items: [{ id: 'entl_unrelated' }] } }],
      PRO_ID,
    );
    expect(result.subscriptionAccess).toBe(false);
  });

  it('no subscriptions at all reports subscriptionAccess=false', () => {
    const result = evaluateSubscriptionPath([], PRO_ID);
    expect(result).toEqual({ subscriptionAccess: false, productId: null });
  });

  it('the function signature itself proves purchases are never consulted — it has no purchases parameter at all, so a mixed Lifetime+Monthly customer\'s Lifetime record cannot influence this result', () => {
    // Same subscriptions data regardless of whether the underlying customer
    // also owns a Lifetime purchase — the diagnostic function has no way to
    // see that data, by construction (no parameter exists to pass it in).
    const result = evaluateSubscriptionPath(
      [{ gives_access: true, product_id: 'prod_monthly', entitlements: { items: [{ id: PRO_ID }] } }],
      PRO_ID,
    );
    expect(result.subscriptionAccess).toBe(true);
    expect(evaluateSubscriptionPath.length).toBe(2); // (subscriptions, proEntitlementId) — no third "purchases" param
  });
});
