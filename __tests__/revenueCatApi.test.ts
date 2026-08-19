/**
 * Post-Sprint-2 Revision 4 P0 — true read-only RevenueCat v2 lookup.
 *
 * The original v1-based client used `GET /v1/subscribers/{app_user_id}`,
 * which RevenueCat's own documentation titles "Get OR CREATE Customer" —
 * calling it for an unknown identity creates a RevenueCat customer as a
 * side effect. This tests the v2 replacement, which uses a genuinely
 * read-only search endpoint.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.resetModules();
  process.env.REVENUECAT_V2_SECRET_KEY = 'test-v2-key';
  process.env.REVENUECAT_PROJECT_ID = 'proj_test';
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

  it('an UNKNOWN app_user_id (empty search results) returns customerFound:false, and NEVER creates anything — the core Revision 4 fix', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] })); // customer search — no match
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('unknown-user');
    expect(result).toEqual({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
    // Only ONE fetch call — the search — no second call to any create/write endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/projects/proj_test/customers?search=unknown-user');
    expect(options.method ?? 'GET').toBe('GET'); // no method override to POST/PUT
  });

  it('uses the v2 search endpoint, not the v1 get-or-create endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/');
    expect(url).not.toContain('/v1/subscribers/');
  });

  it('a found customer with an active pro entitlement (monthly) reports active:true, interval:monthly', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] })) // search
      .mockResolvedValueOnce(jsonResponse({ items: [{ entitlement_id: 'pro', expires_at: Date.now() + 86_400_000, product_id: 'gascap_pro_monthly' }] })); // active_entitlements
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result).toEqual({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'user-1' });
  });

  it('a found customer with an active pro entitlement for the lifetime product reports interval:lifetime', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ entitlement_id: 'pro', expires_at: null, product_id: 'gascap_pro_lifetime' }] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(true);
    expect(result.interval).toBe('lifetime');
  });

  it('a found customer with an EXPIRED entitlement reports active:false, not active', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ entitlement_id: 'pro', expires_at: Date.now() - 86_400_000, product_id: 'gascap_pro_monthly' }] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.customerFound).toBe(true);
    expect(result.active).toBe(false);
  });

  it('a found customer with an active entitlement under an UNRELATED entitlement_id (not "pro") does NOT count as GasCap Pro', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ entitlement_id: 'some_other_entitlement', expires_at: null, product_id: 'unrelated_product' }] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(false);
  });

  it('a found customer with NO active entitlements at all reports active:false', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(false);
    expect(result.customerFound).toBe(true);
  });

  it('a non-2xx response from the search endpoint throws (does not silently return "not found")', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow();
  });

  it('a non-2xx response from the active_entitlements endpoint throws', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow();
  });

  it('honors a custom REVENUECAT_PRO_ENTITLEMENT_ID if configured', async () => {
    process.env.REVENUECAT_PRO_ENTITLEMENT_ID = 'gascap_pro_custom';
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'user-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ entitlement_id: 'gascap_pro_custom', expires_at: null, product_id: 'gascap_pro_lifetime' }] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(true);
  });

  it('sends the API key as a Bearer token, never in the URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain('test-v2-key');
    expect(options.headers.Authorization).toBe('Bearer test-v2-key');
  });
});
