/**
 * POST /api/getaway/choose — provider-neutral Lifetime eligibility regression
 * coverage. Found via live native IAP testing (2026-08-24): the route
 * previously checked `user.stripeInterval === 'lifetime'` only, which
 * permanently 403'd a genuine RevenueCat (native IAP) Lifetime owner — see
 * docs/reviews/2026-08-24-lifetime-entitlement-check-gap.md.
 *
 * Proves the fix (hasLifetimeEntitlement()) for all 5 required scenarios:
 * Stripe/gift Lifetime allowed, RevenueCat Lifetime allowed, RevenueCat
 * Monthly denied, trial-only Pro denied, free/non-Lifetime denied. All
 * existing destination validation, auth, and Marketing Boost behavior is
 * preserved unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getServerSession = vi.fn(async () => null as unknown);
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...(a as [])) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

const findById = vi.fn(async () => null as unknown);
vi.mock('@/lib/users', () => ({ findById: (...a: unknown[]) => findById(...(a as [])) }));

vi.mock('@/lib/prisma', () => ({
  user: { update: vi.fn(async () => ({})) },
  prisma: { user: { update: vi.fn(async () => ({})) } },
}));

vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => ({})) }));

const sendVacationIncentive = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/marketingBoost', () => ({ sendVacationIncentive: (...a: unknown[]) => sendVacationIncentive(...(a as [])) }));

vi.mock('@/lib/getawayPromo', () => ({
  getawayPromoActive: () => true,
  findGetawayDestination: (id?: string) => (id === 'orlando' ? { id: 'orlando', name: 'Orlando, FL', mbDestinationId: 'mb_orlando' } : null),
  GETAWAY_DISCLOSURE: { full: [], short: '' },
}));

function baseUser(overrides: Record<string, unknown>) {
  return {
    id: 'u1', email: 'buyer@example.com', name: 'Buyer',
    plan: 'pro', isProTrial: false,
    stripeInterval: null, revenueCatActive: false, revenueCatInterval: null,
    ...overrides,
  };
}

async function callRoute() {
  const { POST } = await import('@/app/api/getaway/choose/route');
  const req = new Request('https://www.gascap.app/api/getaway/choose', {
    method: 'POST',
    body: JSON.stringify({ destination: 'orlando' }),
  });
  return POST(req);
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'buyer@example.com' } });
});

describe('POST /api/getaway/choose — provider-neutral Lifetime eligibility', () => {
  it('LT1. Stripe/gift Lifetime → allowed', async () => {
    findById.mockResolvedValue(baseUser({ stripeInterval: 'lifetime' }));
    const res = await callRoute();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('LT2. RevenueCat active + interval="lifetime" → allowed', async () => {
    findById.mockResolvedValue(baseUser({ revenueCatActive: true, revenueCatInterval: 'lifetime' }));
    const res = await callRoute();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('LT3. RevenueCat Monthly → denied', async () => {
    findById.mockResolvedValue(baseUser({ revenueCatActive: true, revenueCatInterval: 'monthly' }));
    const res = await callRoute();
    expect(res.status).toBe(403);
  });

  it('LT4. Trial Pro only → denied', async () => {
    findById.mockResolvedValue(baseUser({ isProTrial: true }));
    const res = await callRoute();
    expect(res.status).toBe(403);
  });

  it('LT5. Free/non-Lifetime → denied', async () => {
    findById.mockResolvedValue(baseUser({ plan: 'free' }));
    const res = await callRoute();
    expect(res.status).toBe(403);
  });

  it('Existing destination validation still rejects an unknown destination for an eligible Lifetime user', async () => {
    findById.mockResolvedValue(baseUser({ stripeInterval: 'lifetime' }));
    const { POST } = await import('@/app/api/getaway/choose/route');
    const req = new Request('https://www.gascap.app/api/getaway/choose', {
      method: 'POST',
      body: JSON.stringify({ destination: 'not-a-real-place' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('Existing auth check still rejects an unauthenticated caller', async () => {
    getServerSession.mockResolvedValue(null);
    findById.mockResolvedValue(baseUser({ stripeInterval: 'lifetime' }));
    const res = await callRoute();
    expect(res.status).toBe(401);
  });

  it('Marketing Boost send still fires for an eligible RevenueCat Lifetime user', async () => {
    findById.mockResolvedValue(baseUser({ revenueCatActive: true, revenueCatInterval: 'lifetime' }));
    await callRoute();
    expect(sendVacationIncentive).toHaveBeenCalledWith(expect.objectContaining({ destinationId: 'mb_orlando' }));
  });
});
