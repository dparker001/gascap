/**
 * Post-Sprint-2 Revision 4 — historical RevenueCat entitlement reconciliation.
 *
 * THE PROBLEM: before this hardening sprint's provenance fix, every
 * RevenueCat grant wrote `interval` into `stripeInterval` (the same field
 * genuine Stripe/gift purchases use), and the new `revenueCatActive`/
 * `revenueCatInterval` columns didn't exist yet. Separately, RevenueCat
 * EXPIRATION/REFUND events called `setUserPlan(userId, 'free')`, which does
 * NOT clear `stripeInterval` — so a legitimate Stripe/gift Lifetime
 * purchaser could already exist today as `plan='free', stripeInterval=
 * 'lifetime'`, wrongly downgraded by an unrelated RevenueCat-side event
 * before this sprint's fix existed. Getting this wrong in either direction
 * is a real risk: guessing someone is Stripe-provenance when they're really
 * legacy RC contamination risks a future RC event failing to correct a
 * value it doesn't own; guessing the reverse risks clearing a genuine
 * paying customer's provenance.
 *
 * REVISION 4 CHANGES FROM REVISION 3 (each addresses a specific finding):
 *
 * 1. Candidate scope is no longer gated on current `plan`. A user who was
 *    WRONGLY downgraded to `plan='free'` by the pre-fix bug must still be
 *    inspected — see `historical_plan_inconsistency` below.
 * 2. The live RevenueCat lookup is now attempted for EVERY candidate, not
 *    only ones lacking internal evidence — GasCap supports simultaneous
 *    entitlement sources (e.g. an active Stripe subscription AND an active
 *    RevenueCat subscription at once), and skipping the RC lookup whenever
 *    ANY internal evidence exists would miss backfilling
 *    `revenueCatActive` for exactly that combination, leaving a future
 *    Stripe-side cancellation free to wrongly downgrade someone whose RC
 *    entitlement was never recorded.
 * 3. `stripeCustomerId` presence is no longer treated as proof of a Stripe
 *    Lifetime purchase — see `lib/stripeEvidence.ts`. Only a verified,
 *    completed Stripe Checkout Session for the Lifetime price counts as
 *    `confirmed_stripe_lifetime`; everything else with an unexplained
 *    `stripeInterval` falls to `ambiguous_legacy_provenance` UNLESS RC
 *    evidence positively explains it (see `confirmed_legacy_rc_contamination`
 *    below).
 * 4. A NEW classification, `confirmed_legacy_rc_contamination`: when
 *    `stripeInterval` is set, no genuine Stripe/gift/Ambassador source
 *    explains it, AND RevenueCat's live, authoritative state CONFIRMS an
 *    active entitlement for this identity — that combination positively
 *    proves the `stripeInterval` value originated from the pre-fix bug, not
 *    a real Stripe/gift purchase. ONLY in this proven case does the report
 *    propose `proposedClearLegacyStripeInterval: true`. An account where
 *    genuine Stripe/gift Lifetime provenance ALSO exists is
 *    `multiple_legitimate_sources` instead, and `stripeInterval` is
 *    correctly never proposed for clearing.
 * 5. Every candidate's proposed aggregate state is now run back through the
 *    same central resolver (`resolveUserEntitlements`) used everywhere
 *    else, compared against the stored `plan`, and reported as
 *    `historical_plan_inconsistency` + `proposedPlanRepair` when they
 *    disagree (e.g. `plan='free'` but resolved sources say they should be
 *    Pro).
 *
 * NEVER AUTOMATICALLY DOWNGRADES OR ERASES ANYTHING. This module only ever
 * PROPOSES additive RC-field backfills, a plan repair TOWARD Pro (never away
 * from it), and a legacy-`stripeInterval`-clear ONLY under the proven
 * condition above. A candidate that remains ambiguous after all evidence is
 * exhausted is reported and left completely untouched — never assumed to be
 * "not entitled" and never used to justify removing anything. `apply()`
 * still requires Don's explicit approval per the dry-run report's actual
 * content, per `/CLAUDE.md`'s standing database-safety rule.
 */

