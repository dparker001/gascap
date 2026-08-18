/**
 * POST /api/admin/amoe-backfill
 *
 * Sprint 2 hardening — one-time (but safely repeatable) import of every
 * historical AMOE entry from data/amoe-entries.json into the AmoeEntry
 * Postgres table. See lib/amoeEntriesDb.ts for why this is staged rather
 * than an automatic cutover: production's real file row count could not be
 * verified from the development environment this was written in.
 *
 * READS data/amoe-entries.json. WRITES to the AmoeEntry table (additive
 * upserts only — never deletes, never overwrites an existing row's content).
 *
 * Run this from the RUNNING PRODUCTION APP (this endpoint, deployed) rather
 * than a local script — the file only exists on the Railway volume, which is
 * only reachable from inside the container.
 *
 * Response reports fileCount / dbCountBefore / dbCountAfter / inserted /
 * alreadyPresent — Don should confirm dbCountAfter === fileCount before
 * treating the migration as verified. Per the sprint brief: do NOT delete
 * amoe-entries.json until that match is confirmed.
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
    metadata: { ...result, matched: result.fileCount === result.dbCountAfter },
  });

  return NextResponse.json({
    ok: true,
    ...result,
    verified: result.fileCount === result.dbCountAfter,
    message: result.fileCount === result.dbCountAfter
      ? 'File and database counts match. Safe to consider the file backed up.'
      : 'MISMATCH — file and database counts differ. Do not retire the file yet; investigate before re-running.',
  });
}
