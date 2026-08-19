/**
 * Post-Revision-4 fix — RevenueCat v2 authoritative, production-only,
 * paginated state lookup.
 *
 * HISTORY:
 *
 *   Revision 3 review found the original v1 client used
 *   `GET /v1/subscribers/{app_user_id}` — titled "Get **or Create**
 *   Customer" in RevenueCat's own docs, i.e. it can CREATE a RevenueCat
 *   customer as a side effect of an unknown lookup. Replaced with v2.
 *
 *   Revision 4 review found the FIRST v2 implementation was itself wrong on
 *   three independent points, all fixed here:
 *
 *   1. `GET .../active_entitlements` items do NOT contain a `product_id`
 *      field per RevenueCat's current v2 docs — only `entitlement_id` and
 *      `expires_at`. The prior code invented a `product_id` field on that
 *      response and used it to guess monthly-vs-lifetime. That field does
 *      not exist there.
 *   2. `entitlement_id` on that response is RevenueCat's INTERNAL
 *      entitlement id (e.g. `entla1b2c3d4e5`), NOT the configured lookup
 *      key (`pro`). Comparing it directly against the string `'pro'` is
 *      never a valid check — it can only ever be false, meaning the
 *      previous implementation could never actually detect an active
 *      entitlement in real use, despite passing its own (mocked) tests.
 *   3. `active_entitlements` does not distinguish sandbox from production
 *      transactions, and GasCap's production authorization state must
 *      never be kept alive by a sandbox/test purchase.
 *
 * REVISION 4 ARCHITECTURE — abandons `active_entitlements` entirely in
 * favor of the authoritative, production-filterable, entitlement-explicit
 * resources:
 *
 *   1. `GET /v2/projects/{project_id}/customers?search={app_user_id}`
 *      — resolves an app_user_id to a RevenueCat customer id WITHOUT
 *        creating one. Paginated; exact-id match only.
 *
 *   2. `GET /v2/projects/{project_id}/entitlements`
 *      — the project's entitlement catalog. Each item exposes `id`
 *        (RevenueCat's internal entitlement id) and `lookup_key` (the
 *        human-configured key, e.g. `pro`). Resolves
 *        GASCAP_PRO_ENTITLEMENT_LOOKUP_KEY to its internal id — this is
 *        the mapping step Revision 4's original code skipped entirely.
 *        Paginated.
 *
 *   3. `GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions?environment=production`
 *      — the customer's PRODUCTION subscriptions only. Paginated. Each
 *        item's `entitlements` field lists which entitlement ids it
 *        grants; only counts if it grants the resolved pro entitlement id
 *        AND its `status` is one of the "still has access" states.
 *
 *   4. `GET /v2/projects/{project_id}/customers/{customer_id}/purchases?environment=production`
 *      — the customer's PRODUCTION one-time (non-consumable) purchases
 *        only, e.g. the Lifetime product. Paginated. A matching,
 *        non-refunded purchase grants Pro permanently (no expiry check —
 *        that's the nature of a non-consumable purchase).
 *
 *   5. `GET /v2/projects/{project_id}/products/{product_id}`
 *      — resolves RevenueCat's INTERNAL product id (from step 3/4) to the
 *        store-facing product identifier (`store_identifier`, e.g.
 *        `gascap_pro_monthly` / `gascap_pro_lifetime`) — the SAME
 *        identifier convention GasCap's webhook-event code already uses
 *        for `revenueCatProductId`. If this resolution fails for any
 *        reason, `productId` is reported as `null` rather than silently
 *        falling back to RevenueCat's internal id — a `prod...`-shaped
 *        value must never leak into `revenueCatProductId`, since every
 *        other write path treats that column as a store identifier.
 *
 * A Lifetime purchase and an active monthly subscription are not expected
 * to coexist for the same GasCap identity, but if RevenueCat ever reports
 * both, Lifetime (the stronger, permanent grant) takes priority.
 *
 * Requires a v2 Secret API Key scoped to READ-ONLY permissions
 * (`REVENUECAT_V2_SECRET_KEY`) and the RevenueCat project id
 * (`REVENUECAT_PROJECT_ID`). Minimal permission categories this client
 * needs (grant ONLY these — never read_write):
 *
 *   customer_information:customers:read
 *   customer_information:subscriptions:read
 *   customer_information:purchases:read
 *   project_configuration:entitlements:read
 *   project_configuration:products:read
 *
 * NOT independently verified against a live RevenueCat account from this
 * environment — the request/response shapes follow RevenueCat's public v2
 * API reference as best understood, but should be smoke-tested against a
 * real project (a known test customer with both a live subscription and a
 * Lifetime purchase, plus a genuinely unknown app_user_id to confirm no
 * customer is created) before the historical reconciliation's output is
 * trusted for any specific user. See the smoke-test checklist in
 * docs/migrations/2026-08-sprint2-revenuecat-historical-reconciliation.md.
 */