import { prisma } from '@/lib/prisma';
import { fetchAuthoritativeRevenueCatState, type AuthoritativeRevenueCatState } from '@/lib/revenueCatApi';
import { verifyStripeLifetimePurchase } from '@/lib/stripeEvidence';
import { resolveUserEntitlements } from '@/lib/entitlements';

export type ProvenanceClassification =
  | 'confirmed_stripe_subscription'         // real stripeSubscriptionId — an active Stripe sub
  | 'confirmed_stripe_lifetime'             // a VERIFIED completed Checkout Session for the Lifetime price
  | 'confirmed_gifted_lifetime'             // a redeemed Gift record names this user
  | 'confirmed_ambassador'                  // ambassadorProForLife — GasCap-internal grant, no provider involved
  | 'confirmed_active_rc_monthly'           // RC API confirms an active monthly entitlement, no other source
  | 'confirmed_active_rc_lifetime'          // RC API confirms an active lifetime entitlement, no other source
  | 'confirmed_legacy_rc_contamination'     // stripeInterval unexplained by anything else, but RC positively proves it originated from RC
  | 'multiple_legitimate_sources'           // more than one CONFIRMED source applies (genuine Stripe/gift/Ambassador AND/OR active RC)
  | 'ambiguous_legacy_provenance';          // no internal evidence, RC inconclusive — DO NOT TOUCH

export interface ReconciliationCandidate {
  userId:                            string;
  email:                             string;
  currentPlan:                       string;
  stripeInterval:                    string | null;
  stripeSubscriptionId:              string | null;
  stripeCustomerId:                  string | null;
  ambassadorProForLife:              boolean;
  hasRedeemedGift:                   boolean;
  stripeLifetimeVerified:            boolean;
  rcLookup:                          AuthoritativeRevenueCatState | 'lookup_failed';
  classification:                    ProvenanceClassification;
  /** Proposed value — null means "propose no change to this field." Never populated for an ambiguous candidate. */
  proposedRevenueCatActive:          boolean | null;
  proposedRevenueCatInterval:        string | null;
  proposedRevenueCatProductId:       string | null;
  /** Only true for confirmed_legacy_rc_contamination — see the module doc comment. */
  proposedClearLegacyStripeInterval: boolean;
  resolvedShouldBePro:               boolean;
  resolvedSources:                   string[];
  historicalPlanInconsistency:       boolean;
  proposedPlanRepair:                'pro' | null;
  reason:                            string;
}

interface ClassifyInput {
  stripeInterval:         string | null;
  stripeSubscriptionId:   string | null;
  stripeCustomerId:       string | null;
  ambassadorProForLife:   boolean;
  hasRedeemedGift:        boolean;
  stripeLifetimeVerified: boolean;
  rc:                     AuthoritativeRevenueCatState | null; // null = lookup failed or unavailable — never treated as "confirmed inactive"
}

/**
 * Pure classification from evidence for a single user. No I/O — callers
 * gather the evidence (including the live RC lookup and Stripe verification)
 * first.
 */
