/**
 * GET  /api/admin/revenuecat-historical-reconciliation — DRY-RUN report only.
 * POST /api/admin/revenuecat-historical-reconciliation { confirm: true, reportHash: "<from GET>" }
 *   — apply the dry-run's proposed changes, but ONLY if the live proposal
 *     still matches exactly what was reviewed.
 *
 * Post-Sprint-2 Revision 7 — see lib/revenueCatHistoricalReconciliation.ts
 * for the full design rationale. Summary: before this hardening sprint's
 * provenance fix, RevenueCat grants wrote into `stripeInterval`
 * (Stripe/gift-only provenance), and RevenueCat revokes downgraded `plan`
 * without ever clearing `stripeInterval` — so an existing production row
 * may have an unexplained `stripeInterval` value, a stale `plan='free'`
 * despite a surviving entitlement, or both.
 *
 * GET runs a live, read-only RevenueCat lookup (v2 API, production-only,
 * paginated — see lib/revenueCatApi.ts, cannot create a RevenueCat
 * customer) and, where relevant, read-only Stripe checks (lib/stripeEvidence.ts)
 * for every candidate. Makes ZERO writes to GasCap's database or to
 * RevenueCat. Returns a deterministic `reportHash` over every candidate's
 * precondition and proposed mutation.
 *
 * POST requires `{ confirm: true, reportHash: "<the GET response's reportHash>" }`.
 * It recomputes the dry run live and compares hashes — if provider state
 * changed since the report was reviewed (or anything else changed the
 * proposal), it returns 409 and applies NOTHING. Only on an exact hash
 * match does it apply, atomically per candidate (with an additional
 * per-candidate optimistic-concurrency check at write time) — see
 * `applyReconciliation`'s doc comment for exactly which candidates qualify.
 * It NEVER touches a candidate still classified
 * `ambiguous_legacy_provenance`, NEVER downgrades anyone's plan, and — as
 * of Revision 7 — NEVER clears `stripeInterval`. Suspected legacy
 * `stripeInterval` contamination is reported (`suspectedLegacyStripeIntervalContamination`
 * on each candidate) for MANUAL review only; this bulk endpoint cannot act
 * on it. See `lib/revenueCatHistoricalReconciliation.ts`'s module doc
 * comment for why: Stripe's Search API is documented as eventually
 * consistent, and this repository can only prove today's Checkout code
 * writes the metadata this tool correlates on — not every historical sale.
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

  let body: { confirm?: boolean; reportHash?: string };
  try {
    body = await req.json() as { confirm?: boolean; reportHash?: string };
  } catch {
    body = {};
  }
  if (body.confirm !== true || typeof body.reportHash !== 'string' || !body.reportHash) {
    return NextResponse.json(
      {
        error: 'Explicit confirmation required — POST { "confirm": true, "reportHash": "<the reportHash from the GET response you reviewed>" } after reviewing the GET dry-run report.',
      },
      { status: 400 },
    );
  }

  const report = await buildDryRunReport();

  if (report.reportHash !== body.reportHash) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Reconciliation report changed. Run/review GET again.',
        reviewedHash: body.reportHash,
        currentHash: report.reportHash,
      },
      { status: 409 },
    );
  }

  const result = await applyReconciliation(report);

  await logAdminActionFor(identity, 'revenuecat.historical_reconciliation_apply', {
    targetType: 'User', success: true,
    metadata: {
      reportHash: report.reportHash,
      totalCandidates: report.totalCandidates,
      ambiguousCount:  report.ambiguousCount,
      historicalPlanInconsistencyCount: report.historicalPlanInconsistencyCount,
      ...result,
    },
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    reportHash: report.reportHash,
    totalCandidates: report.totalCandidates,
    ambiguousCount:  report.ambiguousCount,
    ...result,
    message: `${result.candidatesUpdated}/${result.candidatesWithProposedChanges} candidates with proposed changes updated atomically (${result.candidatesFailed} failed, ${result.candidatesStale} stale — their row changed since the report was built and were left untouched). RC field backfills: ${result.rcFieldsProposed}. Plan repairs: ${result.planRepairProposed}. This bulk apply NEVER clears stripeInterval — ${result.suspectedContaminationCount} candidate(s) are flagged suspectedLegacyStripeIntervalContamination for MANUAL review only, not touched by this operation. ${report.ambiguousCount} candidate(s) remain ambiguous and were left completely untouched.`,
  });
}
