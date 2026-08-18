/**
 * POST /api/admin/amoe-backfill
 *
 * Sprint 2 hardening — one-time (but safely repeatable) import of every
 * historical AMOE entry from data/amoe-entries.json into the AmoeEntry
 * Postgres table. See lib/amoeEntriesDb.ts for why this is staged rather
 * than an automatic cutover: production's real file row count could not be
 * verified from the development environment this was written in.
 *
 * READS data/amoe-entries.json. WRITES to the AmoeEntry table via an atomic
 * `createMany({ skipDuplicates: true })` batch insert — additive only, never
 * deletes, never overwrites an existing row's content, safe for concurrent
 * or repeated invocation (Postgres executes it as one `INSERT ... ON
 * CONFLICT DO NOTHING`, not a per-row read-then-write race).
 *
 * Run this from the RUNNING PRODUCTION APP (this endpoint, deployed) rather
 * than a local script — the file only exists on the Railway volume, which is
 * only reachable from inside the container.
 *
 * Post-Sprint-2 Revision 1: verification is a REAL reconciliation by
 * (email, month) key plus field content — not just `fileCount === dbCount`,
 * which two differently-composed sets of the same size would satisfy
 * without containing the same entries. See `verified` /
 * `missingInDb` / `extraInDb` / `fieldMismatchCount` in the response — Don
 * should confirm `verified: true` before treating the migration as
 * confirmed. Per the sprint brief: do NOT delete amoe-entries.json until
 * that's true.
 */
import { NextResponse } from 'next/server';
import { readAmoeEntries } from '@/lib/amoeEntries';
import { backfillAmoeEntries } from '@/lib/amoeEntriesDb';
import { requireAdmin } from '@/lib/adminAuth';
import { logAdminActionFor } from '@/lib/adminAudit';

export async function POST(req: Request) {
  const identity = await requireAdmin(req);
  if (!identity.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: identity.status });

  let entries;
  try {
    entries = readAmoeEntries();
  } catch (err) {
    return NextResponse.json({ error: `Could not read AMOE entries file: ${(err as Error).message}` }, { status: 500 });
  }

  const result = await backfillAmoeEntries(entries);

  await logAdminActionFor(identity, 'amoe.backfill', {
    targetType: 'AmoeEntry', success: true,
    metadata: { ...result },
  });

  return NextResponse.json({
    ok: true,
    ...result,
    message: result.verified
      ? 'File and database fully reconcile by key and field content. Safe to consider the file backed up.'
      : `MISMATCH — missingInDb=${result.missingInDb}, extraInDb=${result.extraInDb}, fieldMismatchCount=${result.fieldMismatchCount}. Do not retire the file yet; investigate before re-running.`,
  });
}