export function classifyProvenance(input: ClassifyInput): {
  classification: ProvenanceClassification;
  proposedRevenueCatActive: boolean | null;
  proposedRevenueCatInterval: string | null;
  proposedRevenueCatProductId: string | null;
  proposedClearLegacyStripeInterval: boolean;
  reason: string;
} {
  const confirmedSources: ProvenanceClassification[] = [];
  if (input.ambassadorProForLife) confirmedSources.push('confirmed_ambassador');
  if (input.stripeSubscriptionId) confirmedSources.push('confirmed_stripe_subscription');
  if (input.hasRedeemedGift) confirmedSources.push('confirmed_gifted_lifetime');
  if (input.stripeLifetimeVerified) confirmedSources.push('confirmed_stripe_lifetime');

  // rc === null means the lookup failed or wasn't possible — NEVER treated
  // as "confirmed inactive." Only a genuine, successful lookup result
  // (customerFound + active) counts as RC evidence either way.
  const rcActive = input.rc !== null && input.rc.active === true;
  if (rcActive) {
    confirmedSources.push(input.rc!.interval === 'lifetime' ? 'confirmed_active_rc_lifetime' : 'confirmed_active_rc_monthly');
  }

  const nonRcConfirmed = confirmedSources.filter((s) => !s.startsWith('confirmed_active_rc'));

  if (confirmedSources.length > 1) {
    // More than one CONFIRMED source (whether that's two non-RC sources, or
    // one non-RC source plus RC, or — vanishingly unlikely — Ambassador +
    // Stripe sub with no RC). stripeInterval is NEVER proposed for clearing
    // here: at least one genuine non-RC source may explain it, so clearing
    // would risk destroying real provenance.
    return {
      classification: 'multiple_legitimate_sources',
      proposedRevenueCatActive:    rcActive ? true : null,
      proposedRevenueCatInterval:  rcActive ? (input.rc!.interval ?? null) : null,
      proposedRevenueCatProductId: rcActive ? (input.rc!.productId ?? null) : null,
      proposedClearLegacyStripeInterval: false,
      reason: `Multiple confirmed sources: ${confirmedSources.join(', ')}.`,
    };
  }

  if (confirmedSources.length === 1) {
    const only = confirmedSources[0];
    // A lone confirmed RC source with an UNEXPLAINED stripeInterval is the
    // proven-contamination case: RC positively confirms this identity's
    // active entitlement, and nothing else (Stripe sub, gift, Ambassador,
    // VERIFIED Stripe Lifetime) explains why stripeInterval is set. That
    // combination is what actually proves the value's origin — see the
    // module doc comment.
    const isLoneRc = only.startsWith('confirmed_active_rc');
    const legacyContamination = isLoneRc && input.stripeInterval !== null && nonRcConfirmed.length === 0;

    if (legacyContamination) {
      return {
        classification: 'confirmed_legacy_rc_contamination',
        proposedRevenueCatActive:    true,
        proposedRevenueCatInterval:  input.rc!.interval ?? null,
        proposedRevenueCatProductId: input.rc!.productId ?? null,
        proposedClearLegacyStripeInterval: true,
        reason: `stripeInterval='${input.stripeInterval}' has no explanation other than RevenueCat — RC's live state confirms an active entitlement for this identity and no genuine Stripe/gift/Ambassador source exists. This proves the stripeInterval value originated from the pre-Sprint-2 provenance bug.`,
      };
    }

    return {
      classification: only,
      proposedRevenueCatActive:    isLoneRc ? true : null,
      proposedRevenueCatInterval:  isLoneRc ? (input.rc!.interval ?? null) : null,
      proposedRevenueCatProductId: isLoneRc ? (input.rc!.productId ?? null) : null,
      proposedClearLegacyStripeInterval: false,
      reason: `Confirmed via: ${only}.`,
    };
  }

  // No internal evidence, and RC lookup was either unavailable, failed, or
  // found no active entitlement. DO NOT PROPOSE ANYTHING.
  return {
    classification: 'ambiguous_legacy_provenance',
    proposedRevenueCatActive:    null,
    proposedRevenueCatInterval:  null,
    proposedRevenueCatProductId: null,
    proposedClearLegacyStripeInterval: false,
    reason: input.rc === null
      ? 'No corroborating Stripe/gift/ambassador evidence, and the RevenueCat lookup failed or was unavailable — cannot confirm or rule out an active RC entitlement. Left untouched.'
      : 'No corroborating Stripe/gift/ambassador evidence, and RevenueCat has no active entitlement on record for this identity either. Left untouched rather than assumed free — this value\'s original source cannot be confirmed from available evidence.',
  };
}