const ORIGIN = 'https://api.revenuecat.com';
const API_BASE = `${ORIGIN}/v2`;

/**
 * The RevenueCat entitlement LOOKUP KEY (not RevenueCat's internal id) that
 * represents GasCap Pro access, as configured in the RevenueCat dashboard.
 * Resolved to an internal entitlement id via the entitlements catalog on
 * every call — see `resolveEntitlementInternalId`.
 */
const GASCAP_PRO_ENTITLEMENT_LOOKUP_KEY = process.env.REVENUECAT_PRO_ENTITLEMENT_ID || 'pro';

/** Subscription statuses that RevenueCat documents as still granting access. */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'in_grace_period', 'in_billing_retry', 'trialing']);

export interface AuthoritativeRevenueCatState {
  /** False if RevenueCat has no customer record for this app_user_id at all — distinct from "found but not entitled." */
  customerFound: boolean;
  /** True only if a PRODUCTION record (subscription or purchase) currently grants the resolved GasCap pro entitlement. */
  active: boolean;
  interval: 'monthly' | 'lifetime' | null;
  /** Store-facing product identifier (e.g. gascap_pro_monthly) — never RevenueCat's internal product id. Null if it couldn't be resolved. */
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

interface V2Page<T> {
  items?: T[];
  next_page?: string | null;
}

interface V2Customer { id: string }
interface V2Entitlement { id: string; lookup_key: string }
interface V2Subscription {
  product_id: string;
  status: string;
  entitlements?: string[];
  refunded_at?: number | null;
}
interface V2Purchase {
  product_id: string;
  entitlements?: string[];
  refunded_at?: number | null;
}
interface V2Product { store_identifier?: string | null }

/**
 * Follow every page of a RevenueCat v2 list endpoint using the response's
 * own `next_page` value — never a hand-constructed offset/cursor — so
 * pagination behavior tracks whatever RevenueCat actually returns rather
 * than an assumption about its shape.
 */
async function fetchAllPages<T>(path: string, apiKey: string, what: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = `${API_BASE}${path}`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`RevenueCat v2 ${what} fetch failed: HTTP ${res.status}`);
    }
    const json = await res.json() as V2Page<T>;
    items.push(...(json.items ?? []));
    url = json.next_page ? `${ORIGIN}${json.next_page}` : null;
  }
  return items;
}

/**
 * Resolve an app_user_id to a RevenueCat customer id, WITHOUT creating one.
 * Returns null if RevenueCat has no customer exactly matching this identity
 * across every page of search results.
 */
async function findCustomerId(appUserId: string, apiKey: string, projectId: string): Promise<string | null> {
  const items: V2Customer[] = [];
  let url: string | null = `${API_BASE}/projects/${encodeURIComponent(projectId)}/customers?search=${encodeURIComponent(appUserId)}`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`RevenueCat v2 customer search failed: HTTP ${res.status}`);
    }
    const json = await res.json() as V2Page<V2Customer>;
    const pageItems = json.items ?? [];
    const exact = pageItems.find((c) => c.id === appUserId);
    if (exact) return exact.id;
    items.push(...pageItems);
    url = json.next_page ? `${ORIGIN}${json.next_page}` : null;
  }
  return null;
}

/**
 * Resolve GasCap's configured entitlement lookup key (e.g. "pro") to
 * RevenueCat's internal entitlement id (e.g. "entla1b2c3d4e5"). This
 * mapping is required because subscription/purchase `entitlements` arrays
 * are populated with internal ids, never lookup keys.
 *
 * Deliberately not cached across calls — this client is used for
 * infrequent, explicit sync operations (an admin migration, a handful of
 * webhook edge cases), not a hot request path, so the extra round trip is
 * an acceptable cost for guaranteed freshness and simpler, fully
 * deterministic tests.
 */
