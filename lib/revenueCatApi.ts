/**
 * Post-Revision-5/6/7 fix — RevenueCat v2 authoritative, production-only,
 * correctly-shaped, fully-paginated (including nested resources) state
 * lookup, with real customer-alias resolution via RevenueCat's actual
 * dedicated `/aliases` endpoint (Revision 7 — see `verifyAlias` below;
 * Revision 6 incorrectly assumed alias data lived on the Customer detail
 * resource itself).
 *
 * HISTORY: v1 → v2 (Revision 3, endpoint had a write side effect on unknown
 * identities) → v2 via active_entitlements (Revision 4, invented fields
 * that don't exist on that response and compared an internal id against a
 * lookup-key string) → v2 via subscriptions/purchases (Revision 5, still
 * modeled `entitlements` as a bare `string[]` when RevenueCat actually
 * returns a paginated `EntitlementList`, reimplemented RevenueCat's own
 * access rules with a hand-picked status set instead of using the
 * documented `gives_access` boolean, modeled Purchase with a fabricated
 * `refunded_at` field instead of the documented `status` field, and
 * resolved customers by requiring an exact `id` match with no alias
 * handling — which matters directly for TRANSFER, since a transfer's
 * `transferred_from`/`transferred_to` identities are exactly the kind of
 * non-canonical alias RevenueCat's search can legitimately return under a
 * different customer).
 *
 * REVISION 6 ARCHITECTURE — corrects all of the above:
 *
 *   1. `GET /v2/projects/{project_id}/customers?search={app_user_id}`
 *      — resolves an app_user_id to a RevenueCat customer id WITHOUT
 *        creating one. Paginated. No longer assumes a raw first-result or
 *        exact-id match is authoritative — see `findCustomerId` below for
 *        the alias-verification design this review required.
 *
 *   2. `GET /v2/projects/{project_id}/entitlements`
 *      — the project's entitlement catalog (paginated). Resolves
 *        GASCAP_PRO_ENTITLEMENT_LOOKUP_KEY to its internal id.
 *
 *   3. `GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions?environment=production`
 *      — the customer's PRODUCTION subscriptions (paginated). Each item's
 *        `entitlements` field is itself a paginated `EntitlementList`
 *        (`{ object: 'list', items: [{ id, lookup_key, ... }], next_page }`),
 *        NOT a bare array — a target entitlement can be on that EMBEDDED
 *        list's second page and must not be missed. Access is determined
 *        by RevenueCat's own documented `gives_access: boolean` field —
 *        NEVER a hand-picked set of `status` strings, since RevenueCat's
 *        own status-to-access mapping can differ from any guess (e.g.
 *        `in_billing_retry` documents access as SUSPENDED, not granted).
 *
 *   4. `GET /v2/projects/{project_id}/customers/{customer_id}/purchases?environment=production`
 *      — the customer's PRODUCTION one-time purchases (paginated), same
 *        embedded paginated `EntitlementList` shape. Ownership is
 *        determined by RevenueCat's documented `status` field (`'owned'`
 *        is the currently-owned state) — never a fabricated `refunded_at`
 *        field, which RevenueCat's Purchase resource does not document.
 *
 *   5. `GET /v2/projects/{project_id}/products/{product_id}`
 *      — resolves RevenueCat's internal product id to the store-facing
 *        product identifier (`store_identifier`) — the SAME identifier
 *        convention GasCap's webhook-event code already uses for
 *        `revenueCatProductId`. Failure returns `null`, never the raw
 *        internal id.
 *
 * Minimal required v2 permissions (read-only, grant ONLY these):
 *
 *   customer_information:customers:read
 *   customer_information:subscriptions:read
 *   customer_information:purchases:read
 *   project_configuration:entitlements:read
 *   project_configuration:products:read
 *
 * NOT independently verified against a live RevenueCat account from this
 * environment. This is the third revision of this client in response to
 * successive independent review — the request/response shapes now follow
 * RevenueCat's public v2 API reference as closely as this environment can
 * determine without live access, but MUST be smoke-tested against a real
 * project before being trusted operationally. See the smoke-test checklist
 * in docs/migrations/2026-08-sprint2-revenuecat-historical-reconciliation.md.
 */

const ORIGIN = 'https://api.revenuecat.com';
const API_BASE = `${ORIGIN}/v2`;

const GASCAP_PRO_ENTITLEMENT_LOOKUP_KEY = process.env.REVENUECAT_PRO_ENTITLEMENT_ID || 'pro';

