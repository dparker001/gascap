/**
 * Post-Sprint-2 Revision 7 — historical RevenueCat entitlement reconciliation.
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
 * REVISION 7 — THE BULK APPLY NO LONGER CLEARS stripeInterval AT ALL.
 *
 * Prior revisions (4/5/6) tried progressively narrower rules for WHEN it's
 * safe to automatically clear a `stripeInterval` value believed to be
 * legacy RevenueCat contamination. Independent review concluded that no
 * rule built on this tool's available evidence is safe enough for an
 * AUTOMATIC, DESTRUCTIVE, BULK operation:
 *
 *   - Stripe's Search API (which `verifyStripeLifetimePurchase` uses) is
 *     documented as EVENTUALLY CONSISTENT — a negative search result is
 *     not authoritative proof of absence.
 *   - This repository can only prove TODAY's Checkout Session code writes
 *     `payment_intent_data.metadata` — it cannot prove every historical
 *     GasCap Lifetime sale, across every prior version of this code, used
 *     the same metadata convention. A "no match" result could just as
 *     easily mean "this purchase predates that convention" as "this
 *     purchase never happened."
 *
 * So this migration no longer proposes or applies ANY `stripeInterval`
 * clear. The contamination-detection logic is KEPT — it's the only way to
 * identify the finite set of accounts worth a human looking at — but its
 * output is now purely informational:
 * `suspectedLegacyStripeIntervalContamination: boolean` on each candidate.
 * `applyReconciliation` never touches `stripeInterval`. If Don later
 * approves a specific user's cleanup after manual Stripe/RevenueCat
 * verification, that's a targeted, one-off operation — not this bulk tool.
 *
 * WHAT THIS MIGRATION STILL DOES AUTOMATICALLY (with explicit approval per
 * the dry-run report and `reportHash`/optimistic-concurrency binding):
 *   - Backfill confirmed RevenueCat fields (`revenueCatActive`/
 *     `revenueCatInterval`/`revenueCatProductId`) when a live RC lookup
 *     confirms an active entitlement.
 *   - Repair `plan` from `'free'` to `'pro'` — but ONLY from confirmed,
 *     NON-TRIAL sources (verified active Stripe subscription, verified
 *     Stripe/gift Lifetime, Ambassador, or an authoritative active
 *     RevenueCat entitlement). An active trial ALONE never generates a
 *     historical plan repair — see `buildDryRunReport`'s `repairResolved`
 *     computation, which zeroes out trial fields specifically for this
 *     decision. A trial is wall-clock dependent (it can expire between
 *     report and apply with no database field changing at all), and this
 *     is a payment/provenance reconciliation tool, not a trial-extension
 *     mechanism.
 *
 * PRIOR REVISIONS' STILL-RELEVANT DESIGN (kept):
 *
 * - FIELD-SPECIFIC CONTAMINATION LOGIC separates "what sources does this
 *   user have" (drives `multiple_legitimate_sources` labeling and RC field
 *   backfill) from "what specifically explains THIS stripeInterval VALUE"
 *   (drives `suspectedLegacyStripeIntervalContamination` — see
 *   `explainStripeIntervalValue` below). A candidate can legitimately be
 *   `multiple_legitimate_sources` AND have
 *   `suspectedLegacyStripeIntervalContamination: true` at the same time.
 * - Stripe Lifetime evidence is a 3-state, POSITIVE-EVIDENCE-ONLY result
 *   (`VERIFIED_LIFETIME` / `NO_MATCH` / `INCONCLUSIVE` — see
 *   `lib/stripeEvidence.ts`). `NO_MATCH` and `INCONCLUSIVE` are both
 *   insufficient to authorize a destructive action (moot now that nothing
 *   destructive happens here, but the type still enforces the discipline).
 * - Historical plan repairs never trust a stored `stripeSubscriptionId` by
 *   itself — a live Stripe verification (`verifyStripeSubscriptionActive`)
 *   must confirm the subscription isn't actually canceled/inactive before
 *   it can justify a repair on its own.
 * - `applyReconciliation` combines every approved change for a candidate
 *   into exactly ONE conditional update, using OPTIMISTIC CONCURRENCY —
 *   the `where` clause includes every precondition field the proposal
 *   depended on (including `currentRevenueCatProductId`, added this
 *   revision), so a row that changed since the report was built is left
 *   completely untouched (`stale: true`) rather than mutated on stale
 *   evidence.
 * - Apply is bound to the reviewed report via `reportHash` — a canonical
 *   hash over every candidate's precondition AND proposed mutation. `POST`
 *   recomputes the report live and 409s if the hash no longer matches.
 *
 * NEVER AUTOMATICALLY DOWNGRADES ANYTHING, and (as of this revision) never
 * automatically erases anything either. A candidate that remains ambiguous
 * after all evidence is exhausted is reported and left completely
 * untouched. `apply()` still requires Don's explicit approval per the
 * dry-run report's actual content (and its exact hash), per `/CLAUDE.md`'s
 * standing database-safety rule.
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
  | 'confirmed_legacy_rc_contamination'     // stripeInterval unexplained by anything else, RC positively suggests it originated from RC, and it's the SOLE confirmed source — SUSPECTED, report-only, never auto-cleared (Revision 7)
  | 'multiple_legitimate_sources'           // more than one CONFIRMED source applies (genuine Stripe/gift/Ambassador AND/OR active RC) — may STILL carry suspectedLegacyStripeIntervalContamination:true, see module doc comment
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
  /** Stored values AT REPORT TIME — the precondition snapshot the apply endpoint's optimistic-concurrency check verifies is still true before mutating. */
  currentRevenueCatActive:           boolean;
  currentRevenueCatInterval:         string | null;
  currentRevenueCatProductId:        string | null;
  stripeLifetimeEvidence:            StripeLifetimeEvidenceStatus | 'not_checked';
  rcLookup:                          AuthoritativeRevenueCatState | 'lookup_failed';
  classification:                    ProvenanceClassification;
  /** Proposed value — null means "propose no change to this field." Never populated for an ambiguous candidate. */
  proposedRevenueCatActive:          boolean | null;
  proposedRevenueCatInterval:        string | null;
  proposedRevenueCatProductId:       string | null;
  /**
   * REPORT-ONLY (Revision 7) — true whenever stripeInterval is set but
   * nothing legitimate explains THIS specific value, independent of the
   * overall classification (see module doc comment). This flags a
   * candidate for MANUAL review — `applyReconciliation` never acts on it,
   * never clears `stripeInterval`. Kept because it's the only way to
   * identify the finite set of accounts worth a human looking at.
   */
  suspectedLegacyStripeIntervalContamination: boolean;
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
    // The absence of stripeCustomerId is NOT proof of absence of a Stripe
    // purchase. GasCap's Lifetime Checkout Session does not set
    // customer_creation:'always' — a user with no prior stripeCustomerId
    // can complete a genuine paid guest checkout with session.customer ===
    // null. Evidence is correlated by GasCap userId (always present,
    // unlike stripeCustomerId), so 'not_checked' should never occur in
    // practice once stripeInterval === 'lifetime' — but is treated as
    // inconclusive defensively if it ever does, same as an outright
    // INCONCLUSIVE verification result.
    if (input.stripeLifetimeEvidence === 'INCONCLUSIVE' || input.stripeLifetimeEvidence === 'not_checked') return 'inconclusive';
    // NO_MATCH — a full, completed scan found no matching PaymentIntent.
    // This is used only to flag the candidate for MANUAL review (see
    // suspectedLegacyStripeIntervalContamination) — Stripe's Search API is
    // documented as eventually consistent, and this repository can't prove
    // every historical purchase used the same metadata convention, so
    // NO_MATCH is never treated as proof of absence for any destructive
    // purpose. It IS treated as "not explained" for report-only labeling.
    return 'not_explained';
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
  /** Report-only, see module doc comment — never applied. */
  suspectedLegacyStripeIntervalContamination: boolean;
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
  // Flag suspected contamination when: a value is actually set, nothing
  // legitimate explains THIS value, AND RevenueCat's live state positively
  // suggests where it actually came from. An inconclusive Stripe check
  // NEVER supports this, regardless of RC state — see
  // explainStripeIntervalValue. REPORT-ONLY per Revision 7 — never applied.
  const suspectedLegacyStripeIntervalContamination =
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
    // More than one CONFIRMED source. stripeInterval may STILL be flagged
    // as suspected contamination here — a second, unrelated confirmed
    // source does not automatically explain the exact stripeInterval value
    // on record (e.g. a Stripe MONTHLY subscription does not explain a
    // leftover stripeInterval='lifetime' marker). See
    // explainStripeIntervalValue.
    return {
      classification: 'multiple_legitimate_sources',
      ...rcFieldProposals,
      suspectedLegacyStripeIntervalContamination,
      reason: `Multiple confirmed sources: ${confirmedSources.join(', ')}.`
        + (suspectedLegacyStripeIntervalContamination
          ? ` stripeInterval='${input.stripeInterval}' is NOT explained by any of them — RevenueCat's live state suggests this specific marker originated from the pre-Sprint-2 provenance bug, even though the account's overall Pro status is independently legitimate. SUSPECTED, not applied — see module doc comment.`
          : ''),
    };
  }

  if (confirmedSources.length === 1) {
    const only = confirmedSources[0];
    const isLoneRc = only.startsWith('confirmed_active_rc');

    if (isLoneRc && suspectedLegacyStripeIntervalContamination) {
      return {
        classification: 'confirmed_legacy_rc_contamination',
        ...rcFieldProposals,
        suspectedLegacyStripeIntervalContamination: true,
        reason: `stripeInterval='${input.stripeInterval}' has no explanation other than RevenueCat — RC's live state confirms an active entitlement for this identity and no genuine Stripe/gift/Ambassador source exists. SUSPECTED legacy contamination — flagged for manual review, NOT automatically cleared (see module doc comment).`,
      };
    }

    return {
      classification: only,
      ...rcFieldProposals,
      suspectedLegacyStripeIntervalContamination,
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
    suspectedLegacyStripeIntervalContamination: false,
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
   * Deterministic, canonical hash over every candidate's PRECONDITION
   * (the stored state that made the proposed mutation safe) AND its
   * proposed mutation — never volatile counters/logging/free-text. Binds
   * apply not just to "these are the changes reviewed" but to "this is the
   * state the reviewed changes were computed FROM" — see
   * `computeReportHash` and module doc comment point 5/6. Candidates are
   * sorted by userId before hashing, so ordering never affects the result.
   */
  reportHash:                    string;
  candidates:                    ReconciliationCandidate[];
}

interface CandidateUserRow {
  id: string; email: string; plan: string;
  stripeInterval: string | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null;
  ambassadorProForLife: boolean;
  revenueCatActive: boolean; revenueCatInterval: string | null; revenueCatProductId: string | null;
  isProTrial: boolean; trialExpiresAt: string | null;
}

/**
 * Canonical, order-independent hash over each candidate's PRECONDITION (the
 * stored, safety-relevant state the proposal was computed from) PLUS its
 * proposed mutation — never volatile counters, lookup-failure tallies, or
 * free-text `reason` strings.
 *
 * Post-Revision-6 fix: Revision 5's hash bound only the proposed
 * mutations, not the state that made them safe — a TOCTOU window existed
 * where `POST` could recompute an identical-looking proposal even though
 * the underlying row had changed in a way the proposal didn't happen to
 * depend on. Binding the precondition snapshot too means ANY safety-
 * relevant change between GET and POST (not just ones that flip the
 * proposal) changes the hash. This is belt-and-suspenders with the
 * per-candidate optimistic-concurrency check in `applyReconciliation` —
 * the hash catches a stale REPORT; the optimistic write catches a stale
 * ROW at the moment of the actual update.
 */
export function computeReportHash(candidates: ReconciliationCandidate[]): string {
  const canonical = [...candidates]
    .map((c) => ({
      userId: c.userId,
      // Precondition — the stored state this candidate's proposal depends on.
      currentPlan: c.currentPlan,
      stripeInterval: c.stripeInterval,
      stripeCustomerId: c.stripeCustomerId,
      stripeSubscriptionId: c.stripeSubscriptionId,
      ambassadorProForLife: c.ambassadorProForLife,
      hasRedeemedGift: c.hasRedeemedGift,
      currentRevenueCatActive: c.currentRevenueCatActive,
      currentRevenueCatInterval: c.currentRevenueCatInterval,
      currentRevenueCatProductId: c.currentRevenueCatProductId,
      // Provider-verification classifications — the live evidence gathered.
      classification: c.classification,
      stripeLifetimeEvidence: c.stripeLifetimeEvidence,
      stripeSubscriptionVerification: c.stripeSubscriptionVerification,
      suspectedLegacyStripeIntervalContamination: c.suspectedLegacyStripeIntervalContamination,
      // Proposed mutation — no longer includes any stripeInterval clear (Revision 7: report-only).
      proposedRevenueCatActive: c.proposedRevenueCatActive,
      proposedRevenueCatInterval: c.proposedRevenueCatInterval,
      proposedRevenueCatProductId: c.proposedRevenueCatProductId,
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
    revenueCatActive: true, revenueCatInterval: true, revenueCatProductId: true,
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
    // 'lifetime' — NOT gated on stripeCustomerId presence (a genuine guest
    // checkout can be a real Lifetime purchase with no stripeCustomerId at
    // all — see lib/stripeEvidence.ts) and NOT gated on the absence of a
    // stripeSubscriptionId (a monthly subscription doesn't explain a
    // Lifetime marker either — see explainStripeIntervalValue). Correlated
    // by GasCap's own userId, which every candidate has.
    let stripeLifetimeEvidence: StripeLifetimeEvidenceStatus | 'not_checked' = 'not_checked';
    if (u.stripeInterval === 'lifetime') {
      stripeLifetimeAttempted++;
      const evidence = await verifyStripeLifetimePurchase(u.id);
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
    // including an UNVERIFIED stripeSubscriptionId AND trial status. This
    // is NOT what gates a plan repair; see repairResolved below.
    const resolved = resolveUserEntitlements({
      ambassadorProForLife: u.ambassadorProForLife,
      stripeInterval:       result.suspectedLegacyStripeIntervalContamination ? null : u.stripeInterval,
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
    // it was live-verified active (a stale/unverified id can never by
    // itself justify a plan repair), and ALWAYS excludes trial status
    // entirely (isProTrial/trialExpiresAt hard-coded to false/null here,
    // regardless of the actual stored values) — an active trial alone must
    // never generate a historical plan repair. This is a payment/
    // provenance reconciliation tool, not a trial-extension mechanism, and
    // a trial is wall-clock dependent: it can expire between report and
    // apply with no database field changing at all. Other confirmed
    // sources (verified Stripe Lifetime, gift, Ambassador, active RC,
    // live-verified Stripe subscription) are unaffected and can still
    // independently justify a repair.
    const repairResolved = resolveUserEntitlements({
      ambassadorProForLife: u.ambassadorProForLife,
      stripeInterval:       result.suspectedLegacyStripeIntervalContamination ? null : u.stripeInterval,
      stripeSubscriptionId: stripeSubVerification === 'VERIFIED_ACTIVE' ? u.stripeSubscriptionId : null,
      revenueCatActive:     result.proposedRevenueCatActive ?? u.revenueCatActive,
      revenueCatInterval:   result.proposedRevenueCatInterval ?? u.revenueCatInterval,
      isProTrial:           false,
      trialExpiresAt:       null,
    });

    // Only ever propose a repair TOWARD Pro — never away from it.
    const historicalPlanInconsistency = repairResolved.pro && !currentlyPro;
    const proposedPlanRepair: 'pro' | null = historicalPlanInconsistency ? 'pro' : null;

    candidates.push({
      userId: u.id, email: u.email, currentPlan: u.plan,
      stripeInterval: u.stripeInterval, stripeSubscriptionId: u.stripeSubscriptionId, stripeCustomerId: u.stripeCustomerId,
      ambassadorProForLife: u.ambassadorProForLife, hasRedeemedGift,
      currentRevenueCatActive: u.revenueCatActive, currentRevenueCatInterval: u.revenueCatInterval,
      currentRevenueCatProductId: u.revenueCatProductId,
      stripeLifetimeEvidence,
      rcLookup: rc ?? 'lookup_failed',
      classification: result.classification,
      proposedRevenueCatActive:    result.proposedRevenueCatActive,
      proposedRevenueCatInterval:  result.proposedRevenueCatInterval,
      proposedRevenueCatProductId: result.proposedRevenueCatProductId,
      suspectedLegacyStripeIntervalContamination: result.suspectedLegacyStripeIntervalContamination,
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
  /** True when the optimistic-concurrency precondition no longer matched the live row — the candidate's row changed between report and apply, so NOTHING was mutated for it. */
  stale: boolean;
  appliedFields: string[];
  error?: string;
}

export interface BackfillResult {
  candidatesWithProposedChanges: number;
  candidatesUpdated:             number;
  candidatesStale:               number;
  candidatesFailed:              number;
  rcFieldsProposed:              number;
  planRepairProposed:            number;
  /** Report-only, informational — never applied. See module doc comment. */
  suspectedContaminationCount:   number;
  results:                       CandidateApplyResult[];
}

/**
 * Apply the proposed changes from a dry-run report.
 *
 * Post-Revision-7 fix — NEVER clears `stripeInterval`. Prior revisions
 * tried progressively narrower automatic-clear rules; independent review
 * concluded no rule built on this tool's available evidence (Stripe Search
 * is eventually consistent; historical checkout code predating the current
 * metadata convention can't be proven to follow it) is safe for an
 * automatic, destructive, bulk operation. This function now applies only:
 *   - RC field backfill (`revenueCatActive`/`revenueCatInterval`/
 *     `revenueCatProductId`) when a live RC lookup confirms an active
 *     entitlement.
 *   - Plan repair (`plan` -> `'pro'`) from confirmed, NON-TRIAL sources
 *     only — see `buildDryRunReport`'s `repairResolved` computation.
 * `suspectedLegacyStripeIntervalContamination` is carried through to the
 * report for manual review but is NEVER read by this function.
 *
 * Every candidate's approved changes (of the two kinds above) are combined
 * into exactly ONE update call — either all of that candidate's proposed
 * changes land, or none do.
 *
 * Optimistic concurrency against a TOCTOU window: `reportHash` (see
 * `computeReportHash`) binds the REPORT the caller reviewed, but a row can
 * still change in the moments between POST recomputing that report and
 * this function's actual write. Every update is therefore a conditional
 * `prisma.user.updateMany` whose `where` clause includes not just `id` but
 * every safety-relevant field this candidate's proposal was computed from
 * (`currentPlan`, `stripeInterval`, `stripeCustomerId`,
 * `stripeSubscriptionId`, `ambassadorProForLife`, `currentRevenueCatActive`,
 * `currentRevenueCatInterval`, `currentRevenueCatProductId`) — the exact
 * same precondition snapshot baked into `reportHash`. If the live row no
 * longer matches (`count === 0`), NOTHING is mutated for that candidate and
 * it is reported `stale: true`. Other candidates are entirely unaffected by
 * one candidate being stale or failing.
 *
 * `ambiguous_legacy_provenance` candidates, and any candidate with no
 * proposed changes at all, are never touched (not even attempted).
 */
export async function applyReconciliation(report: DryRunReport): Promise<BackfillResult> {
  const results: CandidateApplyResult[] = [];
  let rcFieldsProposed = 0, planRepairProposed = 0;
  let candidatesUpdated = 0, candidatesStale = 0, candidatesFailed = 0;
  const suspectedContaminationCount = report.candidates.filter((c) => c.suspectedLegacyStripeIntervalContamination).length;

  for (const c of report.candidates) {
    const data: { revenueCatActive?: boolean; revenueCatInterval?: string | null; revenueCatProductId?: string | null; plan?: string } = {};
    const appliedFields: string[] = [];

    if (c.proposedRevenueCatActive === true) {
      data.revenueCatActive = true;
      data.revenueCatInterval = c.proposedRevenueCatInterval;
      data.revenueCatProductId = c.proposedRevenueCatProductId;
      appliedFields.push('revenueCatActive', 'revenueCatInterval', 'revenueCatProductId');
      rcFieldsProposed++;
    }
    // NO stripeInterval clear — see module doc comment and this function's doc comment.
    if (c.proposedPlanRepair === 'pro') {
      data.plan = 'pro';
      appliedFields.push('plan');
      planRepairProposed++;
    }

    if (appliedFields.length === 0) {
      results.push({ userId: c.userId, email: c.email, attempted: false, applied: false, stale: false, appliedFields: [] });
      continue;
    }

    try {
      const { count } = await prisma.user.updateMany({
        where: {
          id: c.userId,
          plan: c.currentPlan,
          stripeInterval: c.stripeInterval,
          stripeCustomerId: c.stripeCustomerId,
          stripeSubscriptionId: c.stripeSubscriptionId,
          ambassadorProForLife: c.ambassadorProForLife,
          revenueCatActive: c.currentRevenueCatActive,
          revenueCatInterval: c.currentRevenueCatInterval,
          revenueCatProductId: c.currentRevenueCatProductId,
        },
        data,
      });
      if (count === 1) {
        candidatesUpdated++;
        results.push({ userId: c.userId, email: c.email, attempted: true, applied: true, stale: false, appliedFields });
      } else {
        // count === 0: the row no longer matches the precondition this
        // proposal was computed from — apply NOTHING for this candidate.
        candidatesStale++;
        console.warn(`[revenueCatHistoricalReconciliation] stale precondition for ${c.email} — row changed since the report was built, no mutation applied.`);
        results.push({ userId: c.userId, email: c.email, attempted: true, applied: false, stale: true, appliedFields });
      }
    } catch (err) {
      candidatesFailed++;
      console.error(`[revenueCatHistoricalReconciliation] atomic apply failed for ${c.email}:`, err);
      results.push({
        userId: c.userId, email: c.email, attempted: true, applied: false, stale: false, appliedFields,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    candidatesWithProposedChanges: results.filter((r) => r.attempted).length,
    candidatesUpdated, candidatesStale, candidatesFailed,
    rcFieldsProposed, planRepairProposed,
    suspectedContaminationCount,
    results,
  };
}