export interface DryRunReport {
  totalCandidates:              number;
  classifications:              Record<ProvenanceClassification, number>;
  ambiguousCount:                number;
  historicalPlanInconsistencyCount: number;
  rcLookupAttempted:             number;
  rcLookupFailed:                number;
  stripeLifetimeVerificationAttempted: number;
  stripeLifetimeVerificationFailed:    number;
  candidates:                    ReconciliationCandidate[];
}

interface CandidateUserRow {
  id: string; email: string; plan: string;
  stripeInterval: string | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive: boolean; revenueCatInterval: string | null;
  isProTrial: boolean; trialExpiresAt: string | null;
}

/**
 * Build the dry-run classification report. READ-ONLY with respect to
 * GasCap's database — makes zero writes. Makes live, read-only calls to
 * RevenueCat (v2 customer search + active_entitlements — see
 * lib/revenueCatApi.ts, which cannot create a RevenueCat customer) and to
 * Stripe (Checkout Session list calls — read-only) for every candidate.
 *
 * SCOPE — post-Revision-4 fix: no longer gated on current `plan`. Includes
 * every user with ANY of: a non-null `stripeInterval`, a
 * `stripeSubscriptionId`, `ambassadorProForLife`, `plan IN ('pro','fleet')`,
 * or a redeemed Gift record — broad enough to catch a user who was WRONGLY
 * downgraded to `plan='free'` by the pre-fix bug (RevenueCat's old
 * EXPIRATION/REFUND handling called `setUserPlan(userId,'free')`, which
 * never clears `stripeInterval`, so such a user's Stripe/gift Lifetime
 * value can still be sitting there, unexamined, under the old narrower
 * `plan IN ('pro','fleet')`-only scope).
 */
