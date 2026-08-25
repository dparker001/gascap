/**
 * lib/getawayFulfillment.ts — the 7-day getaway verification hold.
 *
 * Covers the fail-closed authoritative re-verification required at
 * fulfillment time (2026-08-25 correction): the GasCap DB alone is never
 * trusted as proof of continued entitlement for a RevenueCat-provenance
 * Lifetime at the end of the hold — a fresh fetchAuthoritativeRevenueCatState
 * + reconcileRevenueCatState() call (the same choke point every other
 * RevenueCat grant path uses) must confirm it first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface Row {
  id: string; email: string; name: string;
  stripeInterval: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive: boolean;
  revenueCatInterval: string | null;
  getawayDestinationId: string | null;
  getawayFulfillmentStatus: string | null;
  getawayHoldUntil: string | null;
  getawayQualificationRevokedAt: string | null;
  getawayFulfilledAt: string | null;
  getawayFulfillmentAttemptedAt: string | null;
}

const table = new Map<string, Row>();

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'user-1', email: 'buyer@example.com', name: 'Buyer',
    stripeInterval: null, ambassadorProForLife: false,
    revenueCatActive: true, revenueCatInterval: 'lifetime',
    getawayDestinationId: 'atlanta', getawayFulfillmentStatus: 'pending',
    getawayHoldUntil: new Date(Date.now() - 60_000).toISOString(), // elapsed by default
    getawayQualificationRevokedAt: null, getawayFulfilledAt: null,
    getawayFulfillmentAttemptedAt: null,
    ...overrides,
  };
}

const prismaMock = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => table.get(where.id) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const row = table.get(where.id as string);
      if (!row) return { count: 0 };
      for (const [key, cond] of Object.entries(where)) {
        if (key === 'id') continue;
        if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
          if (!(cond as { in: unknown[] }).in.includes((row as unknown as Record<string, unknown>)[key])) return { count: 0 };
        } else if ((row as unknown as Record<string, unknown>)[key] !== cond) {
          return { count: 0 };
        }
      }
      Object.assign(row, data);
      return { count: 1 };
    }),
  },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const sendMail = vi.fn(async () => {});
vi.mock('@/lib/email', () => ({ sendMail: (...a: unknown[]) => sendMail(...(a as [])) }));

interface FakeResolved { pro: boolean; permanent: boolean; effectiveInterval: 'monthly' | 'lifetime' | null; sources: string[]; trial: boolean; }
class CrossAccountLifetimeOwnershipError extends Error {
  constructor(public readonly userId: string, public readonly originalCustomerId: string) { super('cross-account'); this.name = 'CrossAccountLifetimeOwnershipError'; }
}
class UnverifiableLifetimeOwnershipError extends Error {
  constructor(public readonly userId: string) { super('unverifiable'); this.name = 'UnverifiableLifetimeOwnershipError'; }
}
const reconcileRevenueCatState = vi.fn(async (_id: string, _state: unknown): Promise<FakeResolved> => ({
  pro: true, permanent: false, effectiveInterval: 'lifetime', sources: ['revenuecat'], trial: false,
}));
/**
 * Mirrors the real reconcileRevenueCatState()'s side effect: when RC no
 * longer confirms an active entitlement, it actually WRITES
 * revenueCatActive=false/revenueCatInterval=null to the DB before
 * returning. Tests simulating "no longer active" call this alongside
 * `.mockResolvedValue(...)` so the fulfillment helper's own re-read of the
 * row reflects what a real deploy would have already persisted.
 */
function simulateRevenueCatRevoke(userId: string) {
  const row = table.get(userId);
  if (row) { row.revenueCatActive = false; row.revenueCatInterval = null; }
}
vi.mock('@/lib/users', () => ({
  reconcileRevenueCatState: (id: string, state: unknown) => reconcileRevenueCatState(id, state),
  CrossAccountLifetimeOwnershipError,
  UnverifiableLifetimeOwnershipError,
}));

