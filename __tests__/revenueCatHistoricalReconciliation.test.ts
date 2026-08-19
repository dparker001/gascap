/**
 * Post-Revision-2 P0 — historical RevenueCat entitlement reconciliation.
 * Tests that pre-Sprint-2 rows (where an RC grant may have historically
 * written into stripeInterval, and revenueCatActive/Interval default to
 * false/null regardless of the user's real current state) classify and
 * reconcile correctly, and — critically — that ambiguous rows are NEVER
 * guessed at or downgraded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { classifyProvenance } from '../lib/revenueCatHistoricalReconciliation';

describe('classifyProvenance — pure classification from evidence', () => {
  it('confirmed_stripe_subscription — a real stripeSubscriptionId is decisive', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: 'sub_123', stripeCustomerId: 'cus_123',
      ambassadorProForLife: false, hasRedeemedGift: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_stripe_subscription');
    expect(r.proposedRevenueCatActive).toBeNull(); // no RC field change proposed
  });

  it('confirmed_stripe_lifetime — customer id, no subscription, no gift, lifetime interval', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_456',
      ambassadorProForLife: false, hasRedeemedGift: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_stripe_lifetime');
  });

  it('confirmed_gifted_lifetime — a redeemed Gift record explains it, even with a Stripe customer id present', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_purchaser',
      ambassadorProForLife: false, hasRedeemedGift: true, rc: null,
    });
    expect(r.classification).toBe('confirmed_gifted_lifetime');
  });

  it('confirmed_ambassador — the flag alone is decisive regardless of stripeInterval', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: true, hasRedeemedGift: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_ambassador');
  });

  it('confirmed_active_rc_lifetime — no internal evidence, but RC confirms an active lifetime entitlement', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false,
      rc: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' },
    });
    expect(r.classification).toBe('confirmed_active_rc_lifetime');
    expect(r.proposedRevenueCatActive).toBe(true);
    expect(r.proposedRevenueCatInterval).toBe('lifetime');
    expect(r.proposedRevenueCatProductId).toBe('gascap_pro_lifetime');
  });

  it('confirmed_active_rc_monthly — no internal evidence, RC confirms active monthly', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false,
      rc: { active: true, interval: 'monthly', productId: 'gascap_pro_monthly' },
    });
    expect(r.classification).toBe('confirmed_active_rc_monthly');
    expect(r.proposedRevenueCatInterval).toBe('monthly');
  });

  it('multiple_legitimate_sources — Ambassador AND an active Stripe subscription both apply', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1',
      ambassadorProForLife: true, hasRedeemedGift: false, rc: null,
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
  });

  it('multiple_legitimate_sources also proposes the RC fields if RC additionally confirms active', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: true, hasRedeemedGift: false,
      rc: { active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' },
    });
    expect(r.classification).toBe('multiple_legitimate_sources');
    expect(r.proposedRevenueCatActive).toBe(true);
  });

  it('ambiguous_legacy_provenance — NO evidence anywhere, RC lookup unavailable (null) — proposes NOTHING', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false, rc: null,
    });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
    expect(r.proposedRevenueCatActive).toBeNull();
    expect(r.proposedRevenueCatInterval).toBeNull();
  });

  it('ambiguous_legacy_provenance — RC was reachable but has no record either — still proposes NOTHING (not assumed free)', () => {
    const r = classifyProvenance({
      stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null,
      ambassadorProForLife: false, hasRedeemedGift: false,
      rc: { active: false, interval: null, productId: null },
    });
    expect(r.classification).toBe('ambiguous_legacy_provenance');
    expect(r.proposedRevenueCatActive).toBeNull();
  });

  it('a Stripe customer id WITH an active subscription is classified by the subscription, not miscounted as a Lifetime purchase', () => {
    const r = classifyProvenance({
      stripeInterval: 'monthly', stripeSubscriptionId: 'sub_active', stripeCustomerId: 'cus_1',
      ambassadorProForLife: false, hasRedeemedGift: false, rc: null,
    });
    expect(r.classification).toBe('confirmed_stripe_subscription');
  });
});

// ── buildDryRunReport / applyReconciliation — integration against mocked Prisma ──

interface UserRow {
  id: string; email: string; plan: string;
  stripeInterval: string | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive?: boolean; revenueCatInterval?: string | null; revenueCatProductId?: string | null;
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
      findMany: vi.fn(async () => state.users.filter((u) => (u.plan === 'pro' || u.plan === 'fleet') && u.stripeInterval !== null)),
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

const fetchRevenueCatSubscriberInfo = vi.fn();
vi.mock('@/lib/revenueCatApi', () => ({
  fetchRevenueCatSubscriberInfo: (id: string) => fetchRevenueCatSubscriberInfo(id),
}));

beforeEach(async () => {
  state.users = [];
  state.gifts = [];
  state.updateCalls = [];
  state.failNextUpdate = false;
  vi.clearAllMocks();
  delete process.env.REVENUECAT_SECRET_API_KEY;
});

describe('buildDryRunReport — read-only, makes zero writes', () => {
  it('classifies a mix of confirmed and ambiguous rows correctly, with no RC lookup configured', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [
      { id: 'stripe-sub', email: 'a@example.com', plan: 'pro', stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', ambassadorProForLife: false },
      { id: 'ambiguous-1', email: 'b@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false },
    ];
    const report = await buildDryRunReport();
    expect(report.totalCandidates).toBe(2);
    expect(report.classifications.confirmed_stripe_subscription).toBe(1);
    expect(report.classifications.ambiguous_legacy_provenance).toBe(1);
    expect(report.ambiguousCount).toBe(1);
    expect(report.rcLookupConfigured).toBe(false);
    expect(report.rcLookupAttempted).toBe(0);
    expect(state.updateCalls).toHaveLength(0); // read-only
  });

  it('only attempts an RC lookup for candidates with NO internal evidence, and only when configured', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'test-key';
    fetchRevenueCatSubscriberInfo.mockResolvedValue({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' });
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [
      { id: 'has-sub', email: 'a@example.com', plan: 'pro', stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', ambassadorProForLife: false },
      { id: 'needs-lookup', email: 'b@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false },
    ];
    const report = await buildDryRunReport();
    expect(fetchRevenueCatSubscriberInfo).toHaveBeenCalledTimes(1);
    expect(fetchRevenueCatSubscriberInfo).toHaveBeenCalledWith('needs-lookup');
    expect(report.classifications.confirmed_active_rc_lifetime).toBe(1);
    expect(report.rcLookupAttempted).toBe(1);
  });

  it('a failed RC lookup is treated as ambiguous, not as "not active" — and counted in rcLookupFailed', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'test-key';
    fetchRevenueCatSubscriberInfo.mockRejectedValue(new Error('network error'));
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [{ id: 'lookup-fails', email: 'c@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false }];
    const report = await buildDryRunReport();
    expect(report.classifications.ambiguous_legacy_provenance).toBe(1);
    expect(report.rcLookupFailed).toBe(1);
  });

  it('a gift redemption correctly explains a Stripe-customer-id-bearing lifetime row', async () => {
    const { buildDryRunReport } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [{ id: 'gifted', email: 'd@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: 'cus_purchaser', ambassadorProForLife: false }];
    state.gifts = [{ redeemedByUserId: 'gifted', status: 'redeemed' }];
    const report = await buildDryRunReport();
    expect(report.classifications.confirmed_gifted_lifetime).toBe(1);
  });
});

describe('applyReconciliation — additive only, never touches ambiguous rows', () => {
  it('updates only confirmed-active-RC candidates, leaves everyone else untouched', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'test-key';
    fetchRevenueCatSubscriberInfo.mockResolvedValue({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' });
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [
      { id: 'confirmed-rc', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false },
      { id: 'stripe-sub-untouched', email: 'b@example.com', plan: 'pro', stripeInterval: 'monthly', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', ambassadorProForLife: false },
    ];
    const report = await buildDryRunReport();
    const result = await applyReconciliation(report);
    expect(result.attempted).toBe(1);
    expect(result.updated).toBe(1);
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0].where.id).toBe('confirmed-rc');
    expect(state.updateCalls[0].data).toMatchObject({ revenueCatActive: true, revenueCatInterval: 'lifetime' });
  });

  it('NEVER updates an ambiguous_legacy_provenance candidate — the core safety guarantee', async () => {
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [{ id: 'ambiguous', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false }];
    const report = await buildDryRunReport();
    expect(report.classifications.ambiguous_legacy_provenance).toBe(1);
    const result = await applyReconciliation(report);
    expect(result.attempted).toBe(0);
    expect(result.updated).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it('never writes to stripeInterval or any non-RC field, even for a confirmed-active-RC candidate', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'test-key';
    fetchRevenueCatSubscriberInfo.mockResolvedValue({ active: true, interval: 'monthly', productId: 'gascap_pro_monthly' });
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [{ id: 'confirmed-rc', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false }];
    const report = await buildDryRunReport();
    await applyReconciliation(report);
    expect(state.updateCalls[0].data).not.toHaveProperty('stripeInterval');
    expect(state.updateCalls[0].data).not.toHaveProperty('plan');
    // stripeInterval on the underlying row is untouched (still 'lifetime',
    // the original legacy value — not cleared or overwritten).
    expect(state.users.find((u) => u.id === 'confirmed-rc')!.stripeInterval).toBe('lifetime');
  });

  it('a write failure for one candidate is reported as skipped, does not throw or block other candidates', async () => {
    process.env.REVENUECAT_SECRET_API_KEY = 'test-key';
    fetchRevenueCatSubscriberInfo.mockResolvedValue({ active: true, interval: 'lifetime', productId: 'gascap_pro_lifetime' });
    const { buildDryRunReport, applyReconciliation } = await import('../lib/revenueCatHistoricalReconciliation');
    state.users = [
      { id: 'will-fail', email: 'a@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false },
      { id: 'will-succeed', email: 'b@example.com', plan: 'pro', stripeInterval: 'lifetime', stripeSubscriptionId: null, stripeCustomerId: null, ambassadorProForLife: false },
    ];
    const report = await buildDryRunReport();
    state.failNextUpdate = true;
    const result = await applyReconciliation(report);
    expect(result.attempted).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
