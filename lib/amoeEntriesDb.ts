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
 * So: this sprint ships dual-write plus an idempotent backfill for history,
 * but the DRAW keeps reading the file as its ONLY source of truth (see
 * lib/giveaway.ts / lib/amoeEntries.ts — unchanged). Switching the draw's
 * read to Postgres is a Sprint 3 item, gated on Don running the backfill in
 * production and confirming a real reconciliation (not just a count match —
 * see AmoeBackfillResult below).
 *
 * PRECISE WORDING (post-Sprint-2 Revision 1 correction): the file is
 * authoritative. A PostgreSQL mirror is ATTEMPTED for every successful
 * submission (`mirrorAmoeEntryToDb`, best-effort, can fail without blocking
 * or losing the real submission) — do not describe this as every submission
 * "landing in both," since a mirror failure means it does not. Any missed
 * mirrors are recoverable via the backfill below, which is why the file
 * write staying primary and unconditional matters.
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
  fileCount:          number;
  dbCount:            number;
  inserted:           number;
  alreadyPresent:     number;
  /** File entries with no matching (email, month) row in Postgres, AFTER the insert attempt. Should be 0 if `verified`. */
  missingInDb:        number;
  /** Postgres rows with no matching (email, month) entry in the file — abnormal; the file should always be a superset. */
  extraInDb:          number;
  /** Same (email, month) key present in both, but firstName/lastName/submittedAt differ — a genuine data discrepancy, not just a missing row. */
  fieldMismatchCount: number;
  /** True only when the datasets actually reconcile by key AND field content — not just a count match, which two different sets of the same SIZE would satisfy without actually being the same data. */
  verified:           boolean;
}

function entryKey(e: { email: string; month: string }): string {
  return `${e.email.trim().toLowerCase()}|${e.month}`;
}

function fieldsMatch(a: AmoeEntry, b: AmoeEntry): boolean {
  return a.firstName === b.firstName && a.lastName === b.lastName && a.submittedAt === b.submittedAt;
}

/**
 * Post-Sprint-2 Revision 1 fix — idempotent, concurrency-safe backfill with
 * REAL reconciliation, not just a count comparison.
 *
 * Two independent problems in the original version, both fixed here:
 *
 * 1. `fileCount === dbCountAfter` proved nothing about whether the two
 *    datasets actually contained the SAME entries — two sets of equal size
 *    could differ entirely and still "pass." Now reconciles by the actual
 *    (email, month) key, plus the entry's other fields, and reports exactly
 *    what's missing/extra/mismatched, not just whether the totals happen to
 *    agree.
 * 2. The original `findUnique` then `create` per entry was a genuine race
 *    for concurrent or overlapping invocations — two backfill runs (or a
 *    retry racing an in-flight run) could both see "missing" for the same
 *    entry and both attempt to create it, throwing on the second. Replaced
 *    with a single `createMany({ skipDuplicates: true })` batch insert,
 *    which Postgres executes as one atomic `INSERT ... ON CONFLICT DO
 *    NOTHING` — safe for concurrent or repeated invocation by construction,
 *    not by careful sequencing in application code.
 */
export async function backfillAmoeEntries(entries: AmoeEntry[]): Promise<AmoeBackfillResult> {
  const dbBefore = await prisma.amoeEntry.findMany();
  const dbBeforeByKey = new Map(dbBefore.map((e) => [entryKey(e), e]));

  const missing: AmoeEntry[] = [];
  let fieldMismatchCount = 0;
  for (const entry of entries) {
    const existing = dbBeforeByKey.get(entryKey(entry));
    if (!existing) { missing.push(entry); continue; }
    if (!fieldsMatch(entry, existing)) fieldMismatchCount++;
  }

  const { count: inserted } = missing.length
    ? await prisma.amoeEntry.createMany({ data: missing, skipDuplicates: true })
    : { count: 0 };

  const dbAfter = await prisma.amoeEntry.findMany();
  const dbAfterByKey = new Map(dbAfter.map((e) => [entryKey(e), e]));
  const fileKeys = new Set(entries.map(entryKey));

  const missingInDb = entries.filter((e) => !dbAfterByKey.has(entryKey(e))).length;
  const extraInDb   = dbAfter.filter((e) => !fileKeys.has(entryKey(e))).length;

  return {
    fileCount:      entries.length,
    dbCount:        dbAfter.length,
    inserted,
    alreadyPresent: entries.length - missing.length,
    missingInDb,
    extraInDb,
    fieldMismatchCount,
    verified: missingInDb === 0 && extraInDb === 0 && fieldMismatchCount === 0,
  };
}