const fetchAuthoritativeRevenueCatState = vi.fn(async (id: string, _env?: string) => ({
  customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
  customerId: id, originalCustomerId: id,
}));
const isSandboxTestAccount = vi.fn((_email?: string | null) => false);
vi.mock('@/lib/revenueCatApi', () => ({
  fetchAuthoritativeRevenueCatState: (id: string, env?: string) => fetchAuthoritativeRevenueCatState(id, env),
  isSandboxTestAccount: (email: string | null | undefined) => isSandboxTestAccount(email),
}));

type VacationIncentiveOutcome =
  | { outcome: 'sent'; message?: string }
  | { outcome: 'rejected'; error: string }
  | { outcome: 'unknown'; error: string };
const sendVacationIncentive = vi.fn(async (): Promise<VacationIncentiveOutcome> => ({ outcome: 'sent', message: 'ok' }));
vi.mock('@/lib/marketingBoost', () => ({
  sendVacationIncentive: (...a: unknown[]) => sendVacationIncentive(...(a as [])),
}));

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
  reconcileRevenueCatState.mockResolvedValue({ pro: true, permanent: false, effectiveInterval: 'lifetime', sources: ['revenuecat'], trial: false });
  fetchAuthoritativeRevenueCatState.mockResolvedValue({
    customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
    customerId: 'user-1', originalCustomerId: 'user-1',
  });
  isSandboxTestAccount.mockReturnValue(false);
  sendVacationIncentive.mockResolvedValue({ outcome: 'sent', message: 'ok' });
});

async function getModule() {
  vi.resetModules();
  return import('@/lib/getawayFulfillment');
}

