/**
 * Pure decision: after a native IAP purchase reports client-side success,
 * should the app navigate to the Lifetime/Pro success UI? Client
 * RevenueCat CustomerInfo alone is never sufficient — the server's
 * reconciled entitlement (POST /api/user/sync-revenuecat) is the gate.
 */
export interface ReconciledEntitlement {
  pro: boolean;
  permanent: boolean;
  effectiveInterval: 'monthly' | 'lifetime' | null;
}

export function shouldAllowIapSuccess(
  requested: 'monthly' | 'lifetime',
  server: ReconciledEntitlement | null,
): boolean {
  if (!server || !server.pro) return false;

  // effectiveInterval, not `permanent`, is the provider-neutral purchase-tier
  // signal — a genuine RevenueCat Lifetime resolves to permanent=false (that
  // flag is reserved for stripeInterval==='lifetime'/ambassador, see
  // lib/entitlements.ts) but effectiveInterval='lifetime'. Gating on
  // `permanent` would block every legitimate native Lifetime purchaser.
  if (requested === 'lifetime') {
    return server.effectiveInterval === 'lifetime';
  }
  if (requested === 'monthly') {
    return server.effectiveInterval === 'monthly' || server.effectiveInterval === 'lifetime';
  }
  return false;
}

/**
 * Pure decision (2026-08-25): app/upgrade/success/page.tsx is shared by
 * native IAP and Stripe/web success. Only a native purchase should trigger
 * the RevenueCat reconciliation recovery path — Stripe/web success keeps its
 * own unmodified session-refresh polling. 'method=iap' is set ONLY by
 * app/upgrade/page.tsx's handleIap()/handleRestore(); a Stripe Checkout
 * redirect always carries session_id instead and never this param.
 */
export function isNativeIapSuccess(params: { get(key: string): string | null }): boolean {
  return params.get('method') === 'iap';
}

/**
 * Pure decision (2026-08-25 correction): the success page's "spinner
 * stopped" state (`ready`) must never be read as "entitlement confirmed."
 * This is the SEPARATE decision that actually authorizes the Lifetime/Pro
 * success UI and getaway eligibility for a native purchase. `response` is
 * whatever the page derived from POST /api/user/sync-revenuecat — already
 * collapsed to `null` for every non-authoritative case (fetch threw, the
 * client aborted on timeout, or the response was non-2xx), so a timeout and
 * a definitive "not entitled" response are handled identically here: both
 * must NEVER be treated as confirmation. Delegates entirely to
 * shouldAllowIapSuccess() — the same requested-vs-actual tier check already
 * used to gate the initial navigation — so a URL claiming `billing=lifetime`
 * while the server only confirms Monthly (or nothing at all) resolves to
 * 'unconfirmed', not 'confirmed'.
 */
export function resolveNativeIapConfirmation(
  requested: 'monthly' | 'lifetime',
  response: ReconciledEntitlement | null,
): 'confirmed' | 'unconfirmed' {
  return shouldAllowIapSuccess(requested, response) ? 'confirmed' : 'unconfirmed';
}
