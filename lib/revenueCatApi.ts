/**
 * Post-Revision-2 addition — a minimal, read-only client for RevenueCat's
 * REST API, used ONLY by the historical entitlement reconciliation
 * (lib/revenueCatHistoricalReconciliation.ts) to confirm whether a
 * pre-Sprint-2 user identity currently holds an active RevenueCat
 * entitlement, when GasCap's own database has no other evidence either way.
 *
 * Uses RevenueCat's documented `GET /v1/subscribers/{app_user_id}` endpoint
 * with a Secret API Key (distinct from `REVENUECAT_WEBHOOK_AUTH`, which is
 * this app's own webhook-authentication secret, not an RC credential at
 * all). Gated behind `REVENUECAT_SECRET_API_KEY` being configured — if
 * unset, `fetchRevenueCatSubscriberInfo` throws immediately, which the
 * caller in the reconciliation module treats as "lookup unavailable,"
 * exactly like a network failure: it never causes a candidate to be guessed
 * at, only left ambiguous.
 *
 * NOT independently verified against a live RevenueCat account from this
 * environment — the request/response shape follows RevenueCat's public API
 * reference, but should be smoke-tested against a real subscriber (e.g. a
 * known test account) before the historical reconciliation's dry-run report
 * is treated as authoritative for any specific user.
 */

const API_BASE = 'https://api.revenuecat.com/v1';

export interface RevenueCatSubscriberInfo {
  active:     boolean;
  interval:   'monthly' | 'lifetime' | null;
  productId:  string | null;
}

const LIFETIME_PRODUCT = 'gascap_pro_lifetime';

interface RcSubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, { expires_date: string | null; product_identifier: string }>;
    non_subscriptions?: Record<string, { id: string; purchase_date: string }[]>;
  };
}

/**
 * Fetch a subscriber's current entitlement state directly from RevenueCat.
 * Throws if `REVENUECAT_SECRET_API_KEY` is not configured, or on any
 * network/HTTP error — callers must treat a thrown error as "inconclusive,"
 * never as "confirmed not active."
 */
export async function fetchRevenueCatSubscriberInfo(appUserId: string): Promise<RevenueCatSubscriberInfo> {
  const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (!apiKey) {
    throw new Error('REVENUECAT_SECRET_API_KEY is not configured — historical RC lookup unavailable.');
  }

  const res = await fetch(`${API_BASE}/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 404) {
    // RevenueCat has no record of this identity at all.
    return { active: false, interval: null, productId: null };
  }
  if (!res.ok) {
    throw new Error(`RevenueCat subscriber lookup failed: HTTP ${res.status}`);
  }

  const json = await res.json() as RcSubscriberResponse;
  const entitlements = json.subscriber?.entitlements ?? {};
  const now = Date.now();

  // An entitlement with a null/future expires_date is currently active.
  const activeEntitlement = Object.values(entitlements).find(
    (e) => e.expires_date === null || new Date(e.expires_date).getTime() > now,
  );
  if (activeEntitlement) {
    const interval: 'monthly' | 'lifetime' = activeEntitlement.product_identifier === LIFETIME_PRODUCT ? 'lifetime' : 'monthly';
    return { active: true, interval, productId: activeEntitlement.product_identifier };
  }

  // Non-consumables (lifetime purchases) can appear under non_subscriptions
  // instead of entitlements depending on RevenueCat project configuration —
  // check there too before concluding "not active."
  const nonSubs = json.subscriber?.non_subscriptions ?? {};
  const hasLifetimePurchase = Object.keys(nonSubs).some((productId) => productId === LIFETIME_PRODUCT && nonSubs[productId].length > 0);
  if (hasLifetimePurchase) {
    return { active: true, interval: 'lifetime', productId: LIFETIME_PRODUCT };
  }

  return { active: false, interval: null, productId: null };
}
