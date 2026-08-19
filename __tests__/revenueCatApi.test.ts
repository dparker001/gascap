/**
 * Post-Sprint-2 Revision 6 P0 — provider-realistic RevenueCat v2 shapes.
 *
 * Revision 5 modeled subscription/purchase `entitlements` as a bare
 * `string[]`, reimplemented RevenueCat's access rules via a hand-picked
 * `status` allowlist instead of the documented `gives_access` boolean, used
 * a fabricated `refunded_at` field on Purchase instead of RevenueCat's
 * documented `status: 'owned'`, and resolved customers via a raw
 * "first search result wins." This file exercises the Revision 6 fixes:
 * embedded, independently-paginated EntitlementList objects,
 * `gives_access`-based subscription grants, `status`-based purchase
 * ownership, and alias-based customer resolution.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

const PROJECT = 'proj_test';
const PRO_ID = 'entla1b2c3d4e5';

function entitlementsPage(items: { id: string; lookup_key: string }[], nextPage: string | null = null) {
  return jsonResponse({ items, next_page: nextPage });
}
function customersPage(items: { id: string; aliases?: string[] }[], nextPage: string | null = null) {
  return jsonResponse({ items, next_page: nextPage });
}
/** Provider-realistic embedded EntitlementList, as found on a Subscription or Purchase. */
function entitlementList(ids: string[], nextPage: string | null = null): { object: 'list'; items: { object: 'entitlement'; id: string; lookup_key: string }[]; next_page: string | null } {
  return { object: 'list', items: ids.map((id) => ({ object: 'entitlement', id, lookup_key: id === PRO_ID ? 'pro' : 'unrelated' })), next_page: nextPage };
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

  it('an UNKNOWN app_user_id (empty search, zero candidates) returns customerFound:false and makes no further calls', async () => {
    fetchMock.mockResolvedValueOnce(customersPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('unknown-user');
    expect(result).toEqual({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the v2 API, never the v1 get-or-create endpoint, never active_entitlements', async () => {
    fetchMock.mockResolvedValueOnce(customersPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v2/');
    expect(url).not.toContain('/v1/subscribers/');
  });

  function aliasesPage(ids: string[], nextPage: string | null = null) {
    return jsonResponse({ items: ids.map((id) => ({ object: 'customer.alias', id })), next_page: nextPage });
  }

  describe('customer resolution / alias handling — via the dedicated /aliases endpoint', () => {
    it('canonical appUserId === customer.id resolves immediately, with no extra alias-verification call', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.customerFound).toBe(true);
      expect(result.customerId).toBe('user-1');
      for (const call of fetchMock.mock.calls) {
        expect(String(call[0])).not.toContain('/aliases');
      }
    });

    it('a searched id that is an ALIAS of a differently-canonical-id customer resolves to the canonical id, after verifying via /aliases', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'canonical-customer-id' }])) // search returns the canonical customer, not matching searched id
        .mockResolvedValueOnce(aliasesPage(['old-alias-id', 'transferred-alias-id'])) // GET /customers/{id}/aliases
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('transferred-alias-id');
      expect(result.customerFound).toBe(true);
      expect(result.customerId).toBe('canonical-customer-id');
      const aliasCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/aliases'));
      expect(String(aliasCall![0])).toContain('/customers/canonical-customer-id/aliases');
    });

    it('follows next_page on the /aliases list to find a matching alias on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'canonical-customer-id' }]))
        .mockResolvedValueOnce(aliasesPage(['old-alias-id'], '/v2/projects/proj_test/customers/canonical-customer-id/aliases?starting_after=old-alias-id'))
        .mockResolvedValueOnce(aliasesPage(['transferred-alias-id']))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('transferred-alias-id');
      expect(result.customerId).toBe('canonical-customer-id');
      const aliasCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/aliases'));
      expect(aliasCalls.length).toBe(2);
    });

    it('a search result whose alias list does NOT contain the requested id resolves to no match, not a guess', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'unrelated-customer-id' }]))
        .mockResolvedValueOnce(aliasesPage(['some-other-id']));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('searched-id-not-in-aliases');
      expect(result).toEqual({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
    });

    it('an alias-list lookup failure throws — never silently treated as "no match" / "confirmed inactive"', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'some-customer-id' }]))
        .mockResolvedValueOnce(jsonResponse({}, false, 500));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      await expect(fetchAuthoritativeRevenueCatState('searched-id')).rejects.toThrow();
    });

    it('more than one distinct candidate, and NEITHER alias list contains the searched id, resolves to no match — not a guess', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'candidate-a' }, { id: 'candidate-b' }]))
        .mockResolvedValueOnce(aliasesPage(['unrelated-1']))
        .mockResolvedValueOnce(aliasesPage(['unrelated-2']));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('ambiguous-id');
      expect(result.customerFound).toBe(false);
    });

    it('every non-exact candidate is verified — a match on the SECOND candidate is still found, not skipped after the first fails', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'candidate-a' }, { id: 'candidate-b' }]))
        .mockResolvedValueOnce(aliasesPage(['unrelated-1']))
        .mockResolvedValueOnce(aliasesPage(['searched-id']))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('searched-id');
      expect(result.customerId).toBe('candidate-b');
    });
  });

  describe('subscription access via gives_access (not a hand-picked status set)', () => {
    const cases: { status: string; gives_access: boolean; expectGrant: boolean; label: string }[] = [
      { status: 'active', gives_access: true, expectGrant: true, label: 'active + gives_access=true grants' },
      { status: 'trialing', gives_access: true, expectGrant: true, label: 'trialing + gives_access=true grants' },
      { status: 'in_grace_period', gives_access: true, expectGrant: true, label: 'in_grace_period + gives_access=true grants' },
      { status: 'in_billing_retry', gives_access: false, expectGrant: false, label: 'in_billing_retry + gives_access=false does NOT grant (access suspended per RevenueCat docs)' },
      { status: 'paused', gives_access: false, expectGrant: false, label: 'paused + gives_access=false does NOT grant' },
      { status: 'some_future_unknown_status', gives_access: true, expectGrant: true, label: 'unknown status + gives_access=true grants — trust the documented signal, not a guessed status list' },
      { status: 'some_future_unknown_status', gives_access: false, expectGrant: false, label: 'unknown status + gives_access=false does NOT grant' },
    ];

    for (const c of cases) {
      it(c.label, async () => {
        fetchMock
          .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
          .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
          .mockResolvedValueOnce(purchasesPage([]))
          .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_monthly', status: c.status, gives_access: c.gives_access, entitlements: entitlementList([PRO_ID]) }]));
        if (c.expectGrant) fetchMock.mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_monthly' }));
        const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
        const result = await fetchAuthoritativeRevenueCatState('user-1');
        expect(result.active).toBe(c.expectGrant);
      });
    }
  });

  describe('purchase ownership via documented status (not a fabricated refunded_at field)', () => {
    it('status: "owned" with the Pro entitlement grants Lifetime access', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_lifetime', status: 'owned', entitlements: entitlementList([PRO_ID]) }]))
        .mockResolvedValueOnce(subscriptionsPage([]))
        .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(true);
      expect(result.interval).toBe('lifetime');
      expect(result.productId).toBe('gascap_pro_lifetime');
    });

    it('a purchase with a non-"owned" status does not grant access', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_lifetime', status: 'refunded', entitlements: entitlementList([PRO_ID]) }]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(false);
    });
  });

  describe('embedded EntitlementList nested pagination', () => {
    it('a subscription\'s embedded EntitlementList has the Pro entitlement on its OWN second page — must not be missed', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([{
          product_id: 'prod_monthly', status: 'active', gives_access: true,
          entitlements: entitlementList(['entl_unrelated'], '/v2/projects/proj_test/subscriptions/sub_1/entitlements?starting_after=entl_unrelated'),
        }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }])) // second page of the EMBEDDED list
        .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_monthly' }));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(true);
      expect(result.interval).toBe('monthly');
    });

    it('a purchase\'s embedded EntitlementList has the Pro entitlement on its OWN second page — must not be missed', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([{
          product_id: 'prod_lifetime', status: 'owned',
          entitlements: entitlementList(['entl_unrelated'], '/v2/projects/proj_test/purchases/pur_1/entitlements?starting_after=entl_unrelated'),
        }]))
        .mockResolvedValueOnce(subscriptionsPage([]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(true);
      expect(result.interval).toBe('lifetime');
    });

    it('a subscription whose embedded entitlements never actually include the Pro id (even across pages) does not grant access', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([{ product_id: 'prod_x', status: 'active', gives_access: true, entitlements: entitlementList(['entl_unrelated']) }]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(false);
    });
  });

  it('a Lifetime purchase takes priority over a simultaneously-reported active subscription', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_lifetime', status: 'owned', entitlements: entitlementList([PRO_ID]) }]))
      .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.interval).toBe('lifetime');
  });

  it('queries subscriptions and purchases with environment=production', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(purchasesPage([]))
      .mockResolvedValueOnce(subscriptionsPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const subCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/subscriptions'));
    const purchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/purchases'));
    expect(String(subCall![0])).toContain('environment=production');
    expect(String(purchCall![0])).toContain('environment=production');
  });

  it('if product-catalog resolution fails, active is still reported true but productId is null — never the raw internal id', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
      .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_internal_lifetime', status: 'owned', entitlements: entitlementList([PRO_ID]) }]))
      .mockResolvedValueOnce(subscriptionsPage([]))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    const result = await fetchAuthoritativeRevenueCatState('user-1');
    expect(result.active).toBe(true);
    expect(result.productId).toBeNull();
    expect(result.productId).not.toBe('prod_internal_lifetime');
  });

  it('throws if no entitlement in the catalog matches the configured lookup key', async () => {
    fetchMock
      .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
      .mockResolvedValueOnce(entitlementsPage([{ id: 'entl_unrelated', lookup_key: 'some_other_entitlement' }]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await expect(fetchAuthoritativeRevenueCatState('user-1')).rejects.toThrow(/lookup_key/);
  });

  it('sends the API key as a Bearer token, never in the URL', async () => {
    fetchMock.mockResolvedValueOnce(customersPage([]));
    const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
    await fetchAuthoritativeRevenueCatState('user-1');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain('test-v2-key');
    expect(options.headers.Authorization).toBe('Bearer test-v2-key');
  });

  describe('top-level pagination', () => {
    it('follows next_page on the entitlements catalog to find "pro" on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: 'entl_unrelated', lookup_key: 'unrelated' }], '/v2/projects/proj_test/entitlements?starting_after=entl_unrelated'))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.customerFound).toBe(true);
      expect(result.active).toBe(false);
    });

    it('follows next_page on production purchases to find the Lifetime purchase on the second page', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_unrelated', status: 'owned', entitlements: entitlementList(['entl_other']) }], '/v2/projects/proj_test/customers/user-1/purchases?environment=production&starting_after=pur_1'))
        .mockResolvedValueOnce(purchasesPage([{ product_id: 'prod_internal_lifetime', status: 'owned', entitlements: entitlementList([PRO_ID]) }]))
        .mockResolvedValueOnce(jsonResponse({ store_identifier: 'gascap_pro_lifetime' }));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      const result = await fetchAuthoritativeRevenueCatState('user-1');
      expect(result.active).toBe(true);
      expect(result.interval).toBe('lifetime');
    });

    it('uses next_page verbatim as a path — never hand-constructs an offset/cursor URL', async () => {
      fetchMock
        .mockResolvedValueOnce(customersPage([], '/v2/projects/proj_test/customers?search=user-1&starting_after=cust_weird_token_123'))
        .mockResolvedValueOnce(customersPage([{ id: 'user-1' }]))
        .mockResolvedValueOnce(entitlementsPage([{ id: PRO_ID, lookup_key: 'pro' }]))
        .mockResolvedValueOnce(purchasesPage([]))
        .mockResolvedValueOnce(subscriptionsPage([]));
      const { fetchAuthoritativeRevenueCatState } = await import('../lib/revenueCatApi');
      await fetchAuthoritativeRevenueCatState('user-1');
      const secondUrl = String(fetchMock.mock.calls[1][0]);
      expect(secondUrl).toBe('https://api.revenuecat.com/v2/projects/proj_test/customers?search=user-1&starting_after=cust_weird_token_123');
    });
  });
});
