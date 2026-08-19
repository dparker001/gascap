/**
 * Regression coverage for the RevenueCat webhook — the endpoint that grants and
 * revokes GasCap Pro for Apple IAP customers.
 *
 * It shipped with `if (expected && supplied !== expected)`, meaning a missing
 * REVENUECAT_WEBHOOK_AUTH did not weaken the check, it removed it: any
 * unauthenticated POST could grant or revoke Pro on any account. It had no
 * tests, because nothing in the suite could import a route (no `@/` alias).
 *
 * Every heavy dependency is mocked so this exercises the handler's own logic —
 * auth, event classification, user resolution, plan mutation — without a
 * database, mailer, or push service.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const setUserPlan               = vi.fn(async () => {});
const findById                  = vi.fn(async (_id: string) => undefined as unknown);
const findByEmail               = vi.fn(async (_e: string) => undefined as unknown);
const revokeRevenueCatEntitlement = vi.fn(async (): Promise<{ pro: boolean; permanent: boolean; sources: string[]; trial: boolean; effectiveInterval: string | null }> => ({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null }));
const syncRevenueCatEntitlementFromProvider = vi.fn(async (): Promise<{ pro: boolean; permanent: boolean; sources: string[]; trial: boolean; effectiveInterval: string | null }> => ({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null }));

vi.mock('@/lib/users', () => ({
  setUserPlan:        (...a: unknown[]) => setUserPlan(...(a as [])),
  findById:           (id: string) => findById(id),
  findByEmail:        (e: string) => findByEmail(e),
  enrollPaidCampaign: vi.fn(async () => {}),
  revokeRevenueCatEntitlement: (...a: unknown[]) => revokeRevenueCatEntitlement(...(a as [])),
  syncRevenueCatEntitlementFromProvider: (...a: unknown[]) => syncRevenueCatEntitlementFromProvider(...(a as [])),
}));

const fetchAuthoritativeRevenueCatState = vi.fn();
vi.mock('@/lib/revenueCatApi', () => ({
  fetchAuthoritativeRevenueCatState: (id: string) => fetchAuthoritativeRevenueCatState(id),
}));
const userUpdateMany = vi.fn(async () => ({ count: 1 })); // getaway-email claim always "wins" unless a test overrides it
vi.mock('@/lib/prisma', () => ({ prisma: { user: { updateMany: (...a: unknown[]) => userUpdateMany(...(a as [])) } } }));
vi.mock('@/lib/email',              () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailCampaignPaid',  () => ({ sendPaidCampaignEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/userPush',           () => ({ sendUserPush: vi.fn(async () => {}) }));
vi.mock('@/lib/getawayPromo',       () => ({
  getawayPromoActive: () => false,
  GETAWAY_DISCLOSURE: '',
}));

// In-memory stand-in for the RevenueCatWebhookEvent table, matching
// lib/revenueCatEvents.ts's claim semantics closely enough to test the
// route's behavior without a database.
const eventStore = new Map<string, { status: string; receivedAt: number; claimToken: string }>();
const claimEvent = vi.fn(async (eventId: string, _eventType?: string, _userId?: string | null) => {
  const existing = eventStore.get(eventId);
  const token = `token-${eventId}-${Math.random().toString(36).slice(2, 8)}`;
  if (!existing) { eventStore.set(eventId, { status: 'processing', receivedAt: Date.now(), claimToken: token }); return { outcome: 'claimed' as const, claimToken: token }; }
  if (existing.status === 'processed') return { outcome: 'duplicate-processed' as const };
  return { outcome: 'duplicate-in-flight' as const };
});
const markProcessed = vi.fn(async (eventId: string, _claimToken: string) => {
  const e = eventStore.get(eventId); if (e) e.status = 'processed';
});
const markFailed = vi.fn(async (eventId: string, _claimToken: string, _error?: unknown) => {
  const e = eventStore.get(eventId); if (e) e.status = 'failed';
});
vi.mock('@/lib/revenueCatEvents', () => ({
  claimEvent:    (id: string, t?: string, u?: string | null) => claimEvent(id, t, u),
  markProcessed: (id: string, tok: string) => markProcessed(id, tok),
  markFailed:    (id: string, tok: string, e: unknown) => markFailed(id, tok, e),
}));

const SECRET = 'test-webhook-secret-value';

async function post(body: unknown, auth?: string) {
  const { POST } = await import('@/app/api/native/revenuecat/route');
  const headers = new Headers({ 'content-type': 'application/json' });
  if (auth !== undefined) headers.set('authorization', auth);
  const req = new Request('https://www.gascap.app/api/native/revenuecat', {
    method: 'POST', headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json().catch(() => null) };
}

const USER = { id: 'user-1', email: 'buyer@example.com', name: 'Buyer', plan: 'free' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  eventStore.clear();
  process.env.REVENUECAT_WEBHOOK_AUTH = SECRET;
  findById.mockResolvedValue(undefined);
  findByEmail.mockResolvedValue(undefined);
  revokeRevenueCatEntitlement.mockResolvedValue({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null });
  syncRevenueCatEntitlementFromProvider.mockResolvedValue({ pro: true, permanent: false, sources: ['revenuecat'], trial: false, effectiveInterval: 'monthly' });
  fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_1' });
});

// ── 1–3: authentication ────────────────────────────────────────────────────
describe('authentication fails closed', () => {
  it('1. refuses to process when the secret is not configured', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1' } }, SECRET);

    // 503 (misconfiguration), not 401 — the failure is OUR server's config,
    // not the caller's fault. RevenueCat retries any non-200 response up to
    // 5 times, so the status code doesn't change retry behavior here; it's
    // about returning an honest status, not about steering RevenueCat.
    expect(res.status).toBe(503);
    // The critical assertion: no entitlement change occurred.
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('2. rejects a wrong secret without processing', async () => {
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1' } }, 'wrong-secret');
    expect(res.status).toBe(401);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('2b. rejects a missing authorization header', async () => {
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1' } });
    expect(res.status).toBe(401);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('2c. rejects an empty authorization header even if the secret were empty', async () => {
    // Guards the '' === '' equality trap that fail-open code tends to have.
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1' } }, '');
    expect(res.status).toBe(401);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('3. accepts the correct secret', async () => {
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_3' } }, SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalled();
  });

  it('never echoes the configured secret in a response body', async () => {
    const res = await post({ event: { type: 'INITIAL_PURCHASE' } }, 'wrong');
    expect(JSON.stringify(res.json)).not.toContain(SECRET);
  });
});

// ── 4–7: malformed / non-actionable input ──────────────────────────────────
describe('input handling', () => {
  it('4. tolerates a malformed body without granting anything', async () => {
    const res = await post('not json at all', SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('5. skips a payload with no event', async () => {
    const res = await post({}, SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('6. ignores an unsupported event type', async () => {
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'TEST', app_user_id: 'user-1' } }, SECRET);
    expect(res.status).toBe(200);
    expect(res.json?.ignored).toBe('TEST');
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('7. handles an unmatched user without throwing or granting', async () => {
    findById.mockResolvedValue(undefined);
    findByEmail.mockResolvedValue(undefined);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'ghost' } }, SECRET);
    expect(res.status).toBeLessThan(500);
    expect(setUserPlan).not.toHaveBeenCalled();
  });
});

// ── 8–12: entitlement transitions ──────────────────────────────────────────
describe('entitlement transitions', () => {
  it('8. grants Pro on a monthly purchase', async () => {
    findById.mockResolvedValue(USER);
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_8' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalled();
    const args = JSON.stringify(setUserPlan.mock.calls[0]);
    expect(args).toContain('pro');
    expect(args).not.toContain('lifetime');
  });

  it('9. grants lifetime on the non-consumable product', async () => {
    findById.mockResolvedValue(USER);
    await post({ event: { type: 'NON_RENEWING_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_9' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalled();
    expect(JSON.stringify(setUserPlan.mock.calls[0])).toContain('lifetime');
  });

  it('9b. treats RENEWAL as a continued grant', async () => {
    findById.mockResolvedValue(USER);
    await post({ event: { type: 'RENEWAL', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_9b' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalled();
  });

  it('10. revokes on expiration — via the reconciling revoke path, not a bare setUserPlan(free)', async () => {
    // Sprint 2: this used to be a direct setUserPlan(userId, 'free') call
    // with no awareness of a coexisting Stripe entitlement. It now goes
    // through revokeRevenueCatEntitlement, which recalculates before ever
    // touching plan — see __tests__/entitlements.test.ts for the resolver
    // itself and 10b/10c below for the coexistence cases this enables.
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    const res = await post({ event: { type: 'EXPIRATION', app_user_id: 'user-1', id: 'evt_10' } }, SECRET);
    expect(res.status).toBe(200);
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('user-1');
  });

  it('10b. EXPIRATION with a surviving Stripe entitlement does NOT downgrade', async () => {
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    revokeRevenueCatEntitlement.mockResolvedValue({
      pro: true, permanent: false, sources: ['stripe_subscription'], trial: false, effectiveInterval: 'monthly',
    });
    const res = await post({ event: { type: 'EXPIRATION', app_user_id: 'user-1', id: 'evt_10b' } }, SECRET);
    expect(res.status).toBe(200);
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('user-1');
    // The route itself never calls setUserPlan directly on the revoke path —
    // revokeRevenueCatEntitlement owns that decision entirely.
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('11. revokes on refund — same reconciling path as expiration', async () => {
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    const res = await post({ event: { type: 'REFUND', app_user_id: 'user-1', id: 'evt_11' } }, SECRET);
    expect(res.status).toBe(200);
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('user-1');
  });

  it('11b. CANCELLATION (auto-renew off, e.g. UNSUBSCRIBE) does not revoke — access runs to EXPIRATION', async () => {
    // Auto-renew off is not loss of access. Revoking here would cut a paying
    // customer off early, for the remainder they already paid for.
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1', cancel_reason: 'UNSUBSCRIBE', id: 'evt_11b' } }, SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(revokeRevenueCatEntitlement).not.toHaveBeenCalled();
  });

  it('11c. post-Revision-4: CANCELLATION with cancel_reason=CUSTOMER_SUPPORT syncs against AUTHORITATIVE RC state, not a blind revoke', async () => {
    // RevenueCat's docs explicitly warn that CUSTOMER_SUPPORT does not
    // necessarily mean the subscription was actually deactivated — check
    // current status rather than assume revocation.
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1', cancel_reason: 'CUSTOMER_SUPPORT', id: 'evt_11c' } }, SECRET);
    expect(res.status).toBe(200);
    expect(syncRevenueCatEntitlementFromProvider).toHaveBeenCalledWith('user-1');
    expect(revokeRevenueCatEntitlement).not.toHaveBeenCalled(); // no longer a blind revoke
  });

  it('11c2. CUSTOMER_SUPPORT + RC lookup confirms STILL ACTIVE => entitlement remains (this is exactly what syncRevenueCatEntitlementFromProvider does internally, asserted at the route level via the mock)', async () => {
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    syncRevenueCatEntitlementFromProvider.mockResolvedValue({ pro: true, permanent: false, sources: ['revenuecat'], trial: false, effectiveInterval: 'monthly' });
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1', cancel_reason: 'CUSTOMER_SUPPORT', id: 'evt_11c2' } }, SECRET);
    expect(res.status).toBe(200);
    expect(syncRevenueCatEntitlementFromProvider).toHaveBeenCalledWith('user-1');
  });

  it('11c3. CUSTOMER_SUPPORT + RC lookup confirms inactive, but a surviving Stripe Lifetime keeps the user Pro — asserted via the sync function\'s own return, which the route trusts without a second downgrade path', async () => {
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    syncRevenueCatEntitlementFromProvider.mockResolvedValue({ pro: true, permanent: true, sources: ['stripe_or_gift_lifetime'], trial: false, effectiveInterval: 'lifetime' });
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1', cancel_reason: 'CUSTOMER_SUPPORT', id: 'evt_11c3' } }, SECRET);
    expect(res.status).toBe(200);
    expect(syncRevenueCatEntitlementFromProvider).toHaveBeenCalledWith('user-1');
    expect(setUserPlan).not.toHaveBeenCalled(); // the route itself never second-guesses the sync's decision
  });

  it('11c4. CUSTOMER_SUPPORT + provider lookup FAILS => the event 500s and is marked failed, no guessed mutation', async () => {
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    syncRevenueCatEntitlementFromProvider.mockRejectedValue(new Error('RevenueCat lookup failed'));
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1', cancel_reason: 'CUSTOMER_SUPPORT', id: 'evt_11c4' } }, SECRET);
    expect(res.status).toBe(500);
    expect(markFailed).toHaveBeenCalledWith('evt_11c4', expect.any(String), expect.anything());
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('11d. CANCELLATION with no cancel_reason at all defaults to the safe no-op (does not revoke, does not sync)', async () => {
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1', id: 'evt_11d' } }, SECRET);
    expect(res.status).toBe(200);
    expect(revokeRevenueCatEntitlement).not.toHaveBeenCalled();
    expect(syncRevenueCatEntitlementFromProvider).not.toHaveBeenCalled();
  });

  it('11e. REFUND_REVERSED syncs against authoritative RC state (not product_id) via the same sync helper, and is NOT treated as a first-time grant', async () => {
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'REFUND_REVERSED', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_11e' } }, SECRET);
    expect(res.status).toBe(200);
    expect(syncRevenueCatEntitlementFromProvider).toHaveBeenCalledWith('user-1');
    expect(setUserPlan).not.toHaveBeenCalled(); // no welcome-path grant call from the route itself
  });

  it('11e2. REFUND_REVERSED + provider lookup fails => 500, marked failed, no guessed mutation', async () => {
    findById.mockResolvedValue(USER);
    syncRevenueCatEntitlementFromProvider.mockRejectedValue(new Error('RevenueCat lookup failed'));
    const res = await post({ event: { type: 'REFUND_REVERSED', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_11e2' } }, SECRET);
    expect(res.status).toBe(500);
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('11f. PRODUCT_CHANGE is ignored entirely — no grant/revoke, product_id may not be the effective product yet', async () => {
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'PRODUCT_CHANGE', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_11f' } }, SECRET);
    expect(res.status).toBe(200);
    const json = res.json as { ok: boolean; ignored: string };
    expect(json.ignored).toBe('PRODUCT_CHANGE');
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('12. TRANSFER — monthly transfer: source loses RC, destination gets RC monthly (real transferred_to shape, authoritative state, no guessing)', async () => {
    const SOURCE = { id: 'source-user', email: 'source@example.com', name: 'Source', plan: 'pro' };
    const DEST   = { id: 'dest-user',   email: 'dest@example.com',   name: 'Dest',   plan: 'free' };
    findById.mockImplementation(async (id: string) => (id === 'old-identity' ? SOURCE : id === 'new-identity' ? DEST : undefined));
    fetchAuthoritativeRevenueCatState.mockImplementation(async (id: string) =>
      id === 'old-identity'
        ? { customerFound: true, active: false, interval: null, productId: null, customerId: 'rc_old' }   // source lost it
        : { customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_new' }, // destination has it
    );
    const res = await post({ event: { type: 'TRANSFER', transferred_from: ['old-identity'], transferred_to: ['new-identity'], id: 'evt_12' } }, SECRET);
    expect(res.status).toBe(200);
    // Destination gets the EXACT authoritative interval — never guessed.
    expect(setUserPlan).toHaveBeenCalledWith('dest-user', 'pro', expect.objectContaining({ revenueCat: expect.objectContaining({ interval: 'monthly' }) }));
    // Source's RC contribution is cleared via the same reconciling revoke used elsewhere.
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('source-user');
  });

  it('12b. TRANSFER — Lifetime transfer: source loses RC, destination gets RC lifetime EXACTLY, never guessed as monthly', async () => {
    const SOURCE = { id: 'source-user', email: 'source@example.com', name: 'Source', plan: 'pro' };
    const DEST   = { id: 'dest-user',   email: 'dest@example.com',   name: 'Dest',   plan: 'free' };
    findById.mockImplementation(async (id: string) => (id === 'old-identity' ? SOURCE : id === 'new-identity' ? DEST : undefined));
    fetchAuthoritativeRevenueCatState.mockImplementation(async (id: string) =>
      id === 'old-identity'
        ? { customerFound: true, active: false, interval: null, productId: null, customerId: 'rc_old' }
        : { customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_new' },
    );
    const res = await post({ event: { type: 'TRANSFER', transferred_from: ['old-identity'], transferred_to: ['new-identity'], id: 'evt_12b' } }, SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledWith('dest-user', 'pro', expect.objectContaining({ revenueCat: expect.objectContaining({ interval: 'lifetime' }) }));
  });

  it('12c. TRANSFER — source ALSO has Stripe Lifetime: RC contribution removed, but revokeRevenueCatEntitlement (which preserves surviving sources) is still what\'s called, never a bare downgrade', async () => {
    const SOURCE = { id: 'source-user', email: 'source@example.com', name: 'Source', plan: 'pro' };
    const DEST   = { id: 'dest-user',   email: 'dest@example.com',   name: 'Dest',   plan: 'free' };
    findById.mockImplementation(async (id: string) => (id === 'old-identity' ? SOURCE : id === 'new-identity' ? DEST : undefined));
    fetchAuthoritativeRevenueCatState.mockImplementation(async (id: string) =>
      id === 'old-identity'
        ? { customerFound: true, active: false, interval: null, productId: null, customerId: 'rc_old' }
        : { customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_new' },
    );
    revokeRevenueCatEntitlement.mockResolvedValue({ pro: true, permanent: true, sources: ['stripe_or_gift_lifetime'], trial: false, effectiveInterval: 'lifetime' });
    const res = await post({ event: { type: 'TRANSFER', transferred_from: ['old-identity'], transferred_to: ['new-identity'], id: 'evt_12c' } }, SECRET);
    expect(res.status).toBe(200);
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('source-user');
    // The route trusts revokeRevenueCatEntitlement's own surviving-source logic — it never independently touches source-user's plan.
    expect(setUserPlan).not.toHaveBeenCalledWith('source-user', expect.anything(), expect.anything());
  });

  it('12e. TRANSFER — destination already has its own Stripe subscription: setUserPlan is still called with the RC grant, ending with multiple valid sources (resolver-level concern, not this route\'s)', async () => {
    const DEST = { id: 'dest-user', email: 'dest@example.com', name: 'Dest', plan: 'pro' };
    findById.mockImplementation(async (id: string) => (id === 'new-identity' ? DEST : undefined));
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_new' });
    const res = await post({ event: { type: 'TRANSFER', transferred_to: ['new-identity'], id: 'evt_12e' } }, SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledWith('dest-user', 'pro', expect.objectContaining({ revenueCat: expect.objectContaining({ active: true }) }));
  });

  it('12f. TRANSFER — multiple transferred_from/to identities: every resolvable GasCap identity is reconciled', async () => {
    const SOURCE1 = { id: 'source-1', email: 's1@example.com', name: 'S1', plan: 'pro' };
    const SOURCE2 = { id: 'source-2', email: 's2@example.com', name: 'S2', plan: 'pro' };
    const DEST    = { id: 'dest-1',   email: 'd1@example.com', name: 'D1', plan: 'free' };
    findById.mockImplementation(async (id: string) => {
      if (id === 'old-1') return SOURCE1;
      if (id === 'old-2') return SOURCE2;
      if (id === 'new-1') return DEST;
      return undefined;
    });
    fetchAuthoritativeRevenueCatState.mockImplementation(async (id: string) =>
      id === 'new-1'
        ? { customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_new' }
        : { customerFound: true, active: false, interval: null, productId: null, customerId: `rc_${id}` },
    );
    const res = await post({ event: { type: 'TRANSFER', transferred_from: ['old-1', 'old-2'], transferred_to: ['new-1'], id: 'evt_12f' } }, SECRET);
    expect(res.status).toBe(200);
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('source-1');
    expect(revokeRevenueCatEntitlement).toHaveBeenCalledWith('source-2');
    expect(setUserPlan).toHaveBeenCalledWith('dest-1', 'pro', expect.anything());
  });

  it('12g. TRANSFER — an RC API failure BEFORE any mutation => no partial guessed update, event 500s and is marked failed', async () => {
    const DEST = { id: 'dest-user', email: 'dest@example.com', name: 'Dest', plan: 'free' };
    findById.mockImplementation(async (id: string) => (id === 'new-identity' ? DEST : undefined));
    fetchAuthoritativeRevenueCatState.mockRejectedValue(new Error('RevenueCat API unreachable'));
    const res = await post({ event: { type: 'TRANSFER', transferred_to: ['new-identity'], id: 'evt_12g' } }, SECRET);
    expect(res.status).toBe(500);
    expect(setUserPlan).not.toHaveBeenCalled(); // gather-before-mutate: the failed lookup happens before any write
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('12h. TRANSFER — a lookup failure for the SECOND identity still prevents the FIRST from being left in a guessed state (gather-all-before-mutate)', async () => {
    const SOURCE = { id: 'source-user', email: 'source@example.com', name: 'Source', plan: 'pro' };
    const DEST   = { id: 'dest-user',   email: 'dest@example.com',   name: 'Dest',   plan: 'free' };
    findById.mockImplementation(async (id: string) => (id === 'old-identity' ? SOURCE : id === 'new-identity' ? DEST : undefined));
    fetchAuthoritativeRevenueCatState.mockImplementation(async (id: string) => {
      if (id === 'old-identity') return { customerFound: true, active: false, interval: null, productId: null, customerId: 'rc_old' };
      throw new Error('lookup failed for the destination');
    });
    const res = await post({ event: { type: 'TRANSFER', transferred_from: ['old-identity'], transferred_to: ['new-identity'], id: 'evt_12h' } }, SECRET);
    expect(res.status).toBe(500);
    // Neither side was mutated — the source's clear never happened either,
    // even though ITS lookup succeeded, because mutation only starts after
    // ALL lookups succeed.
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(revokeRevenueCatEntitlement).not.toHaveBeenCalled();
  });

  it('12d. TRANSFER with no resolvable identities at all is unmatched, not a crash', async () => {
    findById.mockResolvedValue(undefined);
    findByEmail.mockResolvedValue(undefined);
    const res = await post({ event: { type: 'TRANSFER', transferred_from: ['old-identity'], id: 'evt_12d' } }, SECRET);
    expect(res.status).toBe(200);
    const json = res.json as { unmatched?: boolean };
    expect(json.unmatched).toBe(true);
  });

  it('12b. resolves the user via original_app_user_id and aliases', async () => {
    findById.mockImplementation(async (id: string) => (id === 'legacy-id' ? USER : undefined));
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'new-id', original_app_user_id: 'legacy-id', product_id: 'gascap_pro_monthly', id: 'evt_12b' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalled();
  });

  it('12c. falls back to email lookup when the id is an email', async () => {
    findById.mockResolvedValue(undefined);
    findByEmail.mockImplementation(async (e: string) => (e === 'buyer@example.com' ? USER : undefined));
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'buyer@example.com', product_id: 'gascap_pro_monthly', id: 'evt_12c' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalled();
  });
});

// ── Idempotency (Sprint 2) ───────────────────────────────────────────────────
describe('duplicate event delivery', () => {
  it('the same event.id twice causes exactly ONE entitlement mutation', async () => {
    findById.mockResolvedValue(USER);
    const ev = { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_dup_1' };
    await post({ event: ev }, SECRET);
    await post({ event: ev }, SECRET);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
  });

  it('the same event.id twice causes exactly ONE welcome-email/push side effect', async () => {
    const { sendPaidCampaignEmail } = await import('@/lib/emailCampaignPaid');
    const { sendUserPush } = await import('@/lib/userPush');
    findById.mockResolvedValue(USER);
    const ev = { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_dup_2' };
    await post({ event: ev }, SECRET);
    await post({ event: ev }, SECRET);
    expect(sendPaidCampaignEmail).toHaveBeenCalledTimes(1);
    expect(sendUserPush).toHaveBeenCalledTimes(1);
  });

  it('a duplicate is reported back as ok:true, duplicate:true — RevenueCat should not retry it', async () => {
    findById.mockResolvedValue(USER);
    const ev = { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_dup_3' };
    await post({ event: ev }, SECRET);
    const second = await post({ event: ev }, SECRET);
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ ok: true, duplicate: true });
  });

  it('two DIFFERENT event ids for the same user both process normally (not falsely deduped)', async () => {
    findById.mockResolvedValue(USER);
    await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_a' } }, SECRET);
    await post({ event: { type: 'RENEWAL', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_b' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalledTimes(2);
  });

  it('post-Sprint-2 Revision 1: an actionable event with no id is now REJECTED (fail-safe), not processed', async () => {
    // event.id is confirmed always-present per RevenueCat's current docs, so
    // its absence on an actionable grant/revoke event is anomalous — the
    // route now skips granting/revoking rather than trusting an
    // unverifiable payload. This replaces the old "falls through to
    // processing unconditionally" behavior.
    findById.mockResolvedValue(USER);
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly' } }, SECRET);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, skipped: 'missing_event_id' });
    expect(setUserPlan).not.toHaveBeenCalled();
    expect(claimEvent).not.toHaveBeenCalled();
  });

  it('a failed attempt is marked failed, not silently swallowed, and the request 500s', async () => {
    findById.mockResolvedValue(USER);
    setUserPlan.mockRejectedValueOnce(new Error('db unavailable'));
    const res = await post({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_fail' } }, SECRET);
    expect(res.status).toBe(500);
    expect(markFailed).toHaveBeenCalledWith('evt_fail', expect.any(String), expect.anything());
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('a failed attempt remains safely retryable — a later delivery of the same id processes normally', async () => {
    findById.mockResolvedValue(USER);
    setUserPlan.mockRejectedValueOnce(new Error('transient failure'));
    const ev = { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', product_id: 'gascap_pro_monthly', id: 'evt_retry' };
    const first = await post({ event: ev }, SECRET);
    expect(first.status).toBe(500);
    // Simulate the retry being allowed through by the store (a real 'failed'
    // row is reclaimed in lib/revenueCatEvents.ts — see its own unit tests).
    eventStore.delete('evt_retry');
    const second = await post({ event: ev }, SECRET);
    expect(second.status).toBe(200);
    // Called twice — once rejected, once resolved — because a failed attempt
    // was retried rather than either silently repeated-and-ignored or
    // permanently blocked. The assertion that matters is the second call
    // actually went through (200, not another 500).
    expect(setUserPlan).toHaveBeenCalledTimes(2);
  });
});
