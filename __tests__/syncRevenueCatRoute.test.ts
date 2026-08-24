/**
 * POST /api/user/sync-revenuecat — server-authoritative reconciliation
 * for the CURRENT authenticated user only. Client RevenueCat CustomerInfo
 * must never itself authorize Lifetime UI/getaway eligibility — this
 * endpoint is the gate app/upgrade/page.tsx's handleIap() waits on.
 *
 * The Lifetime cross-account ownership invariant itself lives inside
 * lib/users.ts's reconcileRevenueCatState() (see
 * __tests__/reconcileRevenueCatState.test.ts) — this file only proves the
 * ROUTE correctly maps the typed errors it throws to HTTP responses, and
 * that the route fetches RevenueCat exactly once and passes that exact
 * snapshot through (no re-fetch before persisting).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

class CrossAccountLifetimeOwnershipError extends Error {
  constructor(public readonly userId: string, public readonly originalCustomerId: string) {
    super(`cross-account: ${userId} vs ${originalCustomerId}`);
    this.name = 'CrossAccountLifetimeOwnershipError';
  }
}
class UnverifiableLifetimeOwnershipError extends Error {
  constructor(public readonly userId: string) {
    super(`unverifiable: ${userId}`);
    this.name = 'UnverifiableLifetimeOwnershipError';
  }
}

const findById = vi.fn(async (id: string) => ({ id, email: `${id}@example.com`, name: 'Test' }));
const findByEmail = vi.fn(async (email: string) => ({ id: 'resolved-from-email', email, name: 'Test' }));
interface FakeResolved {
  pro: boolean; permanent: boolean; effectiveInterval: 'monthly' | 'lifetime' | null;
  sources: string[]; trial: boolean;
}
const reconcileRevenueCatState = vi.fn(async (_userId: string, _state: unknown): Promise<FakeResolved> => ({
  pro: true, permanent: true, effectiveInterval: 'lifetime', sources: [], trial: false,
}));
vi.mock('@/lib/users', () => ({
  findById:    (id: string) => findById(id),
  findByEmail: (email: string) => findByEmail(email),
  reconcileRevenueCatState: (id: string, state: unknown) => reconcileRevenueCatState(id, state),
  CrossAccountLifetimeOwnershipError,
  UnverifiableLifetimeOwnershipError,
}));

interface FakeState {
  customerFound: boolean; active: boolean; interval: 'monthly' | 'lifetime' | null;
  productId: string | null; customerId: string | null; originalCustomerId: string | null;
}
const fetchAuthoritativeRevenueCatState = vi.fn(async (appUserId: string): Promise<FakeState> => ({
  customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
  customerId: appUserId, originalCustomerId: appUserId,
}));
vi.mock('@/lib/revenueCatApi', () => ({
  fetchAuthoritativeRevenueCatState: (id: string) => fetchAuthoritativeRevenueCatState(id),
}));

async function post() {
  const { POST } = await import('@/app/api/user/sync-revenuecat/route');
  return POST();
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'buyer@example.com' } });
  // Default: legitimate same-owner Lifetime — originalCustomerId === user.id.
  fetchAuthoritativeRevenueCatState.mockResolvedValue({
    customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
    customerId: 'u1', originalCustomerId: 'u1',
  });
  reconcileRevenueCatState.mockResolvedValue({
    pro: true, permanent: true, effectiveInterval: 'lifetime', sources: [], trial: false,
  });
});

describe('POST /api/user/sync-revenuecat', () => {
  it('A. unauthenticated → 401', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
    expect(reconcileRevenueCatState).not.toHaveBeenCalled();
  });

  it('B. Lifetime ownership PROVEN — reconcileRevenueCatState resolves normally → 200, permanent/Lifetime', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ pro: true, permanent: true, effectiveInterval: 'lifetime' });
    expect(reconcileRevenueCatState).toHaveBeenCalledWith('u1', expect.objectContaining({ originalCustomerId: 'u1' }));
  });

  it('C. reconciliation returns Monthly → 200, Monthly response', async () => {
    fetchAuthoritativeRevenueCatState.mockResolvedValue({
      customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly',
      customerId: 'u1', originalCustomerId: null,
    });
    reconcileRevenueCatState.mockResolvedValue({
      pro: true, permanent: false, effectiveInterval: 'monthly', sources: [], trial: false,
    });
    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ pro: true, permanent: false, effectiveInterval: 'monthly' });
  });

  it('D. provider lookup throws a plain error → 503, non-sensitive error, no entitlement fabricated', async () => {
    fetchAuthoritativeRevenueCatState.mockRejectedValue(new Error('RevenueCat API down'));
    const res = await post();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('Could not verify your purchase yet.');
    expect(JSON.stringify(json)).not.toContain('RevenueCat API down');
    expect(reconcileRevenueCatState).not.toHaveBeenCalled();
  });

  it('E. always reconciles the CURRENT authenticated user — no caller-supplied identity possible', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'real-user-id', email: 'real@example.com' } });
    fetchAuthoritativeRevenueCatState.mockResolvedValue({
      customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime',
      customerId: 'real-user-id', originalCustomerId: 'real-user-id',
    });
    const { POST } = await import('@/app/api/user/sync-revenuecat/route');
    expect(POST.length).toBe(0); // takes no request/body — no parameter through which to supply another identity
    await POST();
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledWith('real-user-id');
    expect(reconcileRevenueCatState).toHaveBeenCalledWith('real-user-id', expect.anything());
  });

  it('F. CROSS-ACCOUNT GUARD — reconcileRevenueCatState throws CrossAccountLifetimeOwnershipError → 409, no identity disclosed', async () => {
    reconcileRevenueCatState.mockRejectedValue(
      new CrossAccountLifetimeOwnershipError('u1', 'a-completely-different-gascap-user-id'),
    );
    const res = await post();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('This purchase is associated with another GasCap account.');
    // The other user's actual id/email must never be exposed to the client.
    expect(JSON.stringify(json)).not.toContain('a-completely-different-gascap-user-id');
  });

  it('G. FAIL CLOSED — reconcileRevenueCatState throws UnverifiableLifetimeOwnershipError → 503, no grant', async () => {
    reconcileRevenueCatState.mockRejectedValue(new UnverifiableLifetimeOwnershipError('u1'));
    const res = await post();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("We couldn't verify ownership of this purchase yet.");
  });

  it('H. Monthly still works — reconcileRevenueCatState resolves normally for Monthly (guard lives in reconcile, not the route)', async () => {
    fetchAuthoritativeRevenueCatState.mockResolvedValue({
      customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly',
      customerId: 'u1', originalCustomerId: null,
    });
    reconcileRevenueCatState.mockResolvedValue({
      pro: true, permanent: false, effectiveInterval: 'monthly', sources: [], trial: false,
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(reconcileRevenueCatState).toHaveBeenCalledWith('u1', expect.anything());
  });

  it('I. resolves canonical user via findById, never passes a raw email into RevenueCat reconciliation', async () => {
    await post();
    expect(findById).toHaveBeenCalledWith('u1');
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledWith('u1');
    expect(fetchAuthoritativeRevenueCatState).not.toHaveBeenCalledWith('buyer@example.com');
  });

  it('J. performs exactly ONE authoritative RevenueCat fetch per request, and passes that SAME snapshot to reconcileRevenueCatState (no re-fetch before persisting)', async () => {
    const snapshot = {
      customerFound: true, active: true, interval: 'lifetime' as const, productId: 'gascap_pro_lifetime',
      customerId: 'u1', originalCustomerId: 'u1',
    };
    fetchAuthoritativeRevenueCatState.mockResolvedValue(snapshot);
    await post();
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledTimes(1);
    expect(reconcileRevenueCatState).toHaveBeenCalledWith('u1', snapshot);
  });
});
