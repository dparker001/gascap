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

vi.mock('@/lib/users', () => ({
  setUserPlan:        (...a: unknown[]) => setUserPlan(...(a as [])),
  findById:           (id: string) => findById(id),
  findByEmail:        (e: string) => findByEmail(e),
  enrollPaidCampaign: vi.fn(async () => {}),
  revokeRevenueCatEntitlement: (...a: unknown[]) => revokeRevenueCatEntitlement(...(a as [])),
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

  it('11b. CANCELLATION does not revoke — access runs to EXPIRATION', async () => {
    // Auto-renew off is not loss of access. Revoking here would cut a paying
    // customer off early, for the remainder they already paid for.
    findById.mockResolvedValue({ ...USER, plan: 'pro' });
    const res = await post({ event: { type: 'CANCELLATION', app_user_id: 'user-1' } }, SECRET);
    expect(res.status).toBe(200);
    expect(setUserPlan).not.toHaveBeenCalled();
  });

  it('12. grants on TRANSFER (restore to a new app_user_id)', async () => {
    findById.mockResolvedValue(USER);
    await post({ event: { type: 'TRANSFER', app_user_id: 'user-1', product_id: 'gascap_pro_lifetime', id: 'evt_12' } }, SECRET);
    expect(setUserPlan).toHaveBeenCalled();
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