/** RevenueCat's documented "currently owned" Purchase status. */
const OWNED_PURCHASE_STATUS = 'owned';

export interface AuthoritativeRevenueCatState {
  customerFound: boolean;
  active: boolean;
  interval: 'monthly' | 'lifetime' | null;
  productId: string | null;
  /** The RESOLVED, CANONICAL RevenueCat customer id — may differ from the app_user_id searched for (alias resolution). */
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
interface V2Alias { id: string }
interface V2Entitlement { id: string; lookup_key: string }
/** RevenueCat's documented EntitlementList — a paginated list embedded in a Subscription or Purchase, NOT a bare array. */
interface V2EntitlementList { object?: 'list'; items?: V2Entitlement[]; next_page?: string | null }
interface V2Subscription {
  product_id: string;
  status: string;
  /** The authoritative access signal per RevenueCat's own docs — never re-derived from `status` alone. */
  gives_access: boolean;
  entitlements?: V2EntitlementList;
}
interface V2Purchase {
  product_id: string;
  /** RevenueCat's documented ownership state, e.g. 'owned'. */
  status: string;
  entitlements?: V2EntitlementList;
}
interface V2Product { store_identifier?: string | null }

/** Follows a top-level RevenueCat v2 list endpoint via its own `next_page`. */
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
 * Collects every entitlement id from an EMBEDDED, paginated EntitlementList
 * (as found on a Subscription or Purchase) — following its own `next_page`
 * until exhausted. A target entitlement id on the second page of this
 * NESTED list must never be missed just because the parent resource's own
 * page was already fully read.
 */
async function collectEmbeddedEntitlementIds(list: V2EntitlementList | undefined, apiKey: string): Promise<string[]> {
  if (!list) return [];
  const ids = (list.items ?? []).map((e) => e.id);
  let nextPage = list.next_page ?? null;
  while (nextPage) {
    const res = await fetch(`${ORIGIN}${nextPage}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`RevenueCat v2 embedded entitlement list fetch failed: HTTP ${res.status}`);
    }
    const page = await res.json() as V2EntitlementList;
    ids.push(...(page.items ?? []).map((e) => e.id));
    nextPage = page.next_page ?? null;
  }
  return ids;
}

/**
 * Fetch a RevenueCat customer's alias list via the documented dedicated
 * endpoint (`GET .../customers/{customer_id}/aliases`) to positively
 * confirm a searched app_user_id belongs to this customer, when the search
 * result's `id` didn't match the searched id directly. Paginated. Throws
 * on failure — an alias lookup failure must never be silently treated as
 * "no match" (which could read as "confirmed inactive" downstream); the
 * caller propagates this as an inconclusive lookup.
 *
 * Post-Revision-7 fix: previously this fetched the Customer detail
 * resource and assumed it carried an `aliases: string[]` field.
 * RevenueCat's actual v2 API exposes a dedicated, separately-paginated
 * `customer.alias` list resource instead — corrected here.
 */
async function verifyAlias(customerId: string, appUserId: string, apiKey: string, projectId: string): Promise<boolean> {
  const aliases = await fetchAllPages<V2Alias>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/aliases`,
    apiKey,
    'customer aliases',
  );
  return aliases.some((a) => a.id === appUserId);
}

/**
 * Resolve an app_user_id to RevenueCat's CANONICAL customer id, WITHOUT
 * creating one and WITHOUT assuming the searched id is itself canonical.
 *
 * RevenueCat's customer search matches against a customer's app-user IDs,
 * which can include aliases distinct from the canonical `Customer.id` —
 * this matters directly for TRANSFER, where `transferred_from`/
 * `transferred_to` identities are exactly this kind of alias. A raw
 * "first search result wins" is not safe: it could return a customer whose
 * OTHER app-user id happened to match unrelated criteria, not one that
 * actually corresponds to the searched identity.
 *
 * Design (per independent review):
 *   1. If any search result's `id` field exactly matches the searched
 *      app_user_id, accept immediately — unambiguous.
 *   2. Otherwise, collect every distinct candidate customer id across all
 *      search-result pages.
 *   3. Verify the searched id against EACH non-exact candidate's actual
 *      alias list (the dedicated `/aliases` endpoint).
 *   4. Exactly one candidate whose alias list contains the searched id ->
 *      return that canonical customer id.
 *   5. Zero verified matches -> not found.
 *   6. More than one verified match -> never guess; treat as unresolved
 *      (this should not be possible under RevenueCat's own data model, but
 *      is handled defensively rather than assumed away).
 *   7. Any alias-list lookup failure propagates (throws) — never silently
 *      "no match."
 */
async function findCustomerId(appUserId: string, apiKey: string, projectId: string): Promise<string | null> {
  const candidateIds = new Set<string>();
  let url: string | null = `${API_BASE}/projects/${encodeURIComponent(projectId)}/customers?search=${encodeURIComponent(appUserId)}`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`RevenueCat v2 customer search failed: HTTP ${res.status}`);
    }
    const json = await res.json() as V2Page<V2Customer>;
    const pageItems = json.items ?? [];
    for (const c of pageItems) {
      if (c.id === appUserId) return c.id; // exact match — immediate, unambiguous
      candidateIds.add(c.id);
    }
    url = json.next_page ? `${ORIGIN}${json.next_page}` : null;
  }

  if (candidateIds.size === 0) return null;

  const verifiedMatches: string[] = [];
  for (const candidateId of candidateIds) {
    const isAlias = await verifyAlias(candidateId, appUserId, apiKey, projectId);
    if (isAlias) verifiedMatches.push(candidateId);
  }

  if (verifiedMatches.length === 1) return verifiedMatches[0];

  // Zero verified matches, or (defensively) more than one — never guess.
  return null;
}

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