async function resolveEntitlementInternalId(lookupKey: string, apiKey: string, projectId: string): Promise<string> {
  const entitlements = await fetchAllPages<V2Entitlement>(
    `/projects/${encodeURIComponent(projectId)}/entitlements`,
    apiKey,
    'entitlements catalog',
  );
  const match = entitlements.find((e) => e.lookup_key === lookupKey);
  if (!match) {
    throw new Error(`No RevenueCat entitlement configured with lookup_key="${lookupKey}" in this project — cannot resolve authoritative state.`);
  }
  return match.id;
}

/**
 * Resolve RevenueCat's internal product id to the store-facing product
 * identifier GasCap's webhook code already uses for `revenueCatProductId`
 * (e.g. `gascap_pro_monthly`). Returns null (never the raw internal id) if
 * resolution fails for any reason — a failed lookup here must never leak
 * RevenueCat's internal id into a column every other write path treats as
 * a store identifier.
 */
async function resolveProductStoreIdentifier(internalProductId: string, apiKey: string, projectId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(internalProductId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) return null;
    const json = await res.json() as V2Product;
    return json.store_identifier ?? null;
  } catch {
    return null;
  }
}

function grantsEntitlement(entitlements: string[] | undefined, entitlementId: string): boolean {
  return Array.isArray(entitlements) && entitlements.includes(entitlementId);
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
 * anything. Only PRODUCTION subscriptions/purchases are considered —
 * sandbox/test transactions never grant real access.
 *
 * THROWS on any lookup failure (missing config, network error, non-2xx
 * response, unresolvable entitlement lookup key) — callers MUST treat a
 * thrown error as "inconclusive; do not mutate entitlement state," never as
 * "confirmed inactive." This is a deliberate design choice: a lookup
 * failure and a genuine "not entitled" result must never be conflated by
 * any caller.
 */
export async function fetchAuthoritativeRevenueCatState(appUserId: string): Promise<AuthoritativeRevenueCatState> {
  const { apiKey, projectId } = requireConfig();

  const customerId = await findCustomerId(appUserId, apiKey, projectId);
  if (!customerId) {
    return { customerFound: false, active: false, interval: null, productId: null, customerId: null };
  }

  const proEntitlementId = await resolveEntitlementInternalId(GASCAP_PRO_ENTITLEMENT_LOOKUP_KEY, apiKey, projectId);

  // Sequential, not Promise.all — this is an infrequent, explicit-sync code
  // path (admin migration, a handful of webhook edge cases), not a hot
  // request path, and sequential calls keep pagination behavior fully
  // deterministic for both real use and tests.
  const subscriptions = await fetchAllPages<V2Subscription>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/subscriptions?environment=production`,
    apiKey,
    'production subscriptions',
  );
  const purchases = await fetchAllPages<V2Purchase>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/purchases?environment=production`,
    apiKey,
    'production purchases',
  );

  // Lifetime (non-consumable purchase) takes priority — it's the stronger,
  // permanent grant, and GasCap doesn't expect it to coexist with an active
  // subscription for the same identity.
  const activeLifetimePurchase = purchases.find(
    (p) => grantsEntitlement(p.entitlements, proEntitlementId) && !p.refunded_at,
  );
  if (activeLifetimePurchase) {
    const productId = await resolveProductStoreIdentifier(activeLifetimePurchase.product_id, apiKey, projectId);
    return { customerFound: true, active: true, interval: 'lifetime', productId, customerId };
  }

  const activeSubscription = subscriptions.find(
    (s) => grantsEntitlement(s.entitlements, proEntitlementId) && ACTIVE_SUBSCRIPTION_STATUSES.has(s.status) && !s.refunded_at,
  );
  if (activeSubscription) {
    const productId = await resolveProductStoreIdentifier(activeSubscription.product_id, apiKey, projectId);
    return { customerFound: true, active: true, interval: 'monthly', productId, customerId };
  }

  return { customerFound: true, active: false, interval: null, productId: null, customerId };
}