describe('attemptGetawayFulfillment — RevenueCat-provenance authoritative re-verification', () => {
  it('1/3. same-owner authoritative RevenueCat Lifetime at day 7 → eligible, sent', async () => {
    table.set('user-1', makeRow());
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'sent', destination: 'atlanta' });
    expect(table.get('user-1')!.getawayFulfillmentStatus).toBe('sent');
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledWith('user-1', 'production');
  });

  it('2. DB says RC Lifetime active, but authoritative RevenueCat provider says inactive at fulfillment time → NO fulfillment', async () => {
    table.set('user-1', makeRow());
    reconcileRevenueCatState.mockResolvedValue({ pro: false, permanent: false, effectiveInterval: null, sources: [], trial: false });
    simulateRevenueCatRevoke('user-1');
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'entitlement_lost' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(table.get('user-1')!.getawayFulfillmentStatus).toBe('pending'); // unchanged, not resent
    expect(table.get('user-1')!.getawayQualificationRevokedAt).not.toBeNull(); // stamped, auditable
  });

  it('2b. RevenueCat API lookup fails at fulfillment time → NO fulfillment, left pending (not revoked)', async () => {
    table.set('user-1', makeRow());
    fetchAuthoritativeRevenueCatState.mockRejectedValue(new Error('RevenueCat API down'));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'provider_unverifiable' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(table.get('user-1')!.getawayFulfillmentStatus).toBe('pending');
    expect(table.get('user-1')!.getawayQualificationRevokedAt).toBeNull(); // provider unavailability != proven revocation
  });

  it('4. cross-account RevenueCat Lifetime at day 7 → blocked before fulfillment, never revoked (ownership unproven, not proven-refunded)', async () => {
    table.set('user-1', makeRow());
    reconcileRevenueCatState.mockRejectedValue(new CrossAccountLifetimeOwnershipError('user-1', 'other-user'));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'provider_unverifiable' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(table.get('user-1')!.getawayQualificationRevokedAt).toBeNull();
  });

  it('unverifiable ownership (originalCustomerId missing) at day 7 → blocked before fulfillment', async () => {
    table.set('user-1', makeRow());
    reconcileRevenueCatState.mockRejectedValue(new UnverifiableLifetimeOwnershipError('user-1'));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'provider_unverifiable' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('6a. getaway remains pending at hour 0 (hold not elapsed) — no RevenueCat call at all', async () => {
    table.set('user-1', makeRow({ getawayHoldUntil: new Date(Date.now() + 71 * 60 * 60 * 1000).toISOString() }));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'hold_not_elapsed' });
    expect(fetchAuthoritativeRevenueCatState).not.toHaveBeenCalled();
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('6b. getaway still pending at 71:59 (one minute before the 72-hour hold elapses) — no RevenueCat call, no Marketing Boost call', async () => {
    table.set('user-1', makeRow({ getawayHoldUntil: new Date(Date.now() + 60 * 1000).toISOString() })); // 1 minute remaining
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'hold_not_elapsed' });
    expect(fetchAuthoritativeRevenueCatState).not.toHaveBeenCalled();
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('7. becomes eligible at/after the 72-hour mark only after the authoritative entitlement re-check runs (not merely because the hold elapsed)', async () => {
    table.set('user-1', makeRow({ getawayHoldUntil: new Date(Date.now() - 1000).toISOString() }));
    const { attemptGetawayFulfillment } = await getModule();
    await attemptGetawayFulfillment('user-1');
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledTimes(1);
    expect(reconcileRevenueCatState).toHaveBeenCalledTimes(1);
  });

  it('8. refunded/revoked purchase discovered exactly at day 7 does not fulfill', async () => {
    table.set('user-1', makeRow());
    reconcileRevenueCatState.mockResolvedValue({ pro: false, permanent: false, effectiveInterval: null, sources: [], trial: false });
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result.outcome).toBe('not_ready');
    expect(table.get('user-1')!.getawayFulfillmentStatus).not.toBe('sent');
  });

  it('9. already-sent getaway is never resent or deleted, even if later called again', async () => {
    table.set('user-1', makeRow({ getawayFulfillmentStatus: 'sent', getawayFulfilledAt: '2026-08-20T00:00:00.000Z' }));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'not_pending' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(table.get('user-1')!.getawayFulfilledAt).toBe('2026-08-20T00:00:00.000Z'); // untouched
  });

  it('5. getawayFulfillmentStatus stays "pending" when qualification is revoked — no "revoked" fulfillment status value is ever introduced', async () => {
    table.set('user-1', makeRow());
    reconcileRevenueCatState.mockResolvedValue({ pro: false, permanent: false, effectiveInterval: null, sources: [], trial: false });
    simulateRevenueCatRevoke('user-1');
    const { attemptGetawayFulfillment } = await getModule();
    await attemptGetawayFulfillment('user-1');
    const row = table.get('user-1')!;
    expect(row.getawayFulfillmentStatus).toBe('pending');
    expect(['pending', 'sent', 'manual_required']).toContain(row.getawayFulfillmentStatus);
    expect(row.getawayQualificationRevokedAt).not.toBeNull();
  });

  it('qualification already revoked → blocked immediately, no RevenueCat call at all', async () => {
    table.set('user-1', makeRow({ getawayQualificationRevokedAt: '2026-08-24T00:00:00.000Z' }));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'qualification_revoked' });
    expect(fetchAuthoritativeRevenueCatState).not.toHaveBeenCalled();
  });

  it('3. Stripe/gift Lifetime — no RevenueCat call at all, fulfilled from DB provenance alone', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null }));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'sent', destination: 'atlanta' });
    expect(fetchAuthoritativeRevenueCatState).not.toHaveBeenCalled();
    expect(reconcileRevenueCatState).not.toHaveBeenCalled();
  });

  it('Stripe Lifetime remains active/fulfillable even if a RevenueCat purchase on the SAME account is refunded — never checks RC for Stripe provenance', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null }));
    fetchAuthoritativeRevenueCatState.mockRejectedValue(new Error('should never be called'));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result.outcome).toBe('sent');
  });

  it('2c. ambiguous Marketing Boost result leaves the record pending, stamps the durable claim, and PERMANENTLY blocks automatic retry (2026-08-25 merge-blocker fix)', async () => {
    table.set('user-1', makeRow());
    sendVacationIncentive.mockResolvedValue({ outcome: 'unknown', error: 'network blip' });
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'ambiguous', destination: 'atlanta' });
    expect(table.get('user-1')!.getawayFulfillmentStatus).toBe('pending');
    expect(table.get('user-1')!.getawayFulfillmentAttemptedAt).not.toBeNull(); // durable claim stamped

    // A second attempt — even if Marketing Boost would now definitively
    // succeed — must NEVER call Marketing Boost again. The durable claim
    // (getawayFulfillmentAttemptedAt) is never cleared automatically.
    sendVacationIncentive.mockClear();
    sendVacationIncentive.mockResolvedValue({ outcome: 'sent', message: 'ok' });
    const second = await attemptGetawayFulfillment('user-1');
    expect(second).toEqual({ outcome: 'not_ready', reason: 'already_claimed' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(table.get('user-1')!.getawayFulfillmentStatus).toBe('pending'); // never fabricated as sent
  });

  it('marketing boost rejected → manual_required, not resent on a later call', async () => {
    table.set('user-1', makeRow());
    sendVacationIncentive.mockResolvedValue({ outcome: 'rejected', error: 'destination sold out' });
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'manual_required', destination: 'atlanta' });

    const second = await attemptGetawayFulfillment('user-1');
    expect(second).toEqual({ outcome: 'not_ready', reason: 'not_pending' });
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
  });

  it('sandbox test account uses sandbox environment for the fulfillment-time re-check', async () => {
    table.set('user-1', makeRow({ email: 'dparker001+gascap-lifetime7@gmail.com' }));
    isSandboxTestAccount.mockReturnValue(true);
    const { attemptGetawayFulfillment } = await getModule();
    await attemptGetawayFulfillment('user-1');
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledWith('user-1', 'sandbox');
  });
});

