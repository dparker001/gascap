/**
 * GET/POST /api/getaway/choose — provider-neutral Lifetime eligibility AND
 * fulfillment idempotency regression coverage.
 *
 * History:
 *  - Found via live native IAP testing (2026-08-24): the route previously
 *    checked `user.stripeInterval === 'lifetime'` only, permanently 403-ing
 *    a genuine RevenueCat (native IAP) Lifetime owner. Fixed with
 *    hasLifetimeEntitlement() — see LT1-LT5 below.
 *  - A second live regression test then surfaced a stuck client "Loading..."
 *    state despite the server having fully succeeded, exposing that the
 *    route had no fulfillment idempotency at all: Marketing Boost has no
 *    idempotency key or lookup/status endpoint (verified against
 *    lib/marketingBoost.ts and public docs — see
 *    docs/reviews/2026-08-24-getaway-fulfillment-idempotency.md), so an
 *    automatic retry can never be proven safe once a send has happened.
 *    Fixed with an atomic destination claim (conditional on
 *    getawayDestinationId IS NULL) BEFORE any Marketing Boost call, and
 *    conditional pending->sent / pending->manual_required transitions
 *    AFTER, so a stale/duplicate request can never re-send or overwrite a
 *    resolved state. See FP1-FP9 below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

// ── In-memory user store, mimicking Postgres conditional-update semantics ──
// so the atomic-claim and terminal-transition logic can be exercised
// realistically without a real database.
interface FakeUser {
  id: string; email: string; name: string;
  plan: string; isProTrial: boolean;
  stripeInterval: string | null; revenueCatActive: boolean; revenueCatInterval: string | null;
  ambassadorProForLife: boolean;
  getawayDestinationId: string | null;
  getawayDestinationChosenAt: string | null;
  getawayFulfillmentStatus: string | null;
  getawayFulfilledAt: string | null;
  getawayHoldUntil: string | null;
  getawayQualificationRevokedAt: string | null;
  getawayFulfillmentAttemptedAt: string | null;
}

let db: Record<string, FakeUser> = {};

function baseUser(overrides: Partial<FakeUser>): FakeUser {
  return {
    id: 'u1', email: 'buyer@example.com', name: 'Buyer',
    plan: 'pro', isProTrial: false,
    stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
    ambassadorProForLife: false,
    getawayDestinationId: null, getawayDestinationChosenAt: null,
    getawayFulfillmentStatus: null, getawayFulfilledAt: null,
    // Elapsed by default (grandfathered / pre-feature-shaped default) so
    // every pre-existing FP* test below exercises the SAME immediate
    // fulfillment behavior it always did — the 72-hour hold tests explicitly
    // override this to a future timestamp.
    getawayHoldUntil: new Date(Date.now() - 60_000).toISOString(),
    getawayQualificationRevokedAt: null,
    getawayFulfillmentAttemptedAt: null,
    ...overrides,
  };
}

interface FakeResolved { pro: boolean; permanent: boolean; effectiveInterval: 'monthly' | 'lifetime' | null; sources: string[]; trial: boolean; }
class CrossAccountLifetimeOwnershipError extends Error {
  constructor(public readonly userId: string, public readonly originalCustomerId: string) { super('cross-account'); this.name = 'CrossAccountLifetimeOwnershipError'; }
}
class UnverifiableLifetimeOwnershipError extends Error {
  constructor(public readonly userId: string) { super('unverifiable'); this.name = 'UnverifiableLifetimeOwnershipError'; }
}
const findById = vi.fn(async (id: string) => db[id] ?? null);
const reconcileRevenueCatState = vi.fn(async (_id: string, _state: unknown): Promise<FakeResolved> => ({
  pro: true, permanent: false, effectiveInterval: 'lifetime', sources: ['revenuecat'], trial: false,
}));
vi.mock('@/lib/users', () => ({
  findById: (id: string) => findById(id),
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

const updateMany = vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
  const { where, data } = args;
  const row = db[where.id as string];
  if (!row) return { count: 0 };
  for (const [key, val] of Object.entries(where)) {
    if (key === 'id') continue;
    if (val && typeof val === 'object' && 'in' in (val as object)) {
      if (!(val as { in: unknown[] }).in.includes((row as unknown as Record<string, unknown>)[key])) return { count: 0 };
    } else if ((row as unknown as Record<string, unknown>)[key] !== val) {
      return { count: 0 };
    }
  }
  Object.assign(row, data);
  return { count: 1 };
});
const findUnique = vi.fn(async (args: { where: { id: string } }) => db[args.where.id] ?? null);
vi.mock('@/lib/prisma', () => ({
  prisma: { user: {
    updateMany: (...a: unknown[]) => updateMany(...(a as [{ where: Record<string, unknown>; data: Record<string, unknown> }])),
    findUnique: (...a: unknown[]) => findUnique(...(a as [{ where: { id: string } }])),
  } },
}));

vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => ({})) }));

type VacationIncentiveOutcome =
  | { outcome: 'sent'; message?: string }
  | { outcome: 'rejected'; error: string }
  | { outcome: 'unknown'; error: string };
const sendVacationIncentive = vi.fn(async () => ({ outcome: 'sent' }) as VacationIncentiveOutcome);
vi.mock('@/lib/marketingBoost', () => ({ sendVacationIncentive: (...a: unknown[]) => sendVacationIncentive(...(a as [])) }));

vi.mock('@/lib/getawayPromo', () => ({
  getawayPromoActive: () => true,
  findGetawayDestination: (id?: string) => {
    if (id === 'orlando') return { id: 'orlando', name: 'Orlando, FL', mbDestinationId: 'mb_orlando' };
    if (id === 'miami')   return { id: 'miami',   name: 'Miami, FL',   mbDestinationId: 'mb_miami' };
    return null;
  },
  GETAWAY_DISCLOSURE: { full: [], short: '' },
}));

async function post(destination = 'orlando') {
  const { POST } = await import('@/app/api/getaway/choose/route');
  const req = new Request('https://www.gascap.app/api/getaway/choose', {
    method: 'POST',
    body: JSON.stringify({ destination }),
  });
  return POST(req);
}

async function get() {
  const { GET } = await import('@/app/api/getaway/choose/route');
  return GET();
}

beforeEach(() => {
  vi.clearAllMocks();
  db = {};
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'buyer@example.com' } });
  sendVacationIncentive.mockResolvedValue({ outcome: 'sent' });
  reconcileRevenueCatState.mockResolvedValue({ pro: true, permanent: false, effectiveInterval: 'lifetime', sources: ['revenuecat'], trial: false });
  fetchAuthoritativeRevenueCatState.mockResolvedValue({
    customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
    customerId: 'u1', originalCustomerId: 'u1',
  });
  isSandboxTestAccount.mockReturnValue(false);
});

describe('POST /api/getaway/choose — provider-neutral Lifetime eligibility', () => {
  it('LT1. Stripe/gift Lifetime → allowed', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('LT2. RevenueCat active + interval="lifetime" → allowed', async () => {
    db.u1 = baseUser({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('LT3. RevenueCat Monthly → denied', async () => {
    db.u1 = baseUser({ revenueCatActive: true, revenueCatInterval: 'monthly' });
    expect((await post()).status).toBe(403);
  });

  it('LT4. Trial Pro only → denied', async () => {
    db.u1 = baseUser({ isProTrial: true });
    expect((await post()).status).toBe(403);
  });

  it('LT5. Free/non-Lifetime → denied', async () => {
    db.u1 = baseUser({ plan: 'free' });
    expect((await post()).status).toBe(403);
  });

  it('Existing destination validation still rejects an unknown destination for an eligible Lifetime user', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    expect((await post('not-a-real-place')).status).toBe(400);
  });

  it('Existing auth check still rejects an unauthenticated caller', async () => {
    getServerSession.mockResolvedValue(null);
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    expect((await post()).status).toBe(401);
  });
});

describe('POST /api/getaway/choose — fulfillment idempotency (atomic claim + conditional transitions)', () => {
  it('FP1. Winning atomic claim sets pending BEFORE Marketing Boost is called', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    await post();
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(sendVacationIncentive.mock.invocationCallOrder[0]);
  });

  it('FP2. Marketing Boost outcome:"sent" transitions pending → sent, fulfilledAt set, response reflects it', async () => {
    db.u1 = baseUser({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
    const res = await post();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, destination: 'orlando', fulfillmentStatus: 'sent' });
    expect(db.u1.getawayFulfillmentStatus).toBe('sent');
    expect(db.u1.getawayFulfilledAt).not.toBeNull();
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
  });

  it('FP3. Marketing Boost outcome:"rejected" (definitive) transitions pending → manual_required, no fulfilledAt', async () => {
    sendVacationIncentive.mockResolvedValue({ outcome: 'rejected', error: 'MB rejected the request' });
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    const res = await post();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, destination: 'orlando', fulfillmentStatus: 'manual_required' });
    expect(db.u1.getawayFulfillmentStatus).toBe('manual_required');
    expect(db.u1.getawayFulfilledAt).toBeNull();
  });

  it('FP11. Marketing Boost outcome:"unknown" (ambiguous transport failure) LEAVES the row pending — no manual_required, no manual-issue admin fallback, no auto-retry', async () => {
    sendVacationIncentive.mockResolvedValue({ outcome: 'unknown', error: 'fetch failed: ECONNRESET' });
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    const res = await post('orlando');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, destination: 'orlando', fulfillmentStatus: 'pending' });
    expect(db.u1.getawayFulfillmentStatus).toBe('pending'); // NOT manual_required
    expect(db.u1.getawayFulfilledAt).toBeNull();
    // A later retry must still refuse to resend — the ambiguous window
    // persists until a human resolves it (see the stale-pending monitor).
    sendVacationIncentive.mockClear();
    const retryRes = await post('orlando');
    expect((await retryRes.json())).toMatchObject({ alreadyChosen: true, fulfillmentStatus: 'pending' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP4. Retry against an already-"sent" record → alreadyChosen, MB not called again, record unchanged', async () => {
    db.u1 = baseUser({
      stripeInterval: 'lifetime', getawayDestinationId: 'orlando',
      getawayDestinationChosenAt: '2026-08-24T00:00:00.000Z',
      getawayFulfillmentStatus: 'sent', getawayFulfilledAt: '2026-08-24T00:01:00.000Z',
    });
    const res = await post('orlando');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, destination: 'orlando', alreadyChosen: true, fulfillmentStatus: 'sent' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP5. Retry against "manual_required" → alreadyChosen, MB not called again', async () => {
    db.u1 = baseUser({
      stripeInterval: 'lifetime', getawayDestinationId: 'orlando',
      getawayDestinationChosenAt: '2026-08-24T00:00:00.000Z', getawayFulfillmentStatus: 'manual_required',
    });
    const res = await post('orlando');
    expect((await res.json())).toMatchObject({ alreadyChosen: true, fulfillmentStatus: 'manual_required' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP6. Retry against a still-"pending" record (the ambiguous crash window) → alreadyChosen, MB NEVER auto-resent', async () => {
    // Without a Marketing Boost idempotency key, resending here could
    // duplicate a certificate that was already accepted before whatever
    // crashed GasCap between the send and recording its outcome. Fail-safe
    // means: never resend just because the status still says 'pending'.
    db.u1 = baseUser({
      stripeInterval: 'lifetime', getawayDestinationId: 'orlando',
      getawayDestinationChosenAt: '2026-08-24T00:00:00.000Z', getawayFulfillmentStatus: 'pending',
    });
    const res = await post('orlando');
    expect((await res.json())).toMatchObject({ alreadyChosen: true, fulfillmentStatus: 'pending' });
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP7. Destination immutability — a later request with a DIFFERENT destination cannot overwrite the original claim', async () => {
    db.u1 = baseUser({
      stripeInterval: 'lifetime', getawayDestinationId: 'orlando',
      getawayDestinationChosenAt: '2026-08-24T00:00:00.000Z', getawayFulfillmentStatus: 'sent',
    });
    const res = await post('miami');
    const json = await res.json();
    expect(json.destination).toBe('orlando'); // NOT miami
    expect(json.alreadyChosen).toBe(true);
    expect(db.u1.getawayDestinationId).toBe('orlando');
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP8. Concurrent claims — only the winning atomic update reaches Marketing Boost', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    // Two "simultaneous" requests — the in-memory store's synchronous
    // conditional-update check means only the first to run updateMany wins,
    // exactly modeling Postgres's row-level atomicity for this WHERE shape.
    const [r1, r2] = await Promise.all([post('orlando'), post('miami')]);
    const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
    const winner = [j1, j2].find((j) => !j.alreadyChosen);
    const loser  = [j1, j2].find((j) => j.alreadyChosen);
    expect(winner).toBeTruthy();
    expect(loser).toBeTruthy();
    expect(loser.destination).toBe(winner.destination); // loser reports the winner's destination
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
  });

  it('FP9. Marketing Boost outcome:"rejected" after atomic claim: destination stays claimed, admin fallback fires, no auto-retry send', async () => {
    sendVacationIncentive.mockResolvedValue({ outcome: 'rejected', error: 'MB rejected the request' });
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    await post('orlando');
    expect(db.u1.getawayDestinationId).toBe('orlando');
    expect(db.u1.getawayFulfillmentStatus).toBe('manual_required');
    // A subsequent retry (even same destination) must not call MB again.
    sendVacationIncentive.mockClear();
    const retryRes = await post('orlando');
    expect((await retryRes.json()).alreadyChosen).toBe(true);
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP10. sendVacationIncentive() throwing (contract violation) is treated as "unknown" (ambiguous), not "rejected" — stays pending, never fabricates manual_required, never auto-retries', async () => {
    sendVacationIncentive.mockRejectedValue(new Error('unexpected throw'));
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    const res = await post('orlando');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, destination: 'orlando', fulfillmentStatus: 'pending' });
    expect(db.u1.getawayFulfillmentStatus).toBe('pending');
    sendVacationIncentive.mockClear();
    sendVacationIncentive.mockResolvedValue({ outcome: 'sent' });
    const retryRes = await post('orlando');
    expect((await retryRes.json()).alreadyChosen).toBe(true);
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP12. Terminal transition count=0 after MB "sent" — does NOT fabricate fulfillmentStatus:"sent"; returns re-read durable state instead', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    // Simulate another process changing the durable status out from under
    // this request between the atomic claim and the terminal transition —
    // force it by having updateMany's SECOND call (the transition) see a
    // row whose status no longer matches 'pending'.
    const originalUpdateMany = updateMany.getMockImplementation()!;
    let call = 0;
    updateMany.mockImplementation(async (args) => {
      call++;
      if (call === 2) {
        // Mutate out from under the transition attempt, THEN let the real
        // conditional check run — it will correctly see a mismatch and
        // return count:0, exactly like a real compare-and-set race would.
        db.u1.getawayFulfillmentStatus = 'manual_required'; // e.g. an admin manually resolved it mid-flight
      }
      return originalUpdateMany(args);
    });
    const res = await post('orlando');
    const json = await res.json();
    // Must reflect the REAL durable state (manual_required), never the
    // in-memory MB result (which was 'sent').
    expect(json).toMatchObject({ alreadyChosen: true, fulfillmentStatus: 'manual_required' });
    expect(db.u1.getawayFulfillmentStatus).toBe('manual_required');
  });

  it('FP13. Terminal transition count=0 after MB "rejected" — does NOT fabricate fulfillmentStatus:"manual_required"; returns re-read durable state instead', async () => {
    sendVacationIncentive.mockResolvedValue({ outcome: 'rejected', error: 'MB rejected the request' });
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    const originalUpdateMany = updateMany.getMockImplementation()!;
    let call = 0;
    updateMany.mockImplementation(async (args) => {
      call++;
      if (call === 2) {
        db.u1.getawayFulfillmentStatus = 'sent'; // e.g. a stale duplicate transition attempt lost the race
      }
      return originalUpdateMany(args);
    });
    const res = await post('orlando');
    const json = await res.json();
    expect(json).toMatchObject({ alreadyChosen: true, fulfillmentStatus: 'sent' });
    expect(db.u1.getawayFulfillmentStatus).toBe('sent');
  });

  it('FP14. Claim count=0 whose re-read shows NO destination fails closed — 503, no MB call, no fabricated alreadyChosen', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    // Force the atomic claim itself to report count:0 (as if another
    // process already held it) while the row genuinely has no destination
    // on re-read — a contradictory state that must never be papered over.
    updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    const res = await post('orlando');
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.alreadyChosen).toBeUndefined();
    expect(json.destination).not.toBe('orlando');
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('FP15. Terminal transition count=0 whose re-read ALSO shows no durable destination fails closed — 503, no fabricated alreadyChosen/destination', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime' });
    const originalUpdateMany = updateMany.getMockImplementation()!;
    let call = 0;
    updateMany.mockImplementation(async (args) => {
      call++;
      if (call === 2) {
        // Simulate the contradictory case: something cleared the
        // destination entirely between the claim and the terminal
        // transition (should not happen given the single-writer design,
        // but the fail-closed path must hold regardless).
        db.u1.getawayDestinationId = null;
        db.u1.getawayFulfillmentStatus = null;
      }
      return originalUpdateMany(args);
    });
    const res = await post('orlando');
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.alreadyChosen).toBeUndefined();
    expect(json.destination).toBeUndefined();
  });
});

describe('POST /api/getaway/choose — 72-hour verification hold (2026-08-25)', () => {
  it('HOLD1. Destination selection succeeds immediately even when the hold has NOT elapsed — but Marketing Boost is never called', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime', getawayHoldUntil: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
    const res = await post('orlando');
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, destination: 'orlando', fulfillmentStatus: 'pending' });
    expect(db.u1.getawayDestinationId).toBe('orlando'); // choice IS recorded
    expect(db.u1.getawayFulfillmentStatus).toBe('pending');
    expect(sendVacationIncentive).not.toHaveBeenCalled();
  });

  it('HOLD2. Hold already elapsed at selection time → fulfills immediately via the same re-verified path (unchanged end-to-end behavior)', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime', getawayHoldUntil: new Date(Date.now() - 1000).toISOString() });
    const res = await post('orlando');
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, destination: 'orlando', fulfillmentStatus: 'sent' });
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
  });

  it('HOLD3. Null getawayHoldUntil (grandfathered pre-feature account) → treated as already elapsed, fulfills immediately', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime', getawayHoldUntil: null });
    const res = await post('orlando');
    expect((await res.json())).toMatchObject({ fulfillmentStatus: 'sent' });
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
  });

  it('HOLD4. A RevenueCat-provenance Lifetime whose hold has elapsed is re-verified authoritatively before fulfillment — cross-account ownership still blocks even after 72 hours', async () => {
    db.u1 = baseUser({ revenueCatActive: true, revenueCatInterval: 'lifetime', getawayHoldUntil: new Date(Date.now() - 1000).toISOString() });
    reconcileRevenueCatState.mockRejectedValue(new CrossAccountLifetimeOwnershipError('u1', 'someone-else'));
    const res = await post('orlando');
    const json = await res.json();
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(json.fulfillmentStatus).not.toBe('sent');
    expect(db.u1.getawayFulfillmentStatus).toBe('pending'); // never transitioned
  });

  it('HOLD5. A RevenueCat-provenance Lifetime refunded before the hold elapses is caught at fulfillment time — never sent', async () => {
    db.u1 = baseUser({ revenueCatActive: true, revenueCatInterval: 'lifetime', getawayHoldUntil: new Date(Date.now() - 1000).toISOString() });
    reconcileRevenueCatState.mockResolvedValue({ pro: false, permanent: false, effectiveInterval: null, sources: [], trial: false });
    const res = await post('orlando');
    const json = await res.json();
    expect(sendVacationIncentive).not.toHaveBeenCalled();
    expect(json.fulfillmentStatus).not.toBe('sent');
  });

  it('7. Choose route and the recurring cron both target the same user — the shared durable claim in attemptGetawayFulfillment() permits only one Marketing Boost call', async () => {
    db.u1 = baseUser({ stripeInterval: 'lifetime', getawayHoldUntil: new Date(Date.now() - 1000).toISOString() });
    // Simulate the cron calling the exact same shared helper the choose
    // route uses, "concurrently" with a user's own late-chooser POST.
    const { attemptGetawayFulfillment } = await import('@/lib/getawayFulfillment');
    const [routeRes, cronResult] = await Promise.all([
      post('orlando'),
      attemptGetawayFulfillment('u1'),
    ]);
    const routeJson = await routeRes.json();
    // Exactly one of the two actually reached Marketing Boost.
    expect(sendVacationIncentive).toHaveBeenCalledTimes(1);
    // Whichever one lost the claim must not report a fabricated 'sent'.
    const outcomes = [routeJson.fulfillmentStatus, cronResult.outcome];
    expect(outcomes.filter((o) => o === 'sent').length).toBe(1);
  });
});

describe('GET /api/getaway/choose — status contract', () => {
  it('No destination chosen → fulfillmentStatus null, chosen false', async () => {
    db.u1 = baseUser({});
    const res = await get();
    expect(await res.json()).toEqual({ chosen: false, destination: null, fulfillmentStatus: null });
  });

  it('Pending row → fulfillmentStatus "pending"', async () => {
    db.u1 = baseUser({ getawayDestinationId: 'orlando', getawayFulfillmentStatus: 'pending' });
    const res = await get();
    expect(await res.json()).toMatchObject({ chosen: true, destination: 'orlando', fulfillmentStatus: 'pending' });
  });

  it('Sent row → fulfillmentStatus "sent"', async () => {
    db.u1 = baseUser({ getawayDestinationId: 'orlando', getawayFulfillmentStatus: 'sent' });
    const res = await get();
    expect(await res.json()).toMatchObject({ fulfillmentStatus: 'sent' });
  });

  it('manual_required row → fulfillmentStatus "manual_required"', async () => {
    db.u1 = baseUser({ getawayDestinationId: 'orlando', getawayFulfillmentStatus: 'manual_required' });
    const res = await get();
    expect(await res.json()).toMatchObject({ fulfillmentStatus: 'manual_required' });
  });

  it('Legacy row (destination set, status null — pre-fix historical row) → computed "legacy", never null', async () => {
    db.u1 = baseUser({ getawayDestinationId: 'orlando', getawayFulfillmentStatus: null });
    const res = await get();
    expect(await res.json()).toMatchObject({ chosen: true, destination: 'orlando', fulfillmentStatus: 'legacy' });
  });

  it('Unauthenticated → 401', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
  });
});
