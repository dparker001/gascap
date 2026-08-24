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