describe('stampGetawayHoldUntil — idempotent 72-hour stamp', () => {
  it('stamps ~72 hours from now when null, and never moves the clock on a repeat call', async () => {
    table.set('user-1', makeRow({ getawayHoldUntil: null }));
    const { stampGetawayHoldUntil, GETAWAY_HOLD_HOURS } = await getModule();
    await stampGetawayHoldUntil('user-1');
    const first = table.get('user-1')!.getawayHoldUntil;
    expect(first).not.toBeNull();
    const deltaMs = Date.parse(first!) - Date.now();
    expect(deltaMs).toBeGreaterThan((GETAWAY_HOLD_HOURS * 60 * 60 * 1000) - 5000);
    expect(deltaMs).toBeLessThan((GETAWAY_HOLD_HOURS * 60 * 60 * 1000) + 5000);

    await stampGetawayHoldUntil('user-1'); // retry — must not move the clock
    expect(table.get('user-1')!.getawayHoldUntil).toBe(first);
  });
});

describe('maybeRevokeGetawayQualification — durable, auditable revocation marker', () => {
  it('never touches an already-sent record', async () => {
    table.set('user-1', makeRow({
      revenueCatActive: false, revenueCatInterval: null,
      getawayFulfillmentStatus: 'sent', getawayFulfilledAt: '2026-08-20T00:00:00.000Z',
    }));
    const { maybeRevokeGetawayQualification } = await getModule();
    await maybeRevokeGetawayQualification('user-1');
    expect(table.get('user-1')!.getawayQualificationRevokedAt).toBeNull();
    expect(table.get('user-1')!.getawayFulfillmentStatus).toBe('sent');
  });

  it('does nothing if a qualifying source still remains (e.g. Stripe Lifetime survives an RC-only revoke)', async () => {
    table.set('user-1', makeRow({ stripeInterval: 'lifetime', revenueCatActive: false, revenueCatInterval: null }));
    const { maybeRevokeGetawayQualification } = await getModule();
    await maybeRevokeGetawayQualification('user-1');
    expect(table.get('user-1')!.getawayQualificationRevokedAt).toBeNull();
  });

  it('stamps the marker once entitlement is genuinely gone, without introducing a new fulfillmentStatus value', async () => {
    table.set('user-1', makeRow({ revenueCatActive: false, revenueCatInterval: null }));
    const { maybeRevokeGetawayQualification } = await getModule();
    await maybeRevokeGetawayQualification('user-1');
    const row = table.get('user-1')!;
    expect(row.getawayQualificationRevokedAt).not.toBeNull();
    expect(row.getawayFulfillmentStatus).toBe('pending');
  });
});

