/**
 * Growth Sprint 1, P0B — regression coverage for the RevenueCat webhook's
 * new purchase_completed first-party analytics write, added inside
 * doGrant() in app/api/native/revenuecat/route.ts.
 *
 * This does NOT test entitlement logic (setUserPlan, claim/markProcessed,
 * CANCELLATION/TRANSFER/REFUND_REVERSED handling, etc.) — those are
 * pre-existing, unchanged, and already covered by
 * __tests__/revenuecatWebhook.test.ts. It tests only: (1) the production-
 * only, fail-closed purchase_completed classifier, (2) originPlatform
 * mapping, (3) wasOnGasCapTrial capture, (4) failure isolation, and (5)
 * idempotency key format. Mocking follows the same scaffold as
 * __tests__/revenuecatWebhook.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const setUserPlan = vi.fn(async () => {});
const findById    = vi.fn(async (_id: string) => undefined as unknown);
const findByEmail = vi.fn(async (_e: string) => undefined as unknown);
const enrollPaidCampaign = vi.fn(async (..._a: unknown[]) => {});
const revokeRevenueCatEntitlement = vi.fn(async (): Promise<{ pro: boolean; permanent: boolean; sources: string[]; trial: boolean; effectiveInterval: string | null }> => ({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null }));
const syncRevenueCatEntitlementFromProvider = vi.fn(async (): Promise<{ pro: boolean; permanent: boolean; sources: string[]; trial: boolean; effectiveInterval: string | null }> => ({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null }));

vi.mock('@/lib/users', () => ({
  setUserPlan:        (...a: unknown[]) => setUserPlan(...(a as [])),
  findById:           (id: string) => findById(id),
  findByEmail:        (e: string) => findByEmail(e),
  enrollPaidCampaign: (...a: unknown[]) => enrollPaidCampaign(...(a as [])),
  revokeRevenueCatEntitlement: (...a: unknown[]) => revokeRevenueCatEntitlement(...(a as [])),
  syncRevenueCatEntitlementFromProvider: (...a: unknown[]) => syncRevenueCatEntitlementFromProvider(...(a as [])),
}));

const fetchAuthoritativeRevenueCatState = vi.fn();
vi.mock('@/lib/revenueCatApi', () => ({
  fetchAuthoritativeRevenueCatState: (id: string) => fetchAuthoritativeRevenueCatState(id),
}));
const userUpdateMany = vi.fn(async () => ({ count: 1 }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { updateMany: (...a: unknown[]) => userUpdateMany(...(a as [])) } } }));
vi.mock('@/lib/email',              () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/emailCampaignPaid',  () => ({ sendPaidCampaignEmail: vi.fn(async () => {}) }));
vi.mock('@/lib/userPush',           () => ({ sendUserPush: vi.fn(async () => {}) }));
vi.mock('@/lib/getawayPromo',       () => ({
  getawayPromoActive: () => false,
  GETAWAY_DISCLOSURE: '',
}));

type RecordAnalyticsEventResult = { outcome: 'written'; id: string } | { outcome: 'duplicate' };
const recordAnalyticsEvent = vi.fn(async (..._a: unknown[]): Promise<RecordAnalyticsEventResult> => ({ outcome: 'written', id: 'evt_1' }));
vi.mock('@/lib/analyticsEvents', () => ({
  recordAnalyticsEvent: (...a: unknown[]) => recordAnalyticsEvent(...(a as [])),
}));

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

async function post(body: unknown) {
  const { POST } = await import('@/app/api/native/revenuecat/route');
  const headers = new Headers({ 'content-type': 'application/json', authorization: SECRET });
  const req = new Request('https://www.gascap.app/api/native/revenuecat', {
    method: 'POST', headers,
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json().catch(() => null) };
}

interface EventOpts {
  id?: string;
  type: string;
  productId?: string;
  periodType?: string;
  environment?: string;
  store?: string;
  price?: number;
  currency?: string;
  cancelReason?: string;
}

function makeEvent(opts: EventOpts) {
  return {
    event: {
      id: opts.id ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
      type: opts.type,
      app_user_id: 'user-1',
      product_id: opts.productId,
      period_type: opts.periodType,
      environment: opts.environment,
      store: opts.store,
      price: opts.price,
      currency: opts.currency,
      cancel_reason: opts.cancelReason,
    },
  };
}

const USER = { id: 'user-1', email: 'buyer@example.com', name: 'Buyer', plan: 'free', isProTrial: false, paidCampaignEnrolledAt: '2026-01-01' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  eventStore.clear();
  process.env.REVENUECAT_WEBHOOK_AUTH = SECRET;
  findById.mockResolvedValue(USER);
  findByEmail.mockResolvedValue(undefined);
  revokeRevenueCatEntitlement.mockResolvedValue({ pro: false, permanent: false, sources: [], trial: false, effectiveInterval: null });
  syncRevenueCatEntitlementFromProvider.mockResolvedValue({ pro: true, permanent: false, sources: ['revenuecat'], trial: false, effectiveInterval: 'monthly' });
  fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_1' });
  recordAnalyticsEvent.mockResolvedValue({ outcome: 'written', id: 'evt_1' });
});

describe('RevenueCat webhook — purchase_completed analytics', () => {
  it('A. production APP_STORE monthly INITIAL_PURCHASE + NORMAL → one monthly purchase_completed, originPlatform ios', async () => {
    await post(makeEvent({
      id: 'evt_a', type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly',
      periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({
      eventType: 'purchase_completed', emitter: 'webhook', provider: 'revenuecat',
      billing: 'monthly', originPlatform: 'ios', userId: 'user-1',
      idempotencyKey: 'revenuecat:evt_a',
    });
  });

  it('B. production APP_STORE lifetime NON_RENEWING_PURCHASE → one lifetime purchase_completed', async () => {
    await post(makeEvent({
      id: 'evt_b', type: 'NON_RENEWING_PURCHASE', productId: 'gascap_pro_lifetime',
      periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).toHaveBeenCalledTimes(1);
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.billing).toBe('lifetime');
  });

  it('C. RENEWAL → no purchase_completed', async () => {
    await post(makeEvent({
      type: 'RENEWAL', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('D. UNCANCELLATION → no purchase_completed', async () => {
    await post(makeEvent({
      type: 'UNCANCELLATION', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('E. monthly INITIAL_PURCHASE period_type=TRIAL → no purchase_completed', async () => {
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'TRIAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('F. monthly INITIAL_PURCHASE missing period_type → no purchase_completed (fail-closed)', async () => {
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('G. SANDBOX monthly → no purchase_completed', async () => {
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'SANDBOX', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('H. SANDBOX lifetime → no purchase_completed', async () => {
    await post(makeEvent({
      type: 'NON_RENEWING_PURCHASE', productId: 'gascap_pro_lifetime', environment: 'SANDBOX', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('I. PLAY_STORE production monthly → originPlatform android', async () => {
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'PLAY_STORE',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.originPlatform).toBe('android');
  });

  it('J. unknown store production qualifying purchase → originPlatform unknown', async () => {
    await post(makeEvent({
      type: 'NON_RENEWING_PURCHASE', productId: 'gascap_pro_lifetime', environment: 'PRODUCTION', store: 'SOME_OTHER_STORE',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.originPlatform).toBe('unknown');
  });

  it('J2. missing store entirely production qualifying purchase → originPlatform unknown, never guessed', async () => {
    await post(makeEvent({
      type: 'NON_RENEWING_PURCHASE', productId: 'gascap_pro_lifetime', environment: 'PRODUCTION',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.originPlatform).toBe('unknown');
  });

  it('K. resolved user is on internal GasCap trial → metadata.wasOnGasCapTrial === true', async () => {
    findById.mockResolvedValue({ ...USER, isProTrial: true });
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const metadata = call.metadata as Record<string, unknown>;
    expect(metadata.wasOnGasCapTrial).toBe(true);
  });

  it('L. resolved user is not on internal trial → metadata.wasOnGasCapTrial === false', async () => {
    findById.mockResolvedValue({ ...USER, isProTrial: false });
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const metadata = call.metadata as Record<string, unknown>;
    expect(metadata.wasOnGasCapTrial).toBe(false);
  });

  it('M. recordAnalyticsEvent throws → setUserPlan already succeeded, webhook returns normal success, markProcessed still occurs, markFailed does NOT occur', async () => {
    recordAnalyticsEvent.mockRejectedValueOnce(new Error('db unavailable'));
    const { status } = await post(makeEvent({
      id: 'evt_m', type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(status).toBe(200);
    expect(setUserPlan).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('N. stable event id → idempotencyKey exactly revenuecat:<event.id>', async () => {
    await post(makeEvent({
      id: 'evt_stable_123', type: 'NON_RENEWING_PURCHASE', productId: 'gascap_pro_lifetime', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.idempotencyKey).toBe('revenuecat:evt_stable_123');
  });

  it('O. recordAnalyticsEvent returns duplicate → webhook remains successful', async () => {
    recordAnalyticsEvent.mockResolvedValueOnce({ outcome: 'duplicate' as const });
    const { status } = await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(status).toBe(200);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('P. EXPIRATION / REFUND / REFUND_REVERSED / CANCELLATION → no purchase_completed', async () => {
    for (const type of ['EXPIRATION', 'REFUND', 'REFUND_REVERSED']) {
      await post(makeEvent({ type, productId: 'gascap_pro_monthly', environment: 'PRODUCTION', store: 'APP_STORE' }));
    }
    await post(makeEvent({ type: 'CANCELLATION', cancelReason: 'CUSTOMER_SUPPORT', productId: 'gascap_pro_monthly', environment: 'PRODUCTION', store: 'APP_STORE' }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('Q. TRANSFER → no purchase_completed', async () => {
    await post({
      event: {
        id: 'evt_transfer', type: 'TRANSFER', environment: 'PRODUCTION',
        transferred_from: ['user-1'], transferred_to: ['user-2'],
      },
    });
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('R. PRODUCT_CHANGE → no purchase_completed', async () => {
    await post(makeEvent({
      type: 'PRODUCT_CHANGE', productId: 'gascap_pro_monthly', environment: 'PRODUCTION', store: 'APP_STORE',
    }));
    expect(recordAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('metadata is small and non-PII — no app_user_id, aliases, transaction ids, email, or raw payload', async () => {
    await post(makeEvent({
      type: 'INITIAL_PURCHASE', productId: 'gascap_pro_monthly', periodType: 'NORMAL',
      environment: 'PRODUCTION', store: 'APP_STORE', price: 2.99, currency: 'USD',
    }));
    const call = recordAnalyticsEvent.mock.calls[0][0] as Record<string, unknown>;
    const metadata = call.metadata as Record<string, unknown>;
    expect(metadata).toEqual({ productId: 'gascap_pro_monthly', wasOnGasCapTrial: false, environment: 'PRODUCTION', price: 2.99, currency: 'USD' });
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain('buyer@example.com');
    expect(serialized).not.toContain('app_user_id');
  });
});
