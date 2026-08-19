/**
 * Post-Sprint-2 Revision 5 — historical RevenueCat entitlement reconciliation.
 *
 * THE PROBLEM: before this hardening sprint's provenance fix, every
 * RevenueCat grant wrote `interval` into `stripeInterval` (the same field
 * genuine Stripe/gift purchases use). Separately, RevenueCat
 * EXPIRATION/REFUND events called `setUserPlan(userId, 'free')`, which does
 * NOT clear `stripeInterval` — so a legitimate Stripe/gift Lifetime
 * purchaser could already exist today as `plan='free', stripeInterval=
 * 'lifetime'`, wrongly downgraded by an unrelated RevenueCat-side event
 * before this sprint's fix existed.
 *
 * REVISION 5 CHANGES FROM REVISION 4 (each addresses a specific finding):
 *
 * 1. FIELD-SPECIFIC CONTAMINATION LOGIC. Revision 4 only proposed clearing
 *    `stripeInterval` when EXACTLY ONE confirmed source existed. That's too
 *    restrictive: a user can have TWO genuine, unrelated confirmed sources
 *    (e.g. an active Stripe MONTHLY subscription AND an active RevenueCat
 *    LIFETIME entitlement) where neither of them explains a leftover
 *    `stripeInterval='lifetime'` marker — the monthly subscription doesn't
 *    explain a Lifetime marker, and Ambassador status doesn't explain a
 *    Stripe-provenance marker at all. This now separates "what sources does
 *    this user have" (drives `multiple_legitimate_sources` labeling and RC
 *    field backfill) from "what specifically explains THIS stripeInterval
 *    VALUE" (drives `proposedClearLegacyStripeInterval` — see
 *    `explainStripeIntervalValue` below). A candidate can legitimately be
 *    `multiple_legitimate_sources` AND have
 *    `proposedClearLegacyStripeInterval: true` at the same time.
 * 2. STRIPE LIFETIME EVIDENCE IS NOW TRI-STATE (see `lib/stripeEvidence.ts`
 *    — VERIFIED_LIFETIME / VERIFIED_NO_LIFETIME / INCONCLUSIVE). Only
 *    VERIFIED_NO_LIFETIME may ever support a destructive `stripeInterval`
 *    clear; INCONCLUSIVE (Stripe API failure, not configured, etc.) makes
 *    that specific field's contamination proposal ineligible, even if
 *    RevenueCat's state would otherwise support it.
 * 3. HISTORICAL PLAN REPAIR NO LONGER TRUSTS A STORED
 *    `stripeSubscriptionId` BY ITSELF. A `plan='free' → 'pro'` repair that
 *    would rely on a Stripe subscription id now requires a live Stripe
 *    verification (`verifyStripeSubscriptionActive`) confirming the
 *    subscription isn't actually canceled — a stale/missed-webhook id must
 *    not repair a plan. If that verification is inconclusive, the repair is
 *    not proposed on that evidence alone (other confirmed sources can still
 *    justify it independently).
 * 4. APPLY IS NOW ATOMIC PER CANDIDATE. `applyReconciliation` used to issue
 *    up to three independent `prisma.user.update` calls per candidate,
 *    each caught separately — a partial failure could leave a candidate in
 *    an invalid mixed state (e.g. RC fields backfilled but the legacy
 *    stripeInterval clear failed, or vice versa). Every candidate's
 *    approved changes are now combined into exactly ONE
 *    `prisma.user.update` call — either all of that candidate's proposed
 *    changes land, or none do. Other candidates are unaffected by one
 *    candidate's failure.
 * 5. APPLY IS BOUND TO THE REVIEWED REPORT VIA `reportHash`. `POST
 *    {confirm:true}` used to silently recompute a brand-new dry run and
 *    apply whatever IT said — not necessarily what was actually reviewed.
 *    `buildDryRunReport()` now returns a deterministic `reportHash`
 *    (canonical, order-independent) over every candidate's proposed
 *    mutation. The apply endpoint requires the caller to echo back the
 *    reviewed hash; if RevenueCat/Stripe state (or anything else) changed
 *    between GET and POST such that the live proposal no longer matches,
 *    the apply is refused (409) and nothing is mutated.
 *
 * NEVER AUTOMATICALLY DOWNGRADES OR ERASES ANYTHING beyond the narrowly
 * proven legacy-`stripeInterval` clear. A candidate that remains ambiguous
 * after all evidence is exhausted is reported and left completely
 * untouched. `apply()` still requires Don's explicit approval per the
 * dry-run report's actual content (and now its exact hash), per
 * `/CLAUDE.md`'s standing database-safety rule.
 */

