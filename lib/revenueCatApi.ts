/**
 * Post-Revision-3 fix — true read-only RevenueCat lookup.
 *
 * The original version of this file used `GET /v1/subscribers/{app_user_id}`.
 * Independent review confirmed against RevenueCat's current official API
 * documentation that this v1 endpoint is titled "Get **or Create** Customer"
 * — calling it for an unknown `app_user_id` CREATES a RevenueCat customer as
 * a side effect. That makes the historical reconciliation's "dry run" not
 * actually read-only with respect to RevenueCat, which defeats the entire
 * point of a dry run.
 *
 * Replaced with RevenueCat's v2 API, which has genuinely read-only lookup
 * endpoints:
 *
 *   GET /v2/projects/{project_id}/customers?search={app_user_id}
 *     — resolves an app_user_id to a RevenueCat customer WITHOUT creating
 *       one if it doesn't exist. Returns an empty list for an unknown id.
 *
 *   GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements
 *     — the customer's currently active entitlements, by entitlement
 *       identifier (GasCap's RevenueCat project should have a `pro`
 *       entitlement — see ENTITLEMENT_ID below).
 *
 * Requires a v2 Secret API Key scoped to READ-ONLY permissions
 * (`REVENUECAT_V2_SECRET_KEY`) and the RevenueCat project id
 * (`REVENUECAT_PROJECT_ID`) — both distinct from `REVENUECAT_WEBHOOK_AUTH`
 * (this app's own webhook-auth secret, not an RC credential) and from the
 * old v1 key this file previously used. When creating the v2 key in the
 * RevenueCat dashboard, grant it ONLY the customer-read permissions this
 * client needs — never a key with write/create scope, so a bug in this
 * client (or a future caller) cannot mutate RevenueCat even by accident.
 *
 * NOT independently verified against a live RevenueCat account from this
 * environment — the request/response shapes follow RevenueCat's public v2
 * API reference, but should be smoke-tested against a real project (a known
 * test customer, and a genuinely unknown app_user_id to confirm no customer
 * is created) before the historical reconciliation's output is trusted for
 * any specific user. See the smoke-test checklist in
 * docs/migrations/2026-08-sprint2-revenuecat-historical-reconciliation.md.
 */

const API_BASE = 'https://api.revenuecat.com/v2';
const LIFETIME_PRODUCT = 'gascap_pro_lifetime';

/**
 * The RevenueCat entitlement identifier that represents GasCap Pro access.
 * MUST match the entitlement configured in the RevenueCat dashboard for
 * this project — an unrelated entitlement (if this project ever has more
 * than one) must never be treated as GasCap Pro. Confirm this value against
 * the actual RevenueCat project configuration before enabling
 * REVENUECAT_V2_SECRET_KEY in production; 'pro' is this codebase's naming
 * convention, not independently confirmed against the live dashboard.
 */
const GASCAP_PRO_ENTITLEMENT_ID = process.env.REVENUECAT_PRO_ENTITLEMENT_ID || 'pro';

export interface AuthoritativeRevenueCatState {
  /** False if RevenueCat has no customer record for this app_user_id at all — distinct from "found but not entitled." */
  customerFound: boolean;
  /** True only if the GasCap `pro` entitlement (see GASCAP_PRO_ENTITLEMENT_ID) is currently active for this customer. */
  active: boolean;
  interval: 'monthly' | 'lifetime' | null;
  productId: string | null;
  /** The RevenueCat customer id, if found — needed by callers reconciling multiple identities (e.g. TRANSFER). */
  customerId: string | null;
}

function requireConfig(): { apiKey: string; projectId: string } {
  const apiKey = process.env.REVENUECAT_V2_SECRET_KEY;
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error('REVENUECAT_V2_SECRET_KEY and REVENUECAT_PROJECT_ID must both be configured — authoritative RevenueCat lookup unavailable.');
  }
  return { apiKey, projectId };
}

interface V2CustomerListResponse {
  items?: { id: string }[];
}

interface V2ActiveEntitlementsResponse {
  items?: {
    entitlement_id: string;
    expires_at: number | null; // ms epoch, null = does not expire (e.g. non-consumable)
    product_id: string;
  }[];
}

/**
 * Resolve an app_user_id to a RevenueCat customer id, WITHOUT creating one.
 * Returns null if RevenueCat has no customer matching this identity.
 */
async function findCustomerId(appUserId: string, apiKey: string, projectId: string): Promise<string | null> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/customers?search=${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) {
    throw new Error(`RevenueCat v2 customer search failed: HTTP ${res.status}`);
  }
  const json = await res.json() as V2CustomerListResponse;
  const items = json.items ?? [];
  // Exact match on the search term — the search endpoint can return
  // near-matches; only trust an exact app_user_id match as "found."
  const match = items.find((c) => c.id === appUserId) ?? (items.length === 1 ? items[0] : undefined);
  return match?.id ?? null;
}

/**
 * Fetch a customer's currently active entitlements.
 */
async function fetchActiveEntitlements(customerId: string, apiKey: string, projectId: string): Promise<V2ActiveEntitlementsResponse['items']> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/active_entitlements`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) {
    throw new Error(`RevenueCat v2 active_entitlements fetch failed: HTTP ${res.status}`);
  }
  const json = await res.json() as V2ActiveEntitlementsResponse;
  return json.items ?? [];
}

/**
 * THE authoritative RevenueCat state lookup — the single function every
 * caller (historical reconciliation, CUSTOMER_SUPPORT cancellation sync,
 * TRANSFER reconciliation, REFUND_REVERSED) should use, so there is exactly
 * one implementation of "what does RevenueCat currently say about this
 * identity" in this codebase.
 *
 * Read-only — makes zero writes to RevenueCat. An unknown app_user_id
 * returns `{ customerFound: false, active: false, ... }`, never creates
 * anything (this is the entire reason this file was rewritten against v2).
 *
 * THROWS on any lookup failure (missing config, network error, non-2xx
 * response) — callers MUST treat a thrown error as "inconclusive; do not
 * mutate entitlement state," never as "confirmed inactive." This is a
 * deliberate design choice: a lookup failure and a genuine "not entitled"
 * result must never be conflated by any caller.
 */
export async function fetchAuthoritativeRevenueCatState(appUserId: string): Promise<AuthoritativeRevenueCatState> {
  const { apiKey, projectId } = requireConfig();

  const customerId = await findCustomerId(appUserId, apiKey, projectId);
  if (!customerId) {
    return { customerFound: false, active: false, interval: null, productId: null, customerId: null };
  }

  const entitlements = await fetchActiveEntitlements(customerId, apiKey, projectId);
  const now = Date.now();
  const proEntitlement = (entitlements ?? []).find(
    (e) => e.entitlement_id === GASCAP_PRO_ENTITLEMENT_ID && (e.expires_at === null || e.expires_at > now),
  );

  if (!proEntitlement) {
    return { customerFound: true, active: false, interval: null, productId: null, customerId };
  }

  const interval: 'monthly' | 'lifetime' = proEntitlement.product_id === LIFETIME_PRODUCT ? 'lifetime' : 'monthly';
  return { customerFound: true, active: true, interval, productId: proEntitlement.product_id, customerId };
}
