/**
 * Post-Sprint-2 Revision 5 P0 — historical RevenueCat entitlement
 * reconciliation. Covers: field-specific legacy contamination logic (a
 * candidate can be multiple_legitimate_sources AND still propose clearing a
 * contaminated stripeInterval marker), tri-state Stripe Lifetime evidence
 * (INCONCLUSIVE must never support a destructive clear), live-verified
 * Stripe subscription status gating historical plan repairs, atomic
 * per-candidate apply, and reportHash/409 stale-report protection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyProvenance, computeReportHash } from '../lib/revenueCatHistoricalReconciliation';
import type { AuthoritativeRevenueCatState } from '../lib/revenueCatApi';

function rc(overrides: Partial<AuthoritativeRevenueCatState>): AuthoritativeRevenueCatState {
  return { customerFound: true, active: false, interval: null, productId: null, customerId: 'cust_1', ...overrides };
}

const BASE = {
  stripeInterval: null as string | null,
  stripeSubscriptionId: null as string | null,
  stripeCustomerId: null as string | null,
  ambassadorProForLife: false,
  hasRedeemedGift: false,
  stripeLifetimeEvidence: 'not_checked' as const,
  rc: null as AuthoritativeRevenueCatState | null,
};

describe('classifyProvenance — pure classification from evidence', () => {
  it('confirmed_stripe_subscription — real stripeSubscriptionId, no RC', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'monthly', stripeSubscriptionId: 'sub_123', stripeCustomerId: 'cus_123' });
    expect(r.classification).toBe('confirmed_stripe_subscription');
    expect(r.proposedRevenueCatActive).toBeNull();
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('confirmed_stripe_lifetime — ONLY when Stripe purchase is VERIFIED_LIFETIME, not merely inferred from customerId', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_456', stripeLifetimeEvidence: 'VERIFIED_LIFETIME' });
    expect(r.classification).toBe('confirmed_stripe_lifetime');
  });

  it('customerId + stripeInterval=lifetime with VERIFIED_NO_LIFETIME is NOT confirmed_stripe_lifetime — the exact heuristic the review rejected', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_456', stripeLifetimeEvidence: 'VERIFIED_NO_LIFETIME' });
    expect(r.classification).not.toBe('confirmed_stripe_lifetime');
    expect(r.classification).toBe('ambiguous_legacy_provenance');
  });

  it('confirmed_gifted_lifetime — a redeemed Gift record explains it', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_purchaser', hasRedeemedGift: true });
    expect(r.classification).toBe('confirmed_gifted_lifetime');
  });

  it('confirmed_ambassador — the flag alone is decisive', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', ambassadorProForLife: true });
    expect(r.classification).toBe('confirmed_ambassador');
  });

  it('confirmed_active_rc_lifetime — RC Lifetime + no stripeInterval at all (nothing to explain)', () => {
    const r = classifyProvenance({ ...BASE, rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }) });
    expect(r.classification).toBe('confirmed_active_rc_lifetime');
    expect(r.proposedRevenueCatActive).toBe(true);
  });

  it('confirmed_legacy_rc_contamination — stripeInterval set, no other explanation, RC positively confirms active, sole confirmed source — proposes clearing stripeInterval', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeLifetimeEvidence: 'VERIFIED_NO_LIFETIME',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('confirmed_legacy_rc_contamination');
    expect(r.proposedClearLegacyStripeInterval).toBe(true);
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('lifetime');
  });

  it('genuine multi-source (Stripe Lifetime verified + RC active) preserves stripeInterval — NOT proposed for clearing', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'VERIFIED_LIFETIME',
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
    expect(r.proposedRevenueCatActive).toBe(true);
  });

  it('ambiguous_legacy_provenance — RC lookup FAILED (null), not merely inactive — still proposes nothing', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime' });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('ambiguous_legacy_provenance — RC reachable but customer not found / inactive — still proposes nothing (not assumed contamination)', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', rc: rc({ customerFound: false, active: false }) });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
  });

  it('INCONCLUSIVE Stripe Lifetime evidence + lone active RC does NOT propose clearing — inconclusive must never support a destructive clear', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'INCONCLUSIVE',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
    // Since the interval couldn't be proven contaminated, this is reported
    // as the lone RC source classification, not the contamination category.
    expect(r.classification).toBe('confirmed_active_rc_lifetime');
  });
});

describe('classifyProvenance — required multi-source test matrix', () => {
  it('Stripe monthly + RC monthly => multiple sources, RC fields proposed', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('monthly');
  });

  it('Stripe Lifetime (verified) + RC monthly => multiple sources, RC fields proposed, stripeInterval preserved', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'VERIFIED_LIFETIME',
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('Gift Lifetime + RC monthly => multiple sources, stripeInterval preserved', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_purchaser', hasRedeemedGift: true,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('Ambassador + RC Lifetime (no stripeInterval) => multiple sources', () => {
    const r = classifyProvenance({ ...BASE, ambassadorProForLife: true, rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }) });
    expect(r.classification).toBe('multiple_legitimate_sources');
  });

  it('Stripe subscription + no RC => Stripe only', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', rc: rc({ active: false }) });
    expect(r.classification).toBe('confirmed_stripe_subscription');
  });

  it('RC Lifetime + no Stripe/gift => RC only', () => {
    const r = classifyProvenance({ ...BASE, rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }) });
    expect(r.classification).toBe('confirmed_active_rc_lifetime');
  });
});

describe('classifyProvenance — field-specific contamination logic (Revision 5 §5)', () => {
  it('Stripe MONTHLY subscription + RC Lifetime + contaminated stripeInterval=lifetime => preserve both real sources, clear ONLY the contaminated Lifetime marker', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'VERIFIED_NO_LIFETIME',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedClearLegacyStripeInterval).toBe(true);
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('lifetime');
  });

  it('Ambassador + RC Lifetime + contaminated stripeInterval=lifetime => preserve Ambassador + RC, clear contaminated marker', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', ambassadorProForLife: true, stripeLifetimeEvidence: 'VERIFIED_NO_LIFETIME',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedClearLegacyStripeInterval).toBe(true);
  });

  it('Verified Stripe Lifetime + RC monthly => preserve stripeInterval=lifetime (explained, never cleared)', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'VERIFIED_LIFETIME',
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('Gift Lifetime + RC monthly => preserve stripeInterval=lifetime (explained, never cleared)', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', hasRedeemedGift: true,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.proposedClearLegacyStripeInterval).toBe(false);
  });

  it('a Stripe MONTHLY subscription does not explain a contaminated stripeInterval=monthly marker either — only presence of stripeSubscriptionId explains a monthly/annual marker, so this one IS explained', () => {
    // sanity check the "monthly explained by subscription presence" branch directly
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedClearLegacyStripeInterval).toBe(false); // stripeSubscriptionId genuinely explains a 'monthly' marker
  });

  it('stripeInterval=monthly with NO stripeSubscriptionId, but a lone active RC entitlement => contamination, proposes clearing', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'monthly', rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }) });
    expect(r.classification).toBe('confirmed_legacy_rc_contamination');
    expect(r.proposedClearLegacyStripeInterval).toBe(true);
  });
});

describe('computeReportHash — canonical, order-independent, proposal-sensitive', () => {
  const c1 = { userId: 'a', email: 'a@x.com', currentPlan: 'free', stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false, hasRedeemedGift: false, stripeLifetimeEvidence: 'not_checked' as const, rcLookup: 'lookup_failed' as const, classification: 'confirmed_ambassador' as const, proposedRevenueCatActive: true, proposedRevenueCatInterval: 'lifetime', proposedRevenueCatProductId: 'gascap_pro_lifetime', proposedClearLegacyStripeInterval: false, resolvedShouldBePro: true, resolvedSources: ['ambassador'], stripeSubscriptionVerification: 'not_checked' as const, historicalPlanInconsistency: true, proposedPlanRepair: 'pro' as const, reason: 'x' };
  const c2 = { ...c1, userId: 'b', proposedRevenueCatInterval: 'monthly' };

  it('the same proposal produces the same hash', () => {
    expect(computeReportHash([c1, c2])).toBe(computeReportHash([c1, c2]));
  });

  it('ordering differences alone produce the same canonical hash', () => {
    expect(computeReportHash([c1, c2])).toBe(computeReportHash([c2, c1]));
  });

  it('a changed proposal (e.g. provider/customer state changed) produces a different hash', () => {
    const c2Changed = { ...c2, proposedRevenueCatInterval: 'lifetime' };
    expect(computeReportHash([c1, c2])).not.toBe(computeReportHash([c1, c2Changed]));
  });

  it('a changed non-proposal field (e.g. reason text) does NOT change the hash', () => {
    const c1ReasonChanged = { ...c1, reason: 'a completely different explanation string' };
    expect(computeReportHash([c1ReasonChanged, c2])).toBe(computeReportHash([c1, c2]));
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
  failForUserId: null as string | null,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { OR?: unknown[]; id?: { in: string[] } } }) => {
        if (where.id) return state.users.filter((u) => where.id!.in.includes(u.id));
        return state.users.filter((u) =>
          u.stripeInterval !== null || u.stripeSubscriptionId !== null || u.ambassadorProForLife
          || u.plan === 'pro' || u.plan === 'fleet',
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (state.failForUserId === where.id) throw new Error('db error');
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
const verifyStripeSubscriptionActive = vi.fn();
vi.mock('@/lib/stripeEvidence', () => ({
  verifyStripeLifetimePurchase: (id: string | null) => verifyStripeLifetimePurchase(id),
  verifyStripeSubscriptionActive: (id: string | null) => verifyStripeSubscriptionActive(id),
}));

beforeEach(async () => {
  state.users = [];
  state.gifts = [];
  state.updateCalls = [];
  state.failForUserId = null;
  vi.clearAllMocks();
  fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
  verifyStripeLifetimePurchase.mockResolvedValue({ status: 'VERIFIED_NO_LIFETIME', sessionId: null });
  verifyStripeSubscriptionActive.mockResolvedValue('VERIFIED_ACTIVE');
});

describe('buildDryRunReport — broadened scope, always-attempt RC lookup, zero writes', () => {
  it('attempts an RC lookup for EVERY candidate, even one with clear internal evidence', async () => {
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

  it('includes a plan=free user with a leftover VERIFIED stripeInterval=lifetime — the broadened scope fix', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'wrongly-downgraded', email: 'a@example.com', plan: 'free', stripeInterval: 'lifetime', stripeCustomerId: 'cus_1' })];
    verifyStripeLifetimePurchase.mockResolvedValue({ status: 'VERIFIED_LIFETIME', sessionId: 'cs_123' });
    const report = await buildDryRunReport();
    expect(report.totalCandidates).toBe(1);
    const candidate = report.candidates[0];
    expect(candidate.classification).toBe('confirmed_stripe_lifetime');
    expect(candidate.historicalPlanInconsistency).toBe(true);
    expect(candidate.proposedPlanRepair).toBe('pro');
  });

  it('never proposes a plan repair for someone with no evidence at all', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'genuinely-free', email: 'a@example.com', plan: 'free' })];
    const report = await buildDryRunReport();
    expect(report.candidates).toHaveLength(0);
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

  it('does not create a RevenueCat customer for an unknown identity — only fetchAuthoritativeRevenueCatState (search-based, non-creating) is ever called', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'unknown-to-rc', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: false, active: false, interval: null, productId: null, customerId: null });
    const report = await buildDryRunReport();
    expect(report.candidates[0].rcLookup).toMatchObject({ customerFound: false });
    expect(fetchAuthoritativeRevenueCatState).toHaveBeenCalledTimes(1);
  });

  it('includes a deterministic reportHash', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'a', email: 'a@example.com', plan: 'pro', ambassadorProForLife: true })];
    const report = await buildDryRunReport();
    expect(typeof report.reportHash).toBe('string');
    expect(report.reportHash.length).toBeGreaterThan(0);
  });
});

describe('buildDryRunReport — historical plan repair requires LIVE Stripe subscription verification (Revision 5 §8)', () => {
  it('a stale stripeSubscriptionId that Stripe reports as still active DOES support a plan repair', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'stale-but-active', email: 'a@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    verifyStripeSubscriptionActive.mockResolvedValue('VERIFIED_ACTIVE');
    const report = await buildDryRunReport();
    expect(verifyStripeSubscriptionActive).toHaveBeenCalledWith('sub_1');
    expect(report.candidates[0].proposedPlanRepair).toBe('pro');
    expect(report.candidates[0].stripeSubscriptionVerification).toBe('VERIFIED_ACTIVE');
  });

  it('a stripeSubscriptionId that Stripe reports as CANCELED does NOT support a plan repair on that evidence alone', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'stale-canceled', email: 'a@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    verifyStripeSubscriptionActive.mockResolvedValue('VERIFIED_INACTIVE');
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBeNull();
    expect(report.candidates[0].historicalPlanInconsistency).toBe(false);
  });

  it('an INCONCLUSIVE Stripe verification does NOT support a plan repair on that evidence alone', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'inconclusive', email: 'a@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    verifyStripeSubscriptionActive.mockResolvedValue('INCONCLUSIVE');
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBeNull();
    expect(report.stripeSubscriptionVerificationInconclusive).toBe(1);
  });

  it('an INCONCLUSIVE Stripe subscription check does NOT block a plan repair justified by an independent verified source (Ambassador)', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'ambassador-plus-stale-sub', email: 'a@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', ambassadorProForLife: true })];
    verifyStripeSubscriptionActive.mockResolvedValue('INCONCLUSIVE');
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBe('pro');
  });

  it('does not call verifyStripeSubscriptionActive when the account is already Pro — no repair being considered', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'already-pro', email: 'a@example.com', plan: 'pro', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    await buildDryRunReport();
    expect(verifyStripeSubscriptionActive).not.toHaveBeenCalled();
  });
});

describe('applyReconciliation — ONE atomic update per candidate, ambiguous rows always untouched', () => {
  it('backfills RC fields for a confirmed-active-RC candidate', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'confirmed-rc', email: 'a@example.com', plan: 'pro' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    const result = await applyReconciliation(report);
    expect(result.candidatesUpdated).toBe(1);
    expect(state.updateCalls[0].data).toMatchObject({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
  });

  it('clears stripeInterval ONLY for confirmed_legacy_rc_contamination, combined in the same update as any RC backfill', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'contaminated', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.confirmed_legacy_rc_contamination).toBe(1);
    const result = await applyReconciliation(report);
    expect(result.legacyClearProposed).toBe(1);
    expect(state.updateCalls).toHaveLength(1); // ONE combined update, not separate calls
    expect(state.updateCalls[0].data).toMatchObject({ stripeInterval: null, revenueCatActive: true });
  });

  it('a multi-source candidate whose Lifetime marker IS contaminated gets both the RC backfill AND the clear in the SAME single update — preserving the genuine second source untouched', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'multi-contaminated', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.multiple_legitimate_sources).toBe(1);
    expect(report.candidates[0].proposedClearLegacyStripeInterval).toBe(true);
    const result = await applyReconciliation(report);
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0].data).toMatchObject({ stripeInterval: null, revenueCatActive: true, revenueCatInterval: 'lifetime' });
    // stripeSubscriptionId itself was never part of the update payload — the genuine Stripe subscription is left alone.
    expect(state.updateCalls[0].data).not.toHaveProperty('stripeSubscriptionId');
  });

  it('NEVER clears stripeInterval for a multi-source candidate where Stripe genuinely explains the marker', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'multi', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeCustomerId: 'cus_1' })];
    verifyStripeLifetimePurchase.mockResolvedValue({ status: 'VERIFIED_LIFETIME', sessionId: 'cs_1' });
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.multiple_legitimate_sources).toBe(1);
    const result = await applyReconciliation(report);
    const clearCall = state.updateCalls.find((c) => 'stripeInterval' in c.data);
    expect(clearCall).toBeUndefined();
  });

  it('NEVER touches an ambiguous_legacy_provenance candidate — the core safety guarantee', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'ambiguous', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    const report = await buildDryRunReport();
    expect(report.classifications.ambiguous_legacy_provenance).toBe(1);
    const result = await applyReconciliation(report);
    expect(result.candidatesWithProposedChanges).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('applies a plan repair (free -> pro) ONLY when the resolved aggregate proves it', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'stale-plan', email: 'a@example.com', plan: 'free', ambassadorProForLife: true })];
    const report = await buildDryRunReport();
    expect(report.candidates[0].historicalPlanInconsistency).toBe(true);
    const result = await applyReconciliation(report);
    expect(result.planRepairProposed).toBe(1);
    const planCall = state.updateCalls.find((c) => c.data.plan === 'pro');
    expect(planCall).toBeDefined();
  });

  it('a DB failure on the combined update means NONE of that candidate\'s proposed changes applied', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'will-fail', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    // This candidate would get both an RC backfill AND a legacy clear combined.
    state.failForUserId = 'will-fail';
    const result = await applyReconciliation(report);
    expect(result.candidatesFailed).toBe(1);
    expect(result.candidatesUpdated).toBe(0);
    expect(state.updateCalls).toHaveLength(0); // the mock throws before recording the call
    const failedResult = result.results.find((r) => r.userId === 'will-fail');
    expect(failedResult!.applied).toBe(false);
    expect(failedResult!.error).toBeDefined();
  });

  it('one candidate failing does not block another candidate from being updated', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [
      makeUser({ id: 'will-fail', email: 'a@example.com', plan: 'pro' }),
      makeUser({ id: 'will-succeed', email: 'b@example.com', plan: 'pro' }),
    ];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    state.failForUserId = 'will-fail';
    const result = await applyReconciliation(report);
    expect(result.candidatesFailed).toBe(1);
    expect(result.candidatesUpdated).toBe(1);
    expect(state.updateCalls.some((c) => c.where.id === 'will-succeed')).toBe(true);
  });
});