import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { fetchAuthoritativeRevenueCatState, type AuthoritativeRevenueCatState } from '@/lib/revenueCatApi';
import {
  verifyStripeLifetimePurchase, verifyStripeSubscriptionActive,
  type StripeLifetimeEvidenceStatus,
} from '@/lib/stripeEvidence';
import { resolveUserEntitlements } from '@/lib/entitlements';

export type ProvenanceClassification =
  | 'confirmed_stripe_subscription'         // real stripeSubscriptionId — an active Stripe sub
  | 'confirmed_stripe_lifetime'             // a VERIFIED completed Checkout Session for the Lifetime price
  | 'confirmed_gifted_lifetime'             // a redeemed Gift record names this user
  | 'confirmed_ambassador'                  // ambassadorProForLife — GasCap-internal grant, no provider involved
  | 'confirmed_active_rc_monthly'           // RC API confirms an active monthly entitlement, no other source
  | 'confirmed_active_rc_lifetime'          // RC API confirms an active lifetime entitlement, no other source
  | 'confirmed_legacy_rc_contamination'     // stripeInterval unexplained by anything else, but RC positively proves it originated from RC — the SOLE confirmed source case
  | 'multiple_legitimate_sources'           // more than one CONFIRMED source applies (genuine Stripe/gift/Ambassador AND/OR active RC) — may STILL carry a proposedClearLegacyStripeInterval, see module doc comment point 1
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
  stripeLifetimeEvidence:            StripeLifetimeEvidenceStatus | 'not_checked';
  rcLookup:                          AuthoritativeRevenueCatState | 'lookup_failed';
  classification:                    ProvenanceClassification;
  /** Proposed value — null means "propose no change to this field." Never populated for an ambiguous candidate. */
  proposedRevenueCatActive:          boolean | null;
  proposedRevenueCatInterval:        string | null;
  proposedRevenueCatProductId:       string | null;
  /** True whenever stripeInterval is set but nothing legitimate explains THIS specific value — independent of the overall classification, see module doc comment point 1. */
  proposedClearLegacyStripeInterval: boolean;
  resolvedShouldBePro:               boolean;
  resolvedSources:                   string[];
  stripeSubscriptionVerification:    'VERIFIED_ACTIVE' | 'VERIFIED_INACTIVE' | 'INCONCLUSIVE' | 'not_checked';
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
  stripeLifetimeEvidence: StripeLifetimeEvidenceStatus | 'not_checked';
  rc:                     AuthoritativeRevenueCatState | null; // null = lookup failed or unavailable — never treated as "confirmed inactive"
}

/**
 * Does a legitimate, non-RC source explain THIS specific `stripeInterval`
 * value? Distinct question from "does this user have a confirmed source at
 * all" — see module doc comment point 1.
 *
 * Returns 'inconclusive' (never 'not_explained') whenever the relevant
 * Stripe evidence itself couldn't be determined — an inconclusive check
 * must never be treated as proof of contamination.
 */
