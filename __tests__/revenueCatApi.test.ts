/**
 * Post-Sprint-2 Revision 4/5 P0 — true read-only, production-only, paginated
 * RevenueCat v2 lookup.
 *
 * Revision 4's independent review found the FIRST v2 implementation invented
 * a `product_id` field on `active_entitlements` items (RevenueCat's real
 * response has no such field there), compared RevenueCat's INTERNAL
 * entitlement id against the configured lookup key string directly (always
 * false in real use), and never filtered to production-only records. This
 * test file exercises the corrected design: entitlement lookup-key
 * resolution, production-filtered subscriptions/purchases, product-catalog
 * resolution to a store-facing product id, and pagination via `next_page`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const PROJECT = 'proj_test';
const ENTITLEMENT_INTERNAL_ID = 'entla1b2c3d4e5';

function entitlementsPage(items: { id: string; lookup_key: string }[], nextPage: string | null = null) {
  return jsonResponse({ items, next_page: nextPage });
}
function customersPage(items: { id: string }[], nextPage: string | null = null) {
  return jsonResponse({ items, next_page: nextPage });
}
function subscriptionsPage(items: unknown[], nextPage: string | null = null) {
  return jsonResponse({ items, next_page: nextPage });
}
function purchasesPage(items: unknown[], nextPage: string | null = null) {
  return jsonResponse({ items, next_page: nextPage });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.resetModules();
  process.env.REVENUECAT_V2_SECRET_KEY = 'test-v2-key';
  process.env.REVENUECAT_PROJECT_ID = PROJECT;
  delete process.env.REVENUECAT_PRO_ENTITLEMENT_ID;
});

describe('fetchAuthoritativeRevenueCatState', () => {
  it('throws if REVENUECAT_V2_SECRET_KEY is not configured', async () => {
    delete process.env.REVENUECAT_V2_SECRET_KEY;
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow();
  });

  it('throws if REVENUECAT_PROJECT_ID is not configured', async () => {
    delete process.env.REVENUECAT_PROJECT_ID;
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow();
  });

  it('an UNKNOWN app_user_id (empty search results) returns customerFound:false and makes no further calls — never creates anything', async () => {
    fetchMock.mockResolvedValueOnce(customersPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('unknown-user');
    expect(result).toEqual({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/projects/proj_test/customers?search=unknown-user');
    expect(options.method ?? 'GET').toBe('GET');
  });

  it('uses the v2 API, not the v1 get-or-create endpoint', async () => {
    fetchMock.mockResolvedValueOnce(customersPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/');
    expect(url).not.toContain('/v1/subscribers/');
  });

  it('never calls active_entitlements — the endpoint whose response shape was misread in Revision 4', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(purchasesPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('active_entitlements');
    }
  });

  it('resolves the "pro" lookup key to its internal entitlement id before checking subscriptions/purchases', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([
        { id: 'entl_unrelated', lookup_key: 'some_other_entitlement' },
        { id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' },
      ]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(purchasesPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(false);
    const entitlementsCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/entitlements'));
    expect(entitlementsCall).toBeDefined();
  });

  it('throws if no entitlement in the catalog matches the configured lookup key — never silently treats it as inactive', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: 'entl_unrelated', lookup_key: 'some_other_entitlement' }]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow(/lookup_key/);
  });

  it('queries subscriptions and purchases with environment=production', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(purchasesPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const subCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/subscriptions'));
    const purchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/purchases'));
    expect(String(subCall![0])).toContain('environment=production');
    expect(String(purchCall![0])).toContain('environment=production');
  });

  it('an active PRODUCTION subscription granting pro reports active:true, interval:monthly, with the store-facing product id (not the internal id)', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_internal_monthly', status: 'active', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
      .mockResolvedValueOnce(purchasesPage([]))
      .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_monthly' }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result).toEqual({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'user-1' });
  });

  it('an owned PRODUCTION lifetime purchase granting pro reports active:true, interval:lifetime', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_internal_lifetime', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
      .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(true);
    expect(result.interval).toBe('lifetime');
    expect(result.productId).toBe('gascap_pro_lifetime');
  });

  it('a Lifetime purchase takes priority over a simultaneously-reported active subscription', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_internal_monthly', status: 'active', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
      .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_internal_lifetime', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
      .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.interval).toBe('lifetime');
  });

  it('a REFUNDED purchase does not grant access even if it matches the entitlement', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_internal_lifetime', entitlements: [ENTITLEMENT_INTERNAL_ID], refunded_at: 1234567890 }]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(false);
  });

  it('a subscription in a non-active status (e.g. "expired") does not grant access', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_internal_monthly', status: 'expired', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
      .mockResolvedValueOnce(purchasesPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(false);
  });

  it('a subscription/purchase that does NOT include the resolved pro entitlement id does not grant access, even if it belongs to this customer', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_unrelated', status: 'active', entitlements: ['entl_some_other_entitlement'] }]))
      .mockResolvedValueOnce(purchasesPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(false);
  });

  it('a found customer with no subscriptions or purchases at all reports customerFound:true, active:false', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(purchasesPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result).toEqual({ customerFound: true, active: false, interval: null, productId: null, customerId: 'user-1' });
  });

  it('if product-catalog resolution fails, active is still reported true but productId is null — never the raw internal id', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_internal_monthly', status: 'active', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
      .mockResolvedValueOnce(purchasesPage([]))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(true);
    expect(result.productId).toBeNull();
    expect(result.productId).not.toBe('prod_internal_monthly');
  });

  it('non-2xx from the customer search throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow();
  });

  it('non-2xx from the subscriptions endpoint throws (not silently treated as no subscriptions)', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow();
  });

  it('honors a custom REVENUECAT_PRO_ENTITLEMENT_ID lookup key if configured', async () => {
    process.env.REVENUECAT_PRO_ENTITLEMENT_ID = 'gascap_pro_custom';
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: 'entl_custom_internal', lookup_key: 'gascap_pro_custom' }]))
      .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_internal_monthly', status: 'active', entitlements: ['entl_custom_internal'] }]))
      .mockResolvedValueOnce(purchasesPage([]))
      .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_monthly' }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(true);
  });

  it('sends the API key as a Bearer token, never in the URL', async () => {
    fetchMock.mockResolvedValueOnce(customersPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain('test-v2-key');
    expect(options.headers.Authorization).toBe('Bearer test-v2-key');
  });

  describe('pagination', () => {
    it('follows next_page on the customer search to find an exact match on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1-decoy' }], '/v2/projects/proj_test/customers?search=user-1&starting_after=cust_1'))
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(subscriptionsPage([]))
        .mockResolvedValueOnce(purchasesPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.customerFound).toBe(true);
      expect(result.customerId).toBe('user-1');
      const firstTwoUrls = fetchMock.mock.calls.slice(0, 2).map((c) => String(c[0]));
      expect(firstTwoUrls[1]).toContain('starting_after=cust_1');
    });

    it('follows next_page on the entitlements catalog to find "pro" on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: 'entl_unrelated', lookup_key: 'unrelated' }], '/v2/projects/proj_test/entitlements?starting_after=entl_unrelated'))
        .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(subscriptionsPage([]))
        .mockResolvedValueOnce(purchasesPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.customerFound).toBe(true);
      expect(result.active).toBe(false);
      const entitlementCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/entitlements'));
      expect(entitlementCalls.length).toBe(2);
    });

    it('follows next_page on production purchases to find the Lifetime purchase on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(subscriptionsPage([]))
        .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_unrelated', entitlements: ['entl_other'] }], '/v2/projects/proj_test/customers/user-1/purchases?environment=production&starting_after=pur_1'))
        .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_internal_lifetime', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
        .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(true);
      expect(result.interval).toBe('lifetime');
      expect(result.productId).toBe('gascap_pro_lifetime');
      const purchaseCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/purchases'));
      expect(purchaseCalls.length).toBe(2);
    });

    it('follows next_page on production subscriptions to find the active subscription on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_unrelated', status: 'expired', entitlements: ['entl_other'] }], '/v2/projects/proj_test/customers/user-1/subscriptions?environment=production&starting_after=sub_1'))
        .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_internal_monthly', status: 'active', entitlements: [ENTITLEMENT_INTERNAL_ID] }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_monthly' }));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(true);
      expect(result.interval).toBe('monthly');
      const subCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/subscriptions'));
      expect(subCalls.length).toBe(2);
    });

    it('uses the next_page value verbatim as a path — never hand-constructs an offset/cursor URL', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([], '/v2/projects/proj_test/customers?search=user-1&starting_after=cust_weird_token_123'))
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: ENTITLEMENT_INTERNAL_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(subscriptionsPage([]))
        .mockResolvedValueOnce(purchasesPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      await fetchAuthoritativeRevenueCatState('user-1');
      const secondUrl = String(fetchMock.mock.calls[1][0]);
      expect(secondUrl).toBe('https://api.revenuecat.com/v2/projects/proj_test/customers?search=user-1&starting_after=cust_weird_token_123');
    });
  });
});