/**
 * THE authoritative RevenueCat state lookup — the single function every
 * caller (historical reconciliation, CUSTOMER_SUPPORT cancellation sync,
 * TRANSFER reconciliation, REFUND_REVERSED) should use.
 *
 * Read-only — makes zero writes to RevenueCat. An unknown app_user_id
 * returns `{ customerFound: false, active: false, ... }`, never creates
 * anything. Only PRODUCTION subscriptions/purchases are considered.
 *
 * THROWS on any lookup failure (missing config, network error, non-2xx
 * response, unresolvable entitlement lookup key, a failed alias
 * verification) — callers MUST treat a thrown error as "inconclusive; do
 * not mutate entitlement state," never as "confirmed inactive."
 */
export async function fetchAuthoritativeRevenueCatState(appUserId: string): Promise<AuthoritativeRevenueCatState> {
  const { apiKey, projectId } = requireConfig();

  const customerId = await findCustomerId(appUserId, apiKey, projectId);
  if (!customerId) {
    return { customerFound: false, active: false, interval: null, productId: null, customerId: null };
  }

  const proEntitlementId = await resolveEntitlementInternalId(GASCAP_PRO_ENTITLEMENT_LOOKUP_KEY, apiKey, projectId);

  // Sequential, not Promise.all — deliberate simplification (accepted in
  // Revision 5 review): keeps pagination behavior fully deterministic on
  // this infrequent, explicit-sync code path.
  // Purchases fetched first — Lifetime purchases take priority in the
  // checks below, so fetching in that same order keeps call order intuitive.
  const purchases = await fetchAllPages<V2Purchase>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/purchases?environment=production`,
    apiKey,
    'production purchases',
  );
  const subscriptions = await fetchAllPages<V2Subscription>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/subscriptions?environment=production`,
    apiKey,
    'production subscriptions',
  );

  // Lifetime (non-consumable purchase) takes priority — the stronger,
  // permanent grant.
  for (const purchase of purchases) {
    if (purchase.status !== OWNED_PURCHASE_STATUS) continue;
    const entitlementIds = await collectEmbeddedEntitlementIds(purchase.entitlements, apiKey);
    if (entitlementIds.includes(proEntitlementId)) {
      const productId = await resolveProductStoreIdentifier(purchase.product_id, apiKey, projectId);
      return { customerFound: true, active: true, interval: 'lifetime', productId, customerId };
    }
  }

  for (const subscription of subscriptions) {
    // RevenueCat's own documented signal for "does this subscription
    // currently grant access" — never a hand-picked status allowlist. E.g.
    // in_billing_retry documents access as SUSPENDED despite the
    // subscription record still existing.
    if (!subscription.gives_access) continue;
    const entitlementIds = await collectEmbeddedEntitlementIds(subscription.entitlements, apiKey);
    if (entitlementIds.includes(proEntitlementId)) {
      const productId = await resolveProductStoreIdentifier(subscription.product_id, apiKey, projectId);
      return { customerFound: true, active: true, interval: 'monthly', productId, customerId };
    }
  }

  return { customerFound: true, active: false, interval: null, productId: null, customerId };
}