function explainStripeIntervalValue(input: ClassifyInput): 'explained' | 'not_explained' | 'inconclusive' {
  if (input.stripeInterval === null) return 'explained'; // nothing to explain
  if (input.stripeInterval === 'lifetime') {
    if (input.hasRedeemedGift) return 'explained';
    if (input.stripeLifetimeEvidence === 'VERIFIED_LIFETIME') return 'explained';
    // No Stripe customer at all — there is no possible Stripe purchase to
    // have missed, so this is definitively not explained, not inconclusive.
    if (!input.stripeCustomerId) return 'not_explained';
    if (input.stripeLifetimeEvidence === 'INCONCLUSIVE' || input.stripeLifetimeEvidence === 'not_checked') return 'inconclusive';
    return 'not_explained'; // VERIFIED_NO_LIFETIME
  }
  // 'monthly' / 'annual' / any other non-null, non-lifetime value.
  return input.stripeSubscriptionId ? 'explained' : 'not_explained';
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
  if (input.stripeLifetimeEvidence === 'VERIFIED_LIFETIME') confirmedSources.push('confirmed_stripe_lifetime');

  // rc === null means the lookup failed or wasn't possible — NEVER treated
  // as "confirmed inactive." Only a genuine, successful lookup result
  // (customerFound + active) counts as RC evidence either way.
  const rcActive = input.rc !== null && input.rc.active === true;
  if (rcActive) {
    confirmedSources.push(input.rc!.interval === 'lifetime' ? 'confirmed_active_rc_lifetime' : 'confirmed_active_rc_monthly');
  }

  const intervalExplanation = explainStripeIntervalValue(input);
  // Only propose clearing when: a value is actually set, nothing legitimate
  // explains THIS value, AND RevenueCat's live state positively proves
  // where it actually came from. An inconclusive Stripe check NEVER
  // supports this, regardless of RC state — see explainStripeIntervalValue.
  const proposedClearLegacyStripeInterval =
    input.stripeInterval !== null && intervalExplanation === 'not_explained' && rcActive;

  const rcFieldProposals = rcActive
    ? {
        proposedRevenueCatActive: true as boolean | null,
        proposedRevenueCatInterval: input.rc!.interval ?? null,
        proposedRevenueCatProductId: input.rc!.productId ?? null,
      }
    : {
        proposedRevenueCatActive: null as boolean | null,
        proposedRevenueCatInterval: null as string | null,
        proposedRevenueCatProductId: null as string | null,
      };

  if (confirmedSources.length > 1) {
    // More than one CONFIRMED source. stripeInterval may STILL be proposed
    // for clearing here — a second, unrelated confirmed source does not
    // automatically explain the exact stripeInterval value on record (e.g.
    // a Stripe MONTHLY subscription does not explain a leftover
    // stripeInterval='lifetime' marker). See explainStripeIntervalValue.
    return {
      classification: 'multiple_legitimate_sources',
      ...rcFieldProposals,
      proposedClearLegacyStripeInterval,
      reason: `Multiple confirmed sources: ${confirmedSources.join(', ')}.`
        + (proposedClearLegacyStripeInterval
          ? ` stripeInterval='${input.stripeInterval}' is NOT explained by any of them — RevenueCat's live state proves this specific marker originated from the pre-Sprint-2 provenance bug, even though the account's overall Pro status is independently legitimate.`
          : ''),
    };
  }

  if (confirmedSources.length === 1) {
    const only = confirmedSources[0];
    const isLoneRc = only.startsWith('confirmed_active_rc');

    if (isLoneRc && proposedClearLegacyStripeInterval) {
      return {
        classification: 'confirmed_legacy_rc_contamination',
        ...rcFieldProposals,
        proposedClearLegacyStripeInterval: true,
        reason: `stripeInterval='${input.stripeInterval}' has no explanation other than RevenueCat — RC's live state confirms an active entitlement for this identity and no genuine Stripe/gift/Ambassador source exists. This proves the stripeInterval value originated from the pre-Sprint-2 provenance bug.`,
      };
    }

    return {
      classification: only,
      ...rcFieldProposals,
      proposedClearLegacyStripeInterval,
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
  stripeLifetimeVerificationInconclusive: number;
  stripeSubscriptionVerificationAttempted: number;
  stripeSubscriptionVerificationInconclusive: number;
  /**
   * Deterministic, canonical hash over every candidate's proposed mutation
   * (userId + proposed fields only — never volatile counters/logging).
   * Candidates are sorted by userId before hashing, so ordering never
   * affects the result. The apply endpoint requires this exact value to be
   * echoed back — see `computeReportHash` and module doc comment point 5.
   */
  reportHash:                    string;
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
 * Canonical, order-independent hash of a report's proposed mutations only —
 * excludes counters, lookup-failure tallies, and any other field that could
 * change between two runs without the actual PROPOSAL changing. Two reports
 * with identical proposals hash identically regardless of candidate array
 * order; any proposal-relevant field changing (e.g. because RevenueCat or
 * Stripe state changed between GET and POST) changes the hash.
 */
export function computeReportHash(candidates: ReconciliationCandidate[]): string {
  const canonical = [...candidates]
    .map((c) => ({
      userId: c.userId,
      classification: c.classification,
      proposedRevenueCatActive: c.proposedRevenueCatActive,
      proposedRevenueCatInterval: c.proposedRevenueCatInterval,
      proposedRevenueCatProductId: c.proposedRevenueCatProductId,
      proposedClearLegacyStripeInterval: c.proposedClearLegacyStripeInterval,
      proposedPlanRepair: c.proposedPlanRepair,
    }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Build the dry-run classification report. READ-ONLY with respect to
 * GasCap's database — makes zero writes. Makes live, read-only calls to
 * RevenueCat (v2 customer search + production subscriptions/purchases —
 * see lib/revenueCatApi.ts, which cannot create a RevenueCat customer) and
 * to Stripe (Checkout Session list calls, and a live subscription-status
 * check when a plan repair might depend on one — both read-only) for
 * candidates where the answer can affect the outcome.
 *
 * SCOPE: not gated on current `plan`. Includes every user with ANY of: a
 * non-null `stripeInterval`, a `stripeSubscriptionId`, `ambassadorProForLife`,
 * `plan IN ('pro','fleet')`, or a redeemed Gift record — broad enough to
 * catch a user who was WRONGLY downgraded to `plan='free'` by the pre-fix
 * bug.
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

  const missingGiftedIds = [...giftedUserIds].filter((id) => !byId.has(id));
  const extraUsers = missingGiftedIds.length
    ? await prisma.user.findMany({ where: { id: { in: missingGiftedIds } }, select: selectFields })
    : [];
  for (const u of extraUsers) byId.set(u.id, u);

  const users: CandidateUserRow[] = [...byId.values()];

  const candidates: ReconciliationCandidate[] = [];
  let rcAttempted = 0, rcFailed = 0;
  let stripeLifetimeAttempted = 0, stripeLifetimeInconclusive = 0;
  let stripeSubAttempted = 0, stripeSubInconclusive = 0;

  for (const u of users) {
    const hasRedeemedGift = giftedUserIds.has(u.id);

    // RC lookup attempted for EVERY candidate — GasCap supports
    // simultaneous entitlement sources, so skipping it whenever internal
    // evidence exists would miss backfilling revenueCatActive for exactly
    // that combination.
    let rc: AuthoritativeRevenueCatState | null = null;
    rcAttempted++;
    try {
      rc = await fetchAuthoritativeRevenueCatState(u.id);
    } catch (err) {
      rcFailed++;
      console.error(`[revenueCatHistoricalReconciliation] RC lookup failed for ${u.email}:`, err);
      rc = null; // failure => ambiguous for RC purposes, never guessed
    }

    // Verify Stripe Lifetime purchase evidence whenever stripeInterval is
    // 'lifetime' and there's a Stripe customer to check — NOT gated on the
    // absence of a stripeSubscriptionId, since a monthly subscription does
    // not explain a Lifetime marker either (see explainStripeIntervalValue,
    // module doc comment point 1) — a user can genuinely have both.
    let stripeLifetimeEvidence: StripeLifetimeEvidenceStatus | 'not_checked' = 'not_checked';
    const stripeLifetimePatternPresent = !!u.stripeCustomerId && u.stripeInterval === 'lifetime';
    if (stripeLifetimePatternPresent) {
      stripeLifetimeAttempted++;
      const evidence = await verifyStripeLifetimePurchase(u.stripeCustomerId);
      stripeLifetimeEvidence = evidence.status;
      if (evidence.status === 'INCONCLUSIVE') stripeLifetimeInconclusive++;
    }

    const result = classifyProvenance({
      stripeInterval:         u.stripeInterval,
      stripeSubscriptionId:   u.stripeSubscriptionId,
      stripeCustomerId:       u.stripeCustomerId,
      ambassadorProForLife:   u.ambassadorProForLife,
      hasRedeemedGift,
      stripeLifetimeEvidence,
      rc,
    });

    // Informational aggregate — the full evidence picture as stored,
    // including an UNVERIFIED stripeSubscriptionId. This is NOT what gates
    // a plan repair; see stripeSubVerification below.
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

    // A plan repair (free -> pro) must never rely on an UNVERIFIED
    // stripeSubscriptionId — this is a historical repair tool operating on
    // potentially stale data, not the normal runtime resolver. Only check
    // live Stripe status when a repair might actually be proposed and a
    // subscription id is present, to avoid unnecessary API calls.
    let stripeSubVerification: 'VERIFIED_ACTIVE' | 'VERIFIED_INACTIVE' | 'INCONCLUSIVE' | 'not_checked' = 'not_checked';
    if (!currentlyPro && u.stripeSubscriptionId && resolved.pro) {
      stripeSubAttempted++;
      stripeSubVerification = await verifyStripeSubscriptionActive(u.stripeSubscriptionId);
      if (stripeSubVerification === 'INCONCLUSIVE') stripeSubInconclusive++;
    }

    // The repair-eligible resolve — excludes stripeSubscriptionId unless
    // it was live-verified active, so a stale/unverified id can never by
    // itself justify a plan repair. Other confirmed sources (verified
    // Stripe Lifetime, gift, Ambassador, active RC) are unaffected and can
    // still independently justify a repair.
    const repairResolved = resolveUserEntitlements({
      ambassadorProForLife: u.ambassadorProForLife,
      stripeInterval:       result.proposedClearLegacyStripeInterval ? null : u.stripeInterval,
      stripeSubscriptionId: stripeSubVerification === 'VERIFIED_ACTIVE' ? u.stripeSubscriptionId : null,
      revenueCatActive:     result.proposedRevenueCatActive ?? u.revenueCatActive,
      revenueCatInterval:   result.proposedRevenueCatInterval ?? u.revenueCatInterval,
      isProTrial:           u.isProTrial,
      trialExpiresAt:       u.trialExpiresAt,
    });

    // Only ever propose a repair TOWARD Pro — never away from it.
    const historicalPlanInconsistency = repairResolved.pro && !currentlyPro;
    const proposedPlanRepair: 'pro' | null = historicalPlanInconsistency ? 'pro' : null;

    candidates.push({
      userId: u.id, email: u.email, currentPlan: u.plan,
      stripeInterval: u.stripeInterval, stripeSubscriptionId: u.stripeSubscriptionId, stripeCustomerId: u.stripeCustomerId,
      ambassadorProForLife: u.ambassadorProForLife, hasRedeemedGift,
      stripeLifetimeEvidence,
      rcLookup: rc ?? 'lookup_failed',
      classification: result.classification,
      proposedRevenueCatActive:    result.proposedRevenueCatActive,
      proposedRevenueCatInterval:  result.proposedRevenueCatInterval,
      proposedRevenueCatProductId: result.proposedRevenueCatProductId,
      proposedClearLegacyStripeInterval: result.proposedClearLegacyStripeInterval,
      resolvedShouldBePro: resolved.pro,
      resolvedSources: resolved.sources,
      stripeSubscriptionVerification: stripeSubVerification,
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
    stripeLifetimeVerificationAttempted: stripeLifetimeAttempted,
    stripeLifetimeVerificationInconclusive: stripeLifetimeInconclusive,
    stripeSubscriptionVerificationAttempted: stripeSubAttempted,
    stripeSubscriptionVerificationInconclusive: stripeSubInconclusive,
    reportHash: computeReportHash(candidates),
    candidates,
  };
}

export interface CandidateApplyResult {
  userId: string;
  email: string;
  /** False if this candidate had no proposed changes at all — never attempted. */
  attempted: boolean;
  applied: boolean;
  appliedFields: string[];
  error?: string;
}

export interface BackfillResult {
  candidatesWithProposedChanges: number;
  candidatesUpdated:             number;
  candidatesFailed:              number;
  rcFieldsProposed:              number;
  legacyClearProposed:           number;
  planRepairProposed:            number;
  results:                       CandidateApplyResult[];
}

/**
 * Apply the proposed changes from a dry-run report.
 *
 * Post-Revision-5 fix: every candidate's approved changes (RC field
 * backfill, legacy stripeInterval clear, plan repair — whichever apply) are
 * combined into exactly ONE `prisma.user.update` call. Either all of that
 * candidate's proposed changes land, or none do — a partial failure can
 * never leave one candidate in a mixed, invalid state. Other candidates
 * continue independently; one candidate's failure never blocks another's.
 *
 * `ambiguous_legacy_provenance` candidates, and any candidate with no
 * proposed changes at all, are never touched (not even attempted).
 */
export async function applyReconciliation(report: DryRunReport): Promise<BackfillResult> {
  const results: CandidateApplyResult[] = [];
  let rcFieldsProposed = 0, legacyClearProposed = 0, planRepairProposed = 0;
  let candidatesUpdated = 0, candidatesFailed = 0;

  for (const c of report.candidates) {
    const data: { revenueCatActive?: boolean; revenueCatInterval?: string | null; revenueCatProductId?: string | null; stripeInterval?: null; plan?: string } = {};
    const appliedFields: string[] = [];

    if (c.proposedRevenueCatActive === true) {
      data.revenueCatActive = true;
      data.revenueCatInterval = c.proposedRevenueCatInterval;
      data.revenueCatProductId = c.proposedRevenueCatProductId;
      appliedFields.push('revenueCatActive', 'revenueCatInterval', 'revenueCatProductId');
      rcFieldsProposed++;
    }
    if (c.proposedClearLegacyStripeInterval) {
      data.stripeInterval = null;
      appliedFields.push('stripeInterval');
      legacyClearProposed++;
    }
    if (c.proposedPlanRepair === 'pro') {
      data.plan = 'pro';
      appliedFields.push('plan');
      planRepairProposed++;
    }

    if (appliedFields.length === 0) {
      results.push({ userId: c.userId, email: c.email, attempted: false, applied: false, appliedFields: [] });
      continue;
    }

    try {
      await prisma.user.update({ where: { id: c.userId }, data });
      candidatesUpdated++;
      results.push({ userId: c.userId, email: c.email, attempted: true, applied: true, appliedFields });
    } catch (err) {
      candidatesFailed++;
      console.error(`[revenueCatHistoricalReconciliation] atomic apply failed for ${c.email}:`, err);
      results.push({
        userId: c.userId, email: c.email, attempted: true, applied: false, appliedFields,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    candidatesWithProposedChanges: results.filter((r) => r.attempted).length,
    candidatesUpdated, candidatesFailed,
    rcFieldsProposed, legacyClearProposed, planRepairProposed,
    results,
  };
}
