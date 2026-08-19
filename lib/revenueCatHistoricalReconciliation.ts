/**
 * Post-Revision-2 fix — historical RevenueCat entitlement reconciliation.
 *
 * THE PROBLEM: before this hardening sprint's provenance fix, every
 * RevenueCat grant wrote `interval` into `stripeInterval` (the same field
 * genuine Stripe/gift purchases use), and the new `revenueCatActive`/
 * `revenueCatInterval` columns didn't exist yet. That means:
 *
 *   1. An existing user's `stripeInterval === 'lifetime'` (or 'monthly')
 *      might be genuine Stripe/gift provenance, OR might be a
 *      RevenueCat-originated value from the old bug — the column alone
 *      cannot tell you which.
 *   2. Every existing row defaults `revenueCatActive = false`,
 *      `revenueCatInterval = null` on migration — which is not necessarily
 *      true. A currently-active RevenueCat customer's real state is not
 *      reflected until this backfill runs.
 *
 * Getting this wrong in either direction is a real risk: treating a
 * genuine Stripe/gift Lifetime purchaser as "unconfirmed RC" and someday
 * stripping it would revoke access from a paying customer; conversely,
 * blindly trusting every ambiguous `stripeInterval` value as Stripe
 * provenance forever means an actual active RevenueCat customer is
 * invisible to `resolveUserEntitlements()`'s RC-specific checks (though
 * NOT at risk of wrongful downgrade — the provenance fix means an RC
 * event can only affect `revenueCatActive`/`revenueCatInterval`, never
 * `stripeInterval`, so an unclassified legacy row is inert, not dangerous,
 * until this backfill actually runs).
 *
 * DESIGN: classification is done from evidence ALREADY IN GASCAP'S DATABASE
 * first (Stripe subscription/customer ids, a matching redeemed Gift record,
 * the ambassador flag) — these are used to CONFIRM non-RC provenance with
 * no external dependency. Only pull in authoritative RevenueCat state (via
 * `lib/revenueCatApi.ts`, RC's real subscriber-info REST endpoint) for
 * candidates that remain genuinely ambiguous after internal evidence is
 * exhausted — see `reconcileHistoricalEntitlements()`.
 *
 * NEVER AUTOMATICALLY DOWNGRADES OR ERASES ANYTHING. This module only ever
 * proposes ADDING `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId`
 * to a row for a candidate RevenueCat CONFIRMS is currently active. A
 * candidate RC does not recognize, or that the live lookup couldn't reach,
 * is left completely untouched and reported as still-ambiguous — never
 * assumed to be "not RC" and never used to justify removing anything.
 */

import { prisma } from '@/lib/prisma';
import { fetchRevenueCatSubscriberInfo, type RevenueCatSubscriberInfo } from '@/lib/revenueCatApi';

export type ProvenanceClassification =
  | 'confirmed_stripe_subscription'   // real stripeSubscriptionId — an active Stripe sub
  | 'confirmed_stripe_lifetime'       // stripeCustomerId present, no subscription (one-time payment), no gift record — genuine Stripe Lifetime purchase pattern
  | 'confirmed_gifted_lifetime'       // a redeemed Gift record names this user
  | 'confirmed_ambassador'            // ambassadorProForLife — GasCap-internal grant, no provider involved
  | 'confirmed_active_rc_monthly'     // RC API confirms an active monthly entitlement
  | 'confirmed_active_rc_lifetime'    // RC API confirms an active lifetime (non-consumable) entitlement
  | 'multiple_legitimate_sources'     // more than one of the above confirmed sources apply
  | 'ambiguous_legacy_provenance';    // no internal evidence, and RC lookup unavailable/inconclusive — DO NOT TOUCH

export interface ReconciliationCandidate {
  userId:                      string;
  email:                       string;
  plan:                        string;
  stripeInterval:              string | null;
  stripeSubscriptionId:        string | null;
  stripeCustomerId:            string | null;
  ambassadorProForLife:        boolean;
  hasRedeemedGift:             boolean;
  classification:              ProvenanceClassification;
  /** Proposed value — null means "propose no change to this field." Never populated for an ambiguous candidate. */
  proposedRevenueCatActive:    boolean | null;
  proposedRevenueCatInterval:  string | null;
  proposedRevenueCatProductId: string | null;
  reason:                      string;
}

interface ClassifyInput {
  stripeInterval:       string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId:     string | null;
  ambassadorProForLife: boolean;
  hasRedeemedGift:       boolean;
  rc:                    RevenueCatSubscriberInfo | null; // null = not looked up / lookup failed / RC has no record
}

/**
 * Pure classification from evidence for a single user. No I/O — callers
 * gather the evidence (including an optional live RC lookup) first.
 */