describe('Durable pre-send claim (getawayFulfillmentAttemptedAt) — merge-blocker regression suite (2026-08-25)', () => {
  it('1. two concurrent fulfillment attempts for the same user — only one wins the claim and only one Marketing Boost call occurs', async () => {
    table.set('user-1', makeRow());
    const { attemptGetawayFulfillment } = await getModule();
    const [r1, r2] = await Promise.all([attemptGetawayFulfillment('user-1'), attemptGetawayFulfillment('user-1')]);
    const winner = [r1, r2].find((r) => r.outcome !== 'not_ready');
    const loser  = [r1, r2].find((r) => r.outcome === 'not_ready');
    expect(winner).toEqual({ outcome: 'sent', destination: 'atlanta' });
    expect(loser).toEqual({ outcome: 'not_ready', reason: 'already_claimed' });
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
  });

  it('4. provider lookup failure BEFORE the claim — getawayFulfillmentAttemptedAt stays null, record remains eligible for later retry', async () => {
    table.set('user-1', makeRow());
    fetchAuthoritativeRevenueCatState.mockRejectedValue(new Error('RevenueCat API down'));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'provider_unverifiable' });
    expect(table.get('user-1')!.getawayFulfillmentAttemptedAt).toBeNull();
    expect(sendVacationIncentive).not.toHaveBeenCalled();

    // Retryable: a later call with the provider healthy again succeeds normally.
    fetchAuthoritativeRevenueCatState.mockResolvedValue({
      customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
      customerId: 'user-1', originalCustomerId: 'user-1',
    });
    const retry = await attemptGetawayFulfillment('user-1');
    expect(retry).toEqual({ outcome: 'sent', destination: 'atlanta' });
  });

  it('5. definite Marketing Boost rejection — manual_required AND getawayFulfillmentAttemptedAt set, preserved (not cleared)', async () => {
    table.set('user-1', makeRow());
    sendVacationIncentive.mockResolvedValue({ outcome: 'rejected', error: 'destination sold out' });
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'manual_required', destination: 'atlanta' });
    const row = table.get('user-1')!;
    expect(row.getawayFulfillmentStatus).toBe('manual_required');
    expect(row.getawayFulfillmentAttemptedAt).not.toBeNull();
  });

  it('6. definite Marketing Boost success — sent AND getawayFulfillmentAttemptedAt set, preserved (not cleared)', async () => {
    table.set('user-1', makeRow());
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'sent', destination: 'atlanta' });
    const row = table.get('user-1')!;
    expect(row.getawayFulfillmentStatus).toBe('sent');
    expect(row.getawayFulfillmentAttemptedAt).not.toBeNull();
  });

  it('8. an already-sent record is untouched by a later fulfillment attempt — attemptedAt/fulfilledAt/status all preserved', async () => {
    table.set('user-1', makeRow({
      getawayFulfillmentStatus: 'sent', getawayFulfilledAt: '2026-08-20T00:00:00.000Z',
      getawayFulfillmentAttemptedAt: '2026-08-19T23:59:00.000Z',
    }));
    const { attemptGetawayFulfillment } = await getModule();
    const result = await attemptGetawayFulfillment('user-1');
    expect(result).toEqual({ outcome: 'not_ready', reason: 'not_pending' });
    const row = table.get('user-1')!;
    expect(row.getawayFulfillmentStatus).toBe('sent');
    expect(row.getawayFulfilledAt).toBe('2026-08-20T00:00:00.000Z');
    expect(row.getawayFulfillmentAttemptedAt).toBe('2026-08-19T23:59:00.000Z');
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });
});
