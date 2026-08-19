/**
 * GET  /api/admin/revenuecat-historical-reconciliation — DRY-RUN report only.
 * POST /api/admin/revenuecat-historical-reconciliation { confirm: true }
 *   — apply the dry-run's proposed changes (ADDITIVE ONLY, see below).
 *
 * Post-Revision-2 addition — see lib/revenueCatHistoricalReconciliation.ts
 * for the full design rationale. Summary: before this hardening sprint's
 * provenance fix, RevenueCat grants wrote into `stripeInterval`
 * (Stripe/gift-only provenance), so an existing production row's
 * `stripeInterval` value may or may not represent a genuine Stripe/gift
 * purchase, and every existing row defaults `revenueCatActive = false`
 * regardless of whether the user is a currently-active RevenueCat customer.
 *
 * GET produces a classification report using evidence already in GasCap's
 * database (Stripe subscription/customer ids, a redeemed Gift record, the
 * ambassador flag), falling back to a live, read-only RevenueCat subscriber
 * lookup only for candidates that remain ambiguous after that — and makes
 * ZERO writes.
 *
 * POST applies ONLY the dry-run's proposed additions — populating
 * `revenueCatActive`/`revenueCatInterval`/`revenueCatProductId` for
 * candidates RevenueCat (or unambiguous internal evidence) CONFIRMS are
 * currently active. It NEVER clears, downgrades, or overwrites
 * `stripeInterval` or any other provenance field, and it NEVER touches a
 * candidate still classified `ambiguous_legacy_provenance` — those are
 * left exactly as they are, reported, and require separate manual review.
 *
 * Requires an explicit `{ confirm: true }` body — a bare POST with no body
 * is rejected, so applying this can't happen by accident (e.g. a
 * copy-pasted curl command missing its body).
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
      attempted:       result.attempted,
      updated:         result.updated,
      skipped:         result.skipped,
    },
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    totalCandidates: report.totalCandidates,
    ambiguousCount:  report.ambiguousCount,
    ...result,
    message: `Applied ${result.updated} confirmed-active-RC update(s). ${report.ambiguousCount} candidate(s) remain ambiguous and were left untouched — see the dry-run report for details.`,
  });
}