export function classifyProvenance(input: ClassifyInput): {
  classification: ProvenanceClassification;
  proposedRevenueCatActive: boolean | null;
  proposedRevenueCatInterval: string | null;
  proposedRevenueCatProductId: string | null;
  reason: string;
} {
  const confirmedSources: ProvenanceClassification[] = [];
  if (input.ambassadorProForLife) confirmedSources.push('confirmed_ambassador');
  if (input.stripeSubscriptionId) confirmedSources.push('confirmed_stripe_subscription');
  if (input.hasRedeemedGift) confirmedSources.push('confirmed_gifted_lifetime');
  // Only counts as confirmed Stripe Lifetime if there's a customer id AND no
  // subscription (a one-time payment pattern) AND it isn't already
  // explained by a gift redemption (a gift ALSO has a Stripe payment behind
  // it, but that's the purchaser's payment, not necessarily this user's).
  if (input.stripeCustomerId && !input.stripeSubscriptionId && !input.hasRedeemedGift && input.stripeInterval === 'lifetime') {
    confirmedSources.push('confirmed_stripe_lifetime');
  }

  const rcActive = input.rc?.active === true;
  if (rcActive && input.rc?.interval === 'lifetime') confirmedSources.push('confirmed_active_rc_lifetime');
  else if (rcActive && input.rc?.interval === 'monthly') confirmedSources.push('confirmed_active_rc_monthly');

  if (confirmedSources.length > 1) {
    return {
      classification: 'multiple_legitimate_sources',
      // Propose the RC fields only — non-RC provenance fields are never
      // touched by this module.
      proposedRevenueCatActive:    rcActive ? true : null,
      proposedRevenueCatInterval:  rcActive ? (input.rc!.interval ?? null) : null,
      proposedRevenueCatProductId: rcActive ? (input.rc!.productId ?? null) : null,
      reason: `Multiple confirmed sources: ${confirmedSources.join(', ')}.`,
    };
  }

  if (confirmedSources.length === 1) {
    const only = confirmedSources[0];
    return {
      classification: only,
      proposedRevenueCatActive:    only.startsWith('confirmed_active_rc') ? true : null,
      proposedRevenueCatInterval:  only === 'confirmed_active_rc_lifetime' ? 'lifetime' : only === 'confirmed_active_rc_monthly' ? 'monthly' : null,
      proposedRevenueCatProductId: only.startsWith('confirmed_active_rc') ? (input.rc?.productId ?? null) : null,
      reason: `Confirmed via: ${only}.`,
    };
  }

  // No internal evidence, and either no RC lookup was performed, the
  // lookup failed, or RC has no record for this user. DO NOT PROPOSE
  // ANYTHING — this is exactly the case the brief says must not be guessed.
  return {
    classification: 'ambiguous_legacy_provenance',
    proposedRevenueCatActive:    null,
    proposedRevenueCatInterval:  null,
    proposedRevenueCatProductId: null,
    reason: input.rc === null
      ? 'No corroborating Stripe/gift/ambassador evidence in GasCap\'s database, and no RevenueCat lookup was available/configured to confirm or rule out an active RC entitlement. Left untouched.'
      : 'No corroborating Stripe/gift/ambassador evidence, and RevenueCat has no active entitlement on record for this identity either. Left untouched rather than assumed free — this stripeInterval value\'s original source cannot be confirmed from available evidence.',
  };
}

export interface DryRunReport {
  totalCandidates:    number;
  classifications:    Record<ProvenanceClassification, number>;
  ambiguousCount:     number;
  rcLookupConfigured: boolean;
  rcLookupAttempted:  number;
  rcLookupFailed:     number;
  candidates:         ReconciliationCandidate[];
}

/**
 * Build the dry-run classification report. READ-ONLY — makes zero writes to
 * GasCap's database. May make live read-only calls to RevenueCat's
 * subscriber-info API (if `REVENUECAT_SECRET_API_KEY` is configured) but
 * never anything else.
 *
 * Scope: every user with `plan IN ('pro', 'fleet')` whose current
 * `stripeInterval` is set (there's something to classify) — this
 * necessarily includes users with fully legitimate, unambiguous Stripe/gift
 * provenance; those are classified as such quickly, and only the genuinely
 * ambiguous remainder needs the RC lookup or human attention.
 */
