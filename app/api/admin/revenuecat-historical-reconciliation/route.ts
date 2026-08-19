/**
 * GET  /api/admin/revenuecat-historical-reconciliation — DRY-RUN report only.
 * POST /api/admin/revenuecat-historical-reconciliation { confirm: true }
 *   — apply the dry-run's proposed changes.
 *
 * Post-Sprint-2 Revision 4 — see lib/revenueCatHistoricalReconciliation.ts
 * for the full design rationale. Summary: before this hardening sprint's
 * provenance fix, RevenueCat grants wrote into `stripeInterval`
 * (Stripe/gift-only provenance), and RevenueCat revokes downgraded `plan`
 * without ever clearing `stripeInterval` — so an existing production row
 * may have an unexplained `stripeInterval` value, a stale `plan='free'`
 * despite a surviving entitlement, or both.
 *
 * GET runs a live, read-only RevenueCat lookup (v2 API — cannot create a
 * RevenueCat customer, see lib/revenueCatApi.ts) and, where relevant, a
 * read-only Stripe Checkout Session check (lib/stripeEvidence.ts) for
 * EVERY candidate — not just ones lacking internal evidence, since GasCap
 * supports simultaneous entitlement sources. Makes ZERO writes to GasCap's
 * database or to RevenueCat.
 *
 * POST applies three independent, additive-only operations — see
 * `applyReconciliation`'s doc comment for exactly which candidates qualify
 * for each. It NEVER touches a candidate still classified
 * `ambiguous_legacy_provenance`, and NEVER downgrades anyone's plan.
 *
 * Requires an explicit `{ confirm: true }` body — a bare POST with no body
 * is rejected, so applying this can't happen by accident.
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminActionFor } from '@/lib/adminAudit';
import { buildDryRunReport, applyReconciliation } from '@/lib/revenueCatHistoricalReconciliation';

export async function GET(req: Request) {
  const identity = await requireAdmin(req);
  if (!identity.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: identity.status });

  const report = await buildDryRunReport();
  return NextResponse.json({
    ok: true,
    dryRun: true,
    ...report,
  });
}

export async function POST(req: Request) {
  const identity = await requireAdmin(req);
  if (!identity.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: identity.status });

  let body: { confirm?: boolean };
  try {
    body = await req.json() as { confirm?: boolean };
  } catch {
    body = {};
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: 'Explicit confirmation required — POST { "confirm": true } after reviewing the GET dry-run report.' },
      { status: 400 },
    );
  }

  const report = await buildDryRunReport();
  const result = await applyReconciliation(report);

  await logAdminActionFor(identity, 'revenuecat.historical_reconciliation_apply', {
    targetType: 'User', success: true,
    metadata: {
      totalCandidates: report.totalCandidates,
      ambiguousCount:  report.ambiguousCount,
      historicalPlanInconsistencyCount: report.historicalPlanInconsistencyCount,
      ...result,
    },
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    totalCandidates: report.totalCandidates,
    ambiguousCount:  report.ambiguousCount,
    ...result,
    message: `RC field backfill: ${result.rcFieldsUpdated}/${result.rcFieldsAttempted}. Legacy stripeInterval clears: ${result.legacyClearUpdated}/${result.legacyClearAttempted}. Plan repairs: ${result.planRepairUpdated}/${result.planRepairAttempted}. ${report.ambiguousCount} candidate(s) remain ambiguous and were left completely untouched.`,
  });
}
