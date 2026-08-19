/**
 * Post-Sprint-2 Revision 4 P0 — historical RevenueCat entitlement
 * reconciliation. Covers: multi-source RC reconciliation (RC lookup is now
 * ALWAYS attempted, not skipped when internal evidence exists), broadened
 * candidate scope (not gated on current plan), verified Stripe-Lifetime
 * evidence (no more customerId-alone heuristic), confirmed legacy RC
 * contamination detection + proposed cleanup, and plan-repair proposals.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyProvenance } from '../lib/revenueCatHistoricalReconciliation';
import type { AuthoritativeRevenueCatState } from '../lib/revenueCatApi';

function rc(overrides: Partial<AuthoritativeRevenueCatState>): AuthoritativeRevenueCatState {
  return { customerFound: true, active: false, interval: null, productId: null, customerId: 'cust_1', ...overrides };
}

describe('classifyProvenance — pure classification from evidence', () => {
  it('confirmed_stripe_subscription — real stripeSubscriptionId, no RC', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: 'sub_123', stripeCustomerId: 'cus_123',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_stripe_subscription');
    expect(r.proposedRevenueCatActive).toBeNull();
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('confirmed_stripe_lifetime — ONLY when Stripe purchase is VERIFIED, not merely inferred from customerId', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_456',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: true, rc: null,
    });
    expect(r.classification).toBe('confirmed_stripe_lifetime');
  });

  it('customerId + stripeInterval=lifetime WITHOUT verification is NOT confirmed_stripe_lifetime — the exact heuristic the review rejected', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_456',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false, rc: null,
    });
    expect(r.classification).not.toBe('confirmed_stripe_lifetime');
    expect(r.classification).toBe('ambiguous_legacy_provenance');
  });

  it('confirmed_gifted_lifetime — a redeemed Gift record explains it', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_purchaser',
      ambassadorProForLife: false, hasRedeemedGift: true, stripeLifetimeVerified: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_gifted_lifetime');
  });

  it('confirmed_ambassador — the flag alone is decisive', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: true, hasRedeemedGift: false, stripeLifetimeVerified: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_ambassador');
  });

  it('confirmed_active_rc_lifetime — RC Lifetime + no stripeInterval at all (nothing to explain)', () => {
    const r = classifyProvenance({
      stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('confirmed_active_rc_lifetime');
    expect(r.proposedRevenueCatActive).toBe(true);
  });

  it('confirmed_legacy_rc_contamination — stripeInterval set, no other explanation, RC positively confirms active — proposes clearing stripeInterval', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('confirmed_legacy_rc_contamination');
    expect(r.proposedClearLegacyStripeInterval).toBe(true);
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('lifetime');
  });

  it('genuine multi-source (Stripe Lifetime verified + RC active) preserves stripeInterval — NOT proposed for clearing', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_1',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: true,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
    expect(r.proposedRevenueCatActive).toBe(true);
  });

  it('ambiguous_legacy_provenance — RC lookup FAILED (null), not merely inactive — still proposes nothing', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false, rc: null,
    });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('ambiguous_legacy_provenance — RC reachable but customer not found / inactive — still proposes nothing (not assumed contamination)', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ customerFound: false, active: false }),
    });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
  });
});

describe('classifyProvenance — required multi-source test matrix (Revision 4 §2)', () => {
  it('Stripe monthly + RC monthly => multiple sources, RC fields proposed', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('monthly');
  });

  it('Stripe Lifetime (verified) + RC monthly => multiple sources, RC fields proposed, stripeInterval preserved', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_1',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: true,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('Gift Lifetime + RC monthly => multiple sources', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_purchaser',
      ambassadorProForLife: false, hasRedeemedGift: true, stripeLifetimeVerified: false,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
  });

  it('Ambassador + RC Lifetime => multiple sources', () => {
    const r = classifyProvenance({
      stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: true, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
  });

  it('Stripe subscription + no RC => Stripe only', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ active: false }),
    });
    expect(r.classification).toBe('confirmed_stripe_subscription');
  });

  it('RC Lifetime + no Stripe/gift => RC only', () => {
    const r = classifyProvenance({
      stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeVerified: false,
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('confirmed_active_rc_lifetime');
  });
});

// ── buildDryRunReport / applyReconciliation — integration against mocked Prisma/RC/Stripe ──

interface UserRow {
  id: string; email: string; plan: string;
  stripeInterval: string | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive: boolean; revenueCatInterval: string | null;
  isProTrial: boolean; trialExpiresAt: string | null;
}

function makeUser(overrides: Partial<UserRow> & { id: string; email: string }): UserRow {
  return {
    plan: 'free', stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
    ambassadorProForLife: false, revenueCatActive: false, revenueCatInterval: null,
    isProTrial: false, trialExpiresAt: null,
    ...overrides,
  };
}

const state = vi.hoisted(() => ({
  users: [] as UserRow[],
  gifts: [] as { redeemedByUserId: string | null; status: string }[],
  updateCalls: [] as { where: { id: string }; data: Record<string, unknown> }[],
  failNextUpdate: false,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { OR?: unknown[]; id?: { in: string[] } } }) => {
        if (where.id) return state.users.filter((u) => where.id!.in.includes(u.id));
        // Emulate the broadened OR-scope query.
        return state.users.filter((u) =>
          u.stripeInterval !== null || u.stripeSubscriptionId !== null || u.ambassadorProForLife
          || u.plan === 'pro' || u.plan === 'fleet',
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (state.failNextUpdate) { state.failNextUpdate = false; throw new Error('db error'); }
        state.updateCalls.push({ where, data });
        const row = state.users.find((u) => u.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    gift: {
      findMany: vi.fn(async () => state.gifts.filter((g) => g.redeemedByUserId && ['paid', 'redeemed'].includes(g.status))),
    },
  },
}));

const fetchAuthoritativeRevenueCatState = vi.fn();
vi.mock('@/lib/revenueCatApi', () => ({
  fetchAuthoritativeRevenueCatState: (id: string) => fetchAuthoritativeRevenueCatState(id),
}));

const verifyStripeLifetimePurchase = vi.fn();
vi.mock('@/lib/stripeEvidence', () => ({
  verifyStripeLifetimePurchase: (id: string | null) => verifyStripeLifetimePurchase(id),
}));

beforeEach(async () => {
  state.users = [];
  state.gifts = [];
  state.updateCalls = [];
  state.failNextUpdate = false;
  vi.clearAllMocks();
  fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
  verifyStripeLifetimePurchase.mockResolvedValue({ verified: false, sessionId: null });
});

describe('buildDryRunReport — broadened scope, always-attempt RC lookup, zero writes', () => {
  it('attempts an RC lookup for EVERY candidate, even one with clear internal evidence — post-Revision-4 fix', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'has-sub', email: 'a@example.com', plan: 'pro', stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    await buildDryRunReport();
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledWith('has-sub');
  });

  it('a Stripe-subscription user who ALSO has an active RC subscription is correctly flagged multiple_legitimate_sources, not silently missed', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'both', email: 'a@example.com', plan: 'pro', stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.multiple_legitimate_sources).toBe(1);
    expect(report.candidates[0].proposedRevenueCatActive).toBe(true);
  });

  it('includes a plan=free user with a leftover stripeInterval — the broadened scope fix', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    // Simulates: old RC EXPIRATION/REFUND set plan=free but never cleared
    // stripeInterval, which was genuine Stripe Lifetime provenance.
    state.users = [makeUser({ id: 'wrongly-downgraded', email: 'a@example.com', plan: 'free', stripeInterval: 'lifetime', stripeCustomerId: 'cus_1' })];
    verifyStripeLifetimePurchase.mockResolvedValue({ verified: true, sessionId: 'cs_123' });
    const report = await buildDryRunReport();
    expect(report.totalCandidates).toBe(1);
    const candidate = report.candidates[0];
    expect(candidate.classification).toBe('confirmed_stripe_lifetime');
    expect(candidate.historicalPlanInconsistency).toBe(true);
    expect(candidate.proposedPlanRepair).toBe('pro');
  });

  it('never proposes a plan repair for someone resolved as NOT pro — only ever proposes toward Pro', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'genuinely-free', email: 'a@example.com', plan: 'free' })];
    const report = await buildDryRunReport();
    expect(report.candidates).toHaveLength(0); // no evidence at all => not even a candidate
  });

  it('a failed RC lookup is treated as ambiguous, counted in rcLookupFailed, never as "confirmed inactive"', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'lookup-fails', email: 'c@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockRejectedValue(new Error('network error'));
    const report = await buildDryRunReport();
    expect(report.classifications.ambiguous_legacy_provenance).toBe(1);
    expect(report.rcLookupFailed).toBe(1);
  });

  it('makes zero writes — read-only', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'a', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeCustomerId: 'cus_1' })];
    await buildDryRunReport();
    expect(state.updateCalls).toHaveLength(0);
  });

  it('does not create a RevenueCat customer for an unknown identity — the v2 client only searches, per lib/revenueCatApi.ts', async () => {
    // This is enforced by mocking fetchAuthoritativeRevenueCatState to
    // return "not found" and confirming the reconciliation module never
    // calls any write-shaped function — there is none imported, which this
    // test documents structurally: only fetchAuthoritativeRevenueCatState
    // is ever called against RevenueCat.
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'unknown-to-rc', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
    const report = await buildDryRunReport();
    expect(report.candidates[0].rcLookup).toMatchObject({ customerFound: false });
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledTimes(1); // never a second "create" call
  });
});

describe('applyReconciliation — three independent additive operations, ambiguous rows always untouched', () => {
  it('backfills RC fields for a confirmed-active-RC candidate', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'confirmed-rc', email: 'a@example.com', plan: 'pro' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    const result = await applyReconciliation(report);
    expect(result.rcFieldsUpdated).toBe(1);
    expect(state.updateCalls[0].data).toMatchObject({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
  });

  it('clears stripeInterval ONLY for confirmed_legacy_rc_contamination', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'contaminated', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.confirmed_legacy_rc_contamination).toBe(1);
    const result = await applyReconciliation(report);
    expect(result.legacyClearUpdated).toBe(1);
    const clearCall = state.updateCalls.find((c) => 'stripeInterval' in c.data);
    expect(clearCall!.data.stripeInterval).toBeNull();
  });

  it('NEVER clears stripeInterval for a multi-source (genuine Stripe Lifetime + RC) candidate', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'multi', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeCustomerId: 'cus_1' })];
    verifyStripeLifetimePurchase.mockResolvedValue({ verified: true, sessionId: 'cs_1' });
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.multiple_legitimate_sources).toBe(1);
    const result = await applyReconciliation(report);
    expect(result.legacyClearAttempted).toBe(0);
    const clearCall = state.updateCalls.find((c) => 'stripeInterval' in c.data);
    expect(clearCall).toBeUndefined();
  });

  it('NEVER touches an ambiguous_legacy_provenance candidate — the core safety guarantee', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'ambiguous', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    const report = await buildDryRunReport();
    expect(report.classifications.ambiguous_legacy_provenance).toBe(1);
    const result = await applyReconciliation(report);
    expect(result.rcFieldsAttempted).toBe(0);
    expect(result.legacyClearAttempted).toBe(0);
    expect(result.planRepairAttempted).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('applies a plan repair (free -> pro) ONLY when the resolved aggregate proves it', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'stale-plan', email: 'a@example.com', plan: 'free', ambassadorProForLife: true })];
    const report = await buildDryRunReport();
    expect(report.candidates[0].historicalPlanInconsistency).toBe(true);
    const result = await applyReconciliation(report);
    expect(result.planRepairUpdated).toBe(1);
    const planCall = state.updateCalls.find((c) => c.data.plan === 'pro');
    expect(planCall).toBeDefined();
  });

  it('a write failure for one operation is reported as skipped, does not throw or block others', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'confirmed-rc', email: 'a@example.com', plan: 'pro' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    state.failNextUpdate = true;
    const result = await applyReconciliation(report);
    expect(result.rcFieldsAttempted).toBe(1);
    expect(result.rcFieldsSkipped).toBe(1);
    expect(result.rcFieldsUpdated).toBe(0);
  });
});