export async function buildDryRunReport(): Promise<DryRunReport> {
  const [users, redeemedGifts] = await Promise.all([
    prisma.user.findMany({
      where: { plan: { in: ['pro', 'fleet'] }, stripeInterval: { not: null } },
      select: {
        id: true, email: true, plan: true,
        stripeInterval: true, stripeSubscriptionId: true, stripeCustomerId: true,
        ambassadorProForLife: true,
      },
    }),
    prisma.gift.findMany({
      where: { redeemedByUserId: { not: null }, status: { in: ['paid', 'redeemed'] } },
      select: { redeemedByUserId: true },
    }),
  ]);
  const giftedUserIds = new Set(redeemedGifts.map((g) => g.redeemedByUserId).filter((v): v is string => !!v));

  const rcConfigured = !!process.env.REVENUECAT_SECRET_API_KEY;
  const candidates: ReconciliationCandidate[] = [];
  let rcAttempted = 0;
  let rcFailed = 0;

  for (const u of users) {
    const hasRedeemedGift = giftedUserIds.has(u.id);
    // Only bother with a live RC lookup if internal evidence alone won't
    // already confirm this user — no point spending an API call on someone
    // already explained by a Stripe subscription, a gift, or Ambassador.
    const internalEvidenceExists = !!u.stripeSubscriptionId || hasRedeemedGift || u.ambassadorProForLife
      || (!!u.stripeCustomerId && !u.stripeSubscriptionId && !hasRedeemedGift && u.stripeInterval === 'lifetime');

    let rc: RevenueCatSubscriberInfo | null = null;
    if (!internalEvidenceExists && rcConfigured) {
      rcAttempted++;
      try {
        rc = await fetchRevenueCatSubscriberInfo(u.id);
      } catch (err) {
        rcFailed++;
        console.error(`[revenueCatHistoricalReconciliation] RC lookup failed for ${u.email}:`, err);
        rc = null; // failure => ambiguous, never guessed
      }
    }

    const result = classifyProvenance({
      stripeInterval:       u.stripeInterval,
      stripeSubscriptionId: u.stripeSubscriptionId,
      stripeCustomerId:     u.stripeCustomerId,
      ambassadorProForLife: u.ambassadorProForLife,
      hasRedeemedGift,
      rc,
    });

    candidates.push({
      userId: u.id, email: u.email, plan: u.plan,
      stripeInterval: u.stripeInterval, stripeSubscriptionId: u.stripeSubscriptionId, stripeCustomerId: u.stripeCustomerId,
      ambassadorProForLife: u.ambassadorProForLife, hasRedeemedGift,
      classification: result.classification,
      proposedRevenueCatActive:    result.proposedRevenueCatActive,
      proposedRevenueCatInterval:  result.proposedRevenueCatInterval,
      proposedRevenueCatProductId: result.proposedRevenueCatProductId,
      reason: result.reason,
    });
  }

  const classifications = {} as Record<ProvenanceClassification, number>;
  for (const c of candidates) classifications[c.classification] = (classifications[c.classification] ?? 0) + 1;

  return {
    totalCandidates: candidates.length,
    classifications,
    ambiguousCount: candidates.filter((c) => c.classification === 'ambiguous_legacy_provenance').length,
    rcLookupConfigured: rcConfigured,
    rcLookupAttempted: rcAttempted,
    rcLookupFailed: rcFailed,
    candidates,
  };
}

export interface BackfillResult {
  attempted: number;
  updated:   number;
  skipped:   number;
}

/**
 * Apply the proposed RC field changes — ONLY for candidates whose
 * classification confirms an active RevenueCat entitlement
 * ('confirmed_active_rc_monthly' / 'confirmed_active_rc_lifetime' /
 * 'multiple_legitimate_sources' with a proposed RC value). Every other
 * classification is skipped, including 'ambiguous_legacy_provenance' —
 * this function NEVER downgrades, clears, or guesses; it only ever ADDS
 * confirmed RC provenance to a row that doesn't have it yet.
 *
 * Must be called with a report already produced by `buildDryRunReport()` —
 * this function does not re-run classification, so the caller is
 * responsible for having reviewed the dry-run output first (the whole
 * point of the two-step design: approval happens against the dry-run
 * report's content, not blindly against "whatever the code decides right
 * now").
 */
export async function applyReconciliation(report: DryRunReport): Promise<BackfillResult> {
  let updated = 0;
  let skipped = 0;
  const toApply = report.candidates.filter((c) => c.proposedRevenueCatActive === true);
  for (const c of toApply) {
    try {
      await prisma.user.update({
        where: { id: c.userId },
        data: {
          revenueCatActive:    true,
          revenueCatInterval:  c.proposedRevenueCatInterval,
          revenueCatProductId: c.proposedRevenueCatProductId,
        },
      });
      updated++;
    } catch (err) {
      console.error(`[revenueCatHistoricalReconciliation] backfill write failed for ${c.email}:`, err);
      skipped++;
    }
  }
  return { attempted: toApply.length, updated, skipped };
}
