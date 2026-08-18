/**
 * Sprint 2 hardening — Postgres-backed AMOE entries, STAGED alongside the
 * existing file store rather than replacing it this sprint.
 *
 * Why staged instead of cut over: this environment cannot read the
 * production Railway volume (`railway run` executes locally against the
 * database over the network, but the volume is only mounted inside the
 * actual running container — established in Sprint 1). That means the real
 * production row count in `data/amoe-entries.json` could not be verified
 * from here before writing this code. The sprint brief is explicit that
 * AMOE migration requires "preserve every existing entry... backfill must be
 * idempotent... allow rollback or verification before the old file is
 * retired" — none of which can be honestly claimed satisfied without seeing
 * real counts.
 *
 * So: this sprint ships dual-write (every new submission lands in BOTH the
 * file and Postgres, from the moment this deploys) plus an idempotent
 * backfill for history, but the DRAW keeps reading the file as its source of
 * truth (see lib/giveaway.ts / lib/amoeEntries.ts — unchanged). Switching the
 * draw's read to Postgres is a Sprint 3 item, gated on Don running the
 * backfill in production and confirming the row count matches the file.
 *
 * This is a smaller, safer migration than the brief's ideal end state, named
 * explicitly rather than silently shipped as "done" — see
 * docs/migrations/2026-08-sprint2-amoe-backfill.md.
 */

import { prisma } from '@/lib/prisma';
import type { AmoeEntry } from '@/lib/amoeEntries';

/**
 * Best-effort mirror write. Never throws — a Postgres hiccup must not block
 * a real sweepstakes submission, which is why the file write in
 * app/api/amoe/route.ts stays primary and unconditional.
 */
export async function mirrorAmoeEntryToDb(entry: AmoeEntry): Promise<void> {
  try {
    await prisma.amoeEntry.upsert({
      where:  { email_month: { email: entry.email, month: entry.month } },
      create: entry,
      update: {}, // first-write-wins; the file's own one-per-month rule already prevents a real second submission
    });
  } catch (err) {
    console.error('[amoeEntriesDb] mirror write failed (file write still succeeded, entry is not lost):', err);
  }
}

export interface AmoeBackfillResult {
  fileCount:      number;
  dbCountBefore:  number;
  dbCountAfter:   number;
  inserted:       number;
  alreadyPresent: number;
}

/**
 * Idempotent backfill: read every entry the caller provides (from the file,
 * via readAmoeEntries()) and upsert each into Postgres. Safe to run multiple
 * times — a re-run inserts nothing new and reports inserted:0.
 *
 * Verification is the return value, not a side effect: the caller (the admin
 * backfill endpoint) is responsible for surfacing fileCount vs dbCountAfter
 * to Don so a mismatch is visible before anyone considers the file retired.
 */
export async function backfillAmoeEntries(entries: AmoeEntry[]): Promise<AmoeBackfillResult> {
  const dbCountBefore = await prisma.amoeEntry.count();

  let inserted = 0;
  let alreadyPresent = 0;
  for (const entry of entries) {
    const before = await prisma.amoeEntry.findUnique({
      where: { email_month: { email: entry.email, month: entry.month } },
    });
    if (before) { alreadyPresent++; continue; }
    await prisma.amoeEntry.create({ data: entry });
    inserted++;
  }

  const dbCountAfter = await prisma.amoeEntry.count();
  return { fileCount: entries.length, dbCountBefore, dbCountAfter, inserted, alreadyPresent };
}
