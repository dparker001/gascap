/**
 * Post-Sprint-2 Revision 7 P0 — historical RevenueCat entitlement
 * reconciliation. Covers: report-only legacy stripeInterval contamination
 * detection (the bulk apply NEVER clears stripeInterval anymore — Stripe
 * Search is eventually consistent and this repo can't prove every
 * historical purchase used the current metadata convention), positive-
 * evidence-only Stripe Lifetime status (NO_MATCH, renamed from
 * VERIFIED_NO_LIFETIME, is never destructive evidence), trial-excluded
 * historical plan repair, optimistic-concurrency apply including
 * currentRevenueCatProductId, and reportHash/409 stale-report protection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyProvenance, computeReportHash } from '../lib/revenueCatHistoricalReconciliation';
import type { AuthoritativeRevenueCatState } from '../lib/revenueCatApi';

function rc(overrides: Partial<AuthoritativeRevenueCatState>): AuthoritativeRevenueCatState {
  return { customerFound: true, active: false, interval: null, productId: null, customerId: 'cust_1', originalCustomerId: null, ...overrides };
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
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('confirmed_stripe_lifetime — ONLY when Stripe purchase is VERIFIED_LIFETIME, not merely inferred from customerId', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_456', stripeLifetimeEvidence: 'VERIFIED_LIFETIME' });
    expect(r.classification).toBe('confirmed_stripe_lifetime');
  });

  it('customerId + stripeInterval=lifetime with NO_MATCH is NOT confirmed_stripe_lifetime — the exact heuristic the review rejected', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_456', stripeLifetimeEvidence: 'NO_MATCH' });
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

  it('suspected_legacy_rc_contamination — stripeInterval set, no other explanation, RC positively confirms active, sole confirmed source — flags SUSPECTED contamination (report-only)', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeLifetimeEvidence: 'NO_MATCH',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('suspected_legacy_rc_contamination');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(true);
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('lifetime');
  });

  it('genuine multi-source (Stripe Lifetime verified + RC active) preserves stripeInterval — NOT flagged as suspected', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'VERIFIED_LIFETIME',
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
    expect(r.proposedRevenueCatActive).toBe(true);
  });

  it('ambiguous_legacy_provenance — RC lookup FAILED (null), not merely inactive — flags nothing', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime' });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('ambiguous_legacy_provenance — RC reachable but customer not found / inactive — flags nothing (not assumed contamination)', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'lifetime', rc: rc({ customerFound: false, active: false }) });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
  });

  it('INCONCLUSIVE Stripe Lifetime evidence + lone active RC does NOT flag suspected contamination — inconclusive must never support even a report-only flag built to justify future destructive review', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'INCONCLUSIVE',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
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
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('Gift Lifetime + RC monthly => multiple sources, stripeInterval preserved', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_purchaser', hasRedeemedGift: true,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
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

describe('classifyProvenance — field-specific contamination detection (report-only, never applied)', () => {
  it('Stripe MONTHLY subscription + RC Lifetime + suspected-contaminated stripeInterval=lifetime => flags suspected contamination, preserving both real sources in the report', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'NO_MATCH',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(true);
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('lifetime');
  });

  it('Ambassador + RC Lifetime + suspected-contaminated stripeInterval=lifetime => flags suspected contamination', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', ambassadorProForLife: true, stripeLifetimeEvidence: 'NO_MATCH',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(true);
  });

  it('Verified Stripe Lifetime + RC monthly => stripeInterval=lifetime is explained, never flagged', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: 'cus_1', stripeLifetimeEvidence: 'VERIFIED_LIFETIME',
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('Gift Lifetime + RC monthly => stripeInterval=lifetime is explained, never flagged', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', hasRedeemedGift: true,
      rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }),
    });
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('a Stripe subscription genuinely explains a monthly marker — no suspected contamination', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('stripeInterval=monthly with NO stripeSubscriptionId, but a lone active RC entitlement => flags suspected contamination', () => {
    const r = classifyProvenance({ ...BASE, stripeInterval: 'monthly', rc: rc({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' }) });
    expect(r.classification).toBe('suspected_legacy_rc_contamination');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(true);
  });

  it('a VERIFIED guest-checkout Lifetime purchase (NO stripeCustomerId at all) still explains stripeInterval=lifetime', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: null, stripeLifetimeEvidence: 'VERIFIED_LIFETIME',
    });
    expect(r.classification).toBe('confirmed_stripe_lifetime');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(false);
  });

  it('NO stripeCustomerId + NO_MATCH + a lone active RC entitlement is still flagged as suspected (the guest-checkout-safe check ran and found nothing) — report-only, not a destructive proof', () => {
    const r = classifyProvenance({
      ...BASE, stripeInterval: 'lifetime', stripeCustomerId: null, stripeLifetimeEvidence: 'NO_MATCH',
      rc: rc({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' }),
    });
    expect(r.classification).toBe('suspected_legacy_rc_contamination');
    expect(r.suspectedLegacyStripeIntervalContamination).toBe(true);
  });
});

describe('computeReportHash — canonical, order-independent, proposal-sensitive', () => {
  const c1 = {
    userId: 'a', email: 'a@x.com', currentPlan: 'free', stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
    ambassadorProForLife: false, hasRedeemedGift: false,
    currentRevenueCatActive: false, currentRevenueCatInterval: null, currentRevenueCatProductId: null,
    stripeLifetimeEvidence: 'not_checked' as const, rcLookup: 'lookup_failed' as const, classification: 'confirmed_ambassador' as const,
    proposedRevenueCatActive: true, proposedRevenueCatInterval: 'lifetime', proposedRevenueCatProductId: 'gascap_pro_lifetime',
    suspectedLegacyStripeIntervalContamination: false, resolvedShouldBePro: true, resolvedSources: ['ambassador'],
    stripeSubscriptionVerification: 'not_checked' as const, historicalPlanInconsistency: true, proposedPlanRepair: 'pro' as const, reason: 'x',
  };
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

  it('a changed PRECONDITION field (e.g. currentPlan) changes the hash even when the proposed mutation looks identical', () => {
    const c1PlanChanged = { ...c1, currentPlan: 'pro' };
    expect(computeReportHash([c1PlanChanged, c2])).not.toBe(computeReportHash([c1, c2]));
  });

  it('a changed currentRevenueCatActive precondition changes the hash', () => {
    const c1RcChanged = { ...c1, currentRevenueCatActive: true };
    expect(computeReportHash([c1RcChanged, c2])).not.toBe(computeReportHash([c1, c2]));
  });

  it('a changed currentRevenueCatProductId precondition changes the hash (Revision 7 addition)', () => {
    const c1ProductChanged = { ...c1, currentRevenueCatProductId: 'gascap_pro_monthly' };
    expect(computeReportHash([c1ProductChanged, c2])).not.toBe(computeReportHash([c1, c2]));
  });

  it('a changed provider-verification classification (stripeSubscriptionVerification) changes the hash', () => {
    const c1VerificationChanged = { ...c1, stripeSubscriptionVerification: 'VERIFIED_ACTIVE' as const };
    expect(computeReportHash([c1VerificationChanged, c2])).not.toBe(computeReportHash([c1, c2]));
  });
});

// ── buildDryRunReport / applyReconciliation — integration against mocked Prisma/RC/Stripe ──

interface UserRow {
  id: string; email: string; plan: string;
  stripeInterval: string | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive: boolean; revenueCatInterval: string | null; revenueCatProductId: string | null;
  isProTrial: boolean; trialExpiresAt: string | null;
}

function makeUser(overrides: Partial<UserRow> & { id: string; email: string }): UserRow {
  return {
    plan: 'free', stripeInterval: null, stripeSubscriptionId: null, stripeCustomerId: null,
    ambassadorProForLife: false, revenueCatActive: false, revenueCatInterval: null, revenueCatProductId: null,
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
      // Emulates Prisma's conditional updateMany: only mutates + returns
      // count:1 if EVERY field in `where` (not just `id`) still matches the
      // live row — the optimistic-concurrency precondition check.
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (state.failForUserId === where.id) throw new Error('db error');
        const row = state.users.find((u) => u.id === where.id);
        if (!row) return { count: 0 };
        const matches = Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);
        if (!matches) return { count: 0 };
        state.updateCalls.push({ where: { id: where.id as string }, data });
        Object.assign(row, data);
        return { count: 1 };
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
  verifyStripeLifetimePurchase.mockResolvedValue({ status: 'NO_MATCH', paymentIntentId: null });
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
    verifyStripeLifetimePurchase.mockResolvedValue({ status: 'VERIFIED_LIFETIME', paymentIntentId: 'pi_123' });
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

describe('buildDryRunReport — historical plan repair requires LIVE Stripe subscription verification', () => {
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

describe('buildDryRunReport — historical plan repair EXCLUDES trial as a source (Revision 7 P0)', () => {
  it('free + active trial ONLY => NO plan repair', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    state.users = [makeUser({ id: 'trial-only', email: 'a@example.com', plan: 'free', ambassadorProForLife: false })];
    // isProTrial/trialExpiresAt aren't part of the OR-scope query (no stripeInterval/stripeSubscriptionId/ambassador/plan pro/fleet),
    // so a trial-only user isn't even a candidate under this migration's scope — confirms trial status alone never surfaces a repair.
    state.users[0].isProTrial = true;
    state.users[0].trialExpiresAt = future;
    const report = await buildDryRunReport();
    expect(report.candidates).toHaveLength(0);
  });

  it('free + active trial + confirmed RC => plan repair via RC, not via the trial', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    // The candidate-scope query doesn't key off RC state alone (a pre-
    // existing gap, unrelated to this round's changes) — a stale
    // stripeInterval='monthly' with no subscriptionId gets this user into
    // scope without itself explaining anything or contributing to the
    // repair decision (a lone RC source with an unexplained stripeInterval
    // is exactly the suspected-contamination case, which is orthogonal to
    // what's under test here: that trial status alone never drives a
    // repair, and RC alone can).
    state.users = [makeUser({ id: 'trial-plus-rc', email: 'a@example.com', plan: 'free', stripeInterval: 'monthly', isProTrial: true, trialExpiresAt: future })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'monthly', productId: 'gascap_pro_monthly', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBe('pro');
    expect(report.candidates[0].resolvedSources).not.toContain('trial');
  });

  it('free + active trial + Ambassador => plan repair via Ambassador', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    state.users = [makeUser({ id: 'trial-plus-ambassador', email: 'a@example.com', plan: 'free', ambassadorProForLife: true, isProTrial: true, trialExpiresAt: future })];
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBe('pro');
  });

  it('free + active trial + verified active Stripe subscription => plan repair via Stripe', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    state.users = [makeUser({ id: 'trial-plus-stripe', email: 'a@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', isProTrial: true, trialExpiresAt: future })];
    verifyStripeSubscriptionActive.mockResolvedValue('VERIFIED_ACTIVE');
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBe('pro');
  });

  it('an active trial does NOT by itself let an otherwise-unverified stripeSubscriptionId slip through — trial + unverified sub alone still yields no repair', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    state.users = [makeUser({ id: 'trial-plus-stale-sub', email: 'a@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', isProTrial: true, trialExpiresAt: future })];
    verifyStripeSubscriptionActive.mockResolvedValue('INCONCLUSIVE');
    const report = await buildDryRunReport();
    expect(report.candidates[0].proposedPlanRepair).toBeNull();
  });
});

describe('applyReconciliation — RC backfill + trial-excluded plan repair ONLY, NEVER clears stripeInterval (Revision 7)', () => {
  it('backfills RC fields for a confirmed-active-RC candidate', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'confirmed-rc', email: 'a@example.com', plan: 'pro' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    const result = await applyReconciliation(report);
    expect(result.candidatesUpdated).toBe(1);
    expect(state.updateCalls[0].data).toMatchObject({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
  });

  it('a candidate classified suspected_legacy_rc_contamination gets its RC fields backfilled but stripeInterval is NEVER touched — the core Revision 7 de-scope', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'suspected', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.suspected_legacy_rc_contamination).toBe(1);
    expect(report.candidates[0].suspectedLegacyStripeIntervalContamination).toBe(true);
    const result = await applyReconciliation(report);
    expect(result.candidatesUpdated).toBe(1);
    expect(state.updateCalls[0].data).not.toHaveProperty('stripeInterval');
    expect(state.updateCalls[0].data).toMatchObject({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
    // The stored stripeInterval survives completely untouched.
    expect(state.users[0].stripeInterval).toBe('lifetime');
  });

  it('a multi-source candidate flagged as suspected contamination still gets its RC backfill applied, but stripeInterval is NEVER part of the update payload', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [makeUser({ id: 'multi-suspected', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    expect(report.classifications.multiple_legitimate_sources).toBe(1);
    expect(report.candidates[0].suspectedLegacyStripeIntervalContamination).toBe(true);
    const result = await applyReconciliation(report);
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0].data).toMatchObject({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
    expect(state.updateCalls[0].data).not.toHaveProperty('stripeInterval');
    expect(state.updateCalls[0].data).not.toHaveProperty('stripeSubscriptionId');
    expect(state.users[0].stripeInterval).toBe('lifetime');
  });

  it('NEVER, under any circumstance, does applyReconciliation write a stripeInterval field — checked across every candidate in a mixed batch', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [
      makeUser({ id: 'suspected-1', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime' }),
      makeUser({ id: 'suspected-2', email: 'b@example.com', plan: 'pro', stripeInterval: 'monthly' }),
      makeUser({ id: 'plain-rc', email: 'c@example.com', plan: 'pro' }),
    ];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
    const result = await applyReconciliation(report);
    expect(result.suspectedContaminationCount).toBe(2);
    for (const call of state.updateCalls) {
      expect(call.data).not.toHaveProperty('stripeInterval');
    }
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

  it('applies a plan repair (free -> pro) ONLY when confirmed non-trial sources prove it', async () => {
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
    state.users = [makeUser({ id: 'will-fail', email: 'a@example.com', plan: 'pro' })];
    fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
    const report = await buildDryRunReport();
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

  describe('optimistic concurrency — a row that changed between report and apply is never mutated', () => {
    it('state unchanged since the report was built => the atomic update succeeds normally', async () => {
      const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
      state.users = [makeUser({ id: 'unchanged', email: 'a@example.com', plan: 'pro' })];
      fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
      const report = await buildDryRunReport();
      const result = await applyReconciliation(report);
      expect(result.candidatesUpdated).toBe(1);
      expect(result.candidatesStale).toBe(0);
    });

    it('plan changes on the live row between report and apply => count=0, no mutation', async () => {
      const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
      state.users = [makeUser({ id: 'plan-changed', email: 'a@example.com', plan: 'free', ambassadorProForLife: true })];
      const report = await buildDryRunReport();
      expect(report.candidates[0].proposedPlanRepair).toBe('pro');
      state.users[0].plan = 'pro'; // e.g. a concurrent admin action already fixed it
      const result = await applyReconciliation(report);
      expect(result.candidatesStale).toBe(1);
      expect(state.updateCalls).toHaveLength(0);
    });

    it('an entitlement/provenance field (revenueCatActive) changes on the live row between report and apply => count=0, no mutation', async () => {
      const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
      state.users = [makeUser({ id: 'rc-changed', email: 'a@example.com', plan: 'pro' })];
      fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
      const report = await buildDryRunReport();
      expect(report.candidates[0].proposedRevenueCatActive).toBe(true);
      state.users[0].revenueCatActive = true; // e.g. a concurrent webhook already backfilled it
      const result = await applyReconciliation(report);
      expect(result.candidatesStale).toBe(1);
      expect(state.updateCalls).toHaveLength(0);
    });

    it('revenueCatProductId changes on the live row between report and apply => count=0, stale candidate, no overwrite (Revision 7 addition)', async () => {
      const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
      state.users = [makeUser({ id: 'product-changed', email: 'a@example.com', plan: 'pro', revenueCatProductId: 'gascap_pro_monthly' })];
      fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
      const report = await buildDryRunReport();
      expect(report.candidates[0].currentRevenueCatProductId).toBe('gascap_pro_monthly');
      // Simulate a concurrent webhook changing the stored product id between report and apply.
      state.users[0].revenueCatProductId = 'gascap_pro_lifetime';
      const result = await applyReconciliation(report);
      expect(result.candidatesStale).toBe(1);
      expect(state.updateCalls).toHaveLength(0);
      // The concurrently-written value survives untouched.
      expect(state.users[0].revenueCatProductId).toBe('gascap_pro_lifetime');
    });

    it('one candidate being stale does not block another unrelated candidate from applying normally', async () => {
      const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
      state.users = [
        makeUser({ id: 'stale-one', email: 'a@example.com', plan: 'free', ambassadorProForLife: true }),
        makeUser({ id: 'fine-one', email: 'b@example.com', plan: 'pro' }),
      ];
      fetchAuthoritativeRevenueCatState.mockResolvedValue({ customerFound: true, active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime', customerId: 'rc_1' });
      const report = await buildDryRunReport();
      state.users.find((u) => u.id === 'stale-one')!.plan = 'pro';
      const result = await applyReconciliation(report);
      expect(result.candidatesStale).toBe(1);
      expect(result.candidatesUpdated).toBe(1);
      expect(state.updateCalls.some((c) => c.where.id === 'fine-one')).toBe(true);
    });
  });
});