export async function buildDryRunReport(): Promise<DryRunReport> {
  const selectFields = {
    id: true, email: true, plan: true,
    stripeInterval: true, stripeSubscriptionId: true, stripeCustomerId: true,
    ambassadorProForLife: true,
    revenueCatActive: true, revenueCatInterval: true,
    isProTrial: true, trialExpiresAt: true,
  } as const;

  const [byFieldEvidence, redeemedGifts] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          { stripeInterval: { not: null } },
          { stripeSubscriptionId: { not: null } },
          { ambassadorProForLife: true },
          { plan: { in: ['pro', 'fleet'] } },
        ],
      },
      select: selectFields,
    }),
    prisma.gift.findMany({
      where: { redeemedByUserId: { not: null }, status: { in: ['paid', 'redeemed'] } },
      select: { redeemedByUserId: true },
    }),
  ]);

  const giftedUserIds = new Set(redeemedGifts.map((g) => g.redeemedByUserId).filter((v): v is string => !!v));
  const byId = new Map(byFieldEvidence.map((u) => [u.id, u]));

  // Union in any gifted user not already captured by the field-evidence
  // query (e.g. a gift-only Lifetime with no stripeInterval set at all —
  // shouldn't happen given how gift redemption is implemented today, but
  // the whole point of broadening scope is to not assume that).
  const missingGiftedIds = [...giftedUserIds].filter((id) => !byId.has(id));
  const extraUsers = missingGiftedIds.length
    ? await prisma.user.findMany({ where: { id: { in: missingGiftedIds } }, select: selectFields })
    : [];
  for (const u of extraUsers) byId.set(u.id, u);

  const users: CandidateUserRow[] = [...byId.values()];

  const candidates: ReconciliationCandidate[] = [];
  let rcAttempted = 0, rcFailed = 0;
  let stripeAttempted = 0, stripeFailed = 0;

  for (const u of users) {
    const hasRedeemedGift = giftedUserIds.has(u.id);

    // Post-Revision-4 fix: RC lookup attempted for EVERY candidate, not
    // only ones lacking internal evidence — see the module doc comment,
    // point 2.
    let rc: AuthoritativeRevenueCatState | null = null;
    rcAttempted++;
    try {
      rc = await fetchAuthoritativeRevenueCatState(u.id);
    } catch (err) {
      rcFailed++;
      console.error(`[revenueCatHistoricalReconciliation] RC lookup failed for ${u.email}:`, err);
      rc = null; // failure => ambiguous for RC purposes, never guessed
    }

    // Only bother verifying Stripe Lifetime purchase evidence for the
    // specific pattern where it could matter: a customer id present, no
    // subscription, and stripeInterval='lifetime'. Verifying it for every
    // candidate regardless would waste Stripe API calls on cases where the
    // answer can't change the classification (e.g. someone with an active
    // Stripe subscription is already confirmed_stripe_subscription).
    let stripeLifetimeVerified = false;
    const stripeLifetimePatternPresent = !!u.stripeCustomerId && !u.stripeSubscriptionId && u.stripeInterval === 'lifetime';
    if (stripeLifetimePatternPresent) {
      stripeAttempted++;
      try {
        const evidence = await verifyStripeLifetimePurchase(u.stripeCustomerId);
        stripeLifetimeVerified = evidence.verified;
      } catch (err) {
        stripeFailed++;
        console.error(`[revenueCatHistoricalReconciliation] Stripe Lifetime verification failed for ${u.email}:`, err);
        stripeLifetimeVerified = false; // failure => not verified, never assumed
      }
    }

    const result = classifyProvenance({
      stripeInterval:         u.stripeInterval,
      stripeSubscriptionId:   u.stripeSubscriptionId,
      stripeCustomerId:       u.stripeCustomerId,
      ambassadorProForLife:   u.ambassadorProForLife,
      hasRedeemedGift,
      stripeLifetimeVerified,
      rc,
    });

    // Recompute the aggregate entitlement using the SAME central resolver
    // used everywhere else, incorporating the proposed RC fields (not the
    // stale stored ones) — this is what surfaces a historical plan
    // inconsistency.
    const resolved = resolveUserEntitlements({
      ambassadorProForLife: u.ambassadorProForLife,
      stripeInterval:       result.proposedClearLegacyStripeInterval ? null : u.stripeInterval,
      stripeSubscriptionId: u.stripeSubscriptionId,
      revenueCatActive:     result.proposedRevenueCatActive ?? u.revenueCatActive,
      revenueCatInterval:   result.proposedRevenueCatInterval ?? u.revenueCatInterval,
      isProTrial:           u.isProTrial,
      trialExpiresAt:       u.trialExpiresAt,
    });

    const currentlyPro = u.plan === 'pro' || u.plan === 'fleet';
    // Only ever propose a repair TOWARD Pro — never away from it. A
    // resolved-not-Pro-but-stored-Pro mismatch is not reported as needing
    // a downgrade; per the brief, this migration never downgrades anyone.
    const historicalPlanInconsistency = resolved.pro && !currentlyPro;
    const proposedPlanRepair: 'pro' | null = historicalPlanInconsistency ? 'pro' : null;

    candidates.push({
      userId: u.id, email: u.email, currentPlan: u.plan,
      stripeInterval: u.stripeInterval, stripeSubscriptionId: u.stripeSubscriptionId, stripeCustomerId: u.stripeCustomerId,
      ambassadorProForLife: u.ambassadorProForLife, hasRedeemedGift,
      stripeLifetimeVerified,
      rcLookup: rc ?? 'lookup_failed',
      classification: result.classification,
      proposedRevenueCatActive:    result.proposedRevenueCatActive,
      proposedRevenueCatInterval:  result.proposedRevenueCatInterval,
      proposedRevenueCatProductId: result.proposedRevenueCatProductId,
      proposedClearLegacyStripeInterval: result.proposedClearLegacyStripeInterval,
      resolvedShouldBePro: resolved.pro,
      resolvedSources: resolved.sources,
      historicalPlanInconsistency,
      proposedPlanRepair,
      reason: result.reason,
    });
  }

  const classifications = {} as Record<ProvenanceClassification, number>;
  for (const c of candidates) classifications[c.classification] = (classifications[c.classification] ?? 0) + 1;

  return {
    totalCandidates: candidates.length,
    classifications,
    ambiguousCount: candidates.filter((c) => c.classification === 'ambiguous_legacy_provenance').length,
    historicalPlanInconsistencyCount: candidates.filter((c) => c.historicalPlanInconsistency).length,
    rcLookupAttempted: rcAttempted,
    rcLookupFailed: rcFailed,
    stripeLifetimeVerificationAttempted: stripeAttempted,
    stripeLifetimeVerificationFailed: stripeFailed,
    candidates,
  };
}

export interface BackfillResult {
  rcFieldsAttempted:      number;
  rcFieldsUpdated:        number;
  rcFieldsSkipped:        number;
  legacyClearAttempted:   number;
  legacyClearUpdated:     number;
  legacyClearSkipped:     number;
  planRepairAttempted:    number;
  planRepairUpdated:      number;
  planRepairSkipped:      number;
}

/**
 * Apply the proposed changes from a dry-run report. Three independent,
 * additive-only operations, each scoped to exactly the candidates whose
 * classification proves it's safe:
 *
 *  1. RC field backfill — any candidate with `proposedRevenueCatActive ===
 *     true` gets `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId`
 *     populated. Never touches `stripeInterval` or `plan` directly.
 *  2. Legacy stripeInterval clear — ONLY `confirmed_legacy_rc_contamination`
 *     candidates (`proposedClearLegacyStripeInterval === true`) have
 *     `stripeInterval` set to null. This is the one operation that removes
 *     a value rather than adding one — restricted to the single proven
 *     case, never applied to an ambiguous or multi-source candidate.
 *  3. Plan repair — ONLY candidates with `proposedPlanRepair === 'pro'`
 *     (stored `plan` says free/other but the resolved aggregate says Pro)
 *     get `plan: 'pro'` set. Never the reverse — this migration never
 *     downgrades.
 *
 * `ambiguous_legacy_provenance` candidates are touched by NONE of the
 * three operations.
 */
export async function applyReconciliation(report: DryRunReport): Promise<BackfillResult> {
  const result: BackfillResult = {
    rcFieldsAttempted: 0, rcFieldsUpdated: 0, rcFieldsSkipped: 0,
    legacyClearAttempted: 0, legacyClearUpdated: 0, legacyClearSkipped: 0,
    planRepairAttempted: 0, planRepairUpdated: 0, planRepairSkipped: 0,
  };

  for (const c of report.candidates) {
    if (c.proposedRevenueCatActive === true) {
      result.rcFieldsAttempted++;
      try {
        await prisma.user.update({
          where: { id: c.userId },
          data: {
            revenueCatActive:    true,
            revenueCatInterval:  c.proposedRevenueCatInterval,
            revenueCatProductId: c.proposedRevenueCatProductId,
          },
        });
        result.rcFieldsUpdated++;
      } catch (err) {
        console.error(`[revenueCatHistoricalReconciliation] RC field backfill failed for ${c.email}:`, err);
        result.rcFieldsSkipped++;
      }
    }

    if (c.proposedClearLegacyStripeInterval) {
      result.legacyClearAttempted++;
      try {
        await prisma.user.update({
          where: { id: c.userId },
          data: { stripeInterval: null },
        });
        result.legacyClearUpdated++;
      } catch (err) {
        console.error(`[revenueCatHistoricalReconciliation] legacy stripeInterval clear failed for ${c.email}:`, err);
        result.legacyClearSkipped++;
      }
    }

    if (c.proposedPlanRepair === 'pro') {
      result.planRepairAttempted++;
      try {
        await prisma.user.update({
          where: { id: c.userId },
          data: { plan: 'pro' },
        });
        result.planRepairUpdated++;
      } catch (err) {
        console.error(`[revenueCatHistoricalReconciliation] plan repair failed for ${c.email}:`, err);
        result.planRepairSkipped++;
      }
    }
  }

  return result;
}
