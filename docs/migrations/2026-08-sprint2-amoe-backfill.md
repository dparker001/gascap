# AMOE entries: file → Postgres migration

**Status: STAGED — file authoritative, Postgres mirror attempted per
submission, backfill built with real reconciliation, read-path cutover NOT
done.** Sprint 2, 2026-08-18. Revised 2026-08-18 (Revision 1, independent
review) — corrected the "lands in both" wording below and strengthened the
backfill's verification; see the revision packet in `docs/reviews/`.

---

## What shipped this sprint

- `AmoeEntry` Prisma table (additive, in `docs/migrations/2026-08-sprint2-schema.sql`).
- **The file is authoritative. A PostgreSQL mirror is ATTEMPTED for every
  successful submission**, not guaranteed. `POST /api/amoe` writes the file
  exactly as before (unconditional, primary) and then attempts a best-effort
  mirror to Postgres — see `lib/amoeEntriesDb.ts`'s `mirrorAmoeEntryToDb`.
  That mirror can fail (a transient Postgres error, for example) without
  blocking or failing the real submission, which is the entire point of
  keeping the file primary — but it means NOT every submission actually
  lands in both places, only every submission for which the mirror
  succeeded. **Any missed mirrors are recoverable by re-running the
  backfill below**, which is why this distinction matters operationally,
  not just as a wording nitpick.
- **Idempotent, concurrency-safe backfill**, exposed as
  `POST /api/admin/amoe-backfill` (admin-authenticated, audit-logged). Reads
  the file, inserts missing entries into Postgres via a single atomic
  `createMany({ skipDuplicates: true })` batch (not a per-row
  read-then-write race), and reconciles by `(email, month)` key **plus**
  field content — not just a count comparison, which two differently-composed
  sets of the same size would satisfy without containing the same entries.
  Reports `fileCount` / `dbCount` / `inserted` / `alreadyPresent` /
  `missingInDb` / `extraInDb` / `fieldMismatchCount` / `verified`.

## What did NOT ship — and why

**The draw's read path (`lib/giveaway.ts` → `lib/amoeEntries.ts`) still
reads the file.** Not Postgres. This was a deliberate scope decision, not an
oversight:

This development environment cannot read the production Railway volume.
`railway run` executes **locally** against the production database over the
network — but the volume holding `data/amoe-entries.json` is only mounted
inside the actual running container. There was no way to confirm the real
production row count before writing this code, and the sprint brief was
explicit that AMOE migration requires verifying "every existing entry" is
preserved before anything changes. Claiming that without being able to check
it would be worse than not finishing the migration.

## Required steps before the read-path cutover (Sprint 3, or sooner if desired)

1. **Deploy this sprint's code.** Dual-write starts immediately; no entries
   are at risk in the meantime — the file write is unchanged and primary.
2. **Run the backfill**, authenticated as admin:
   ```bash
   curl -X POST https://www.gascap.app/api/admin/amoe-backfill \
     -H "x-admin-password: $ADMIN_PASSWORD"
   ```
   (Or via a signed-in admin session — no header needed once Don's `role`
   backfill from this sprint's admin-auth migration is applied.)
3. **Check the response.** `verified: true` means the file and database
   fully reconcile by `(email, month)` key AND field content — not merely a
   count match. If `verified: false`, check `missingInDb` / `extraInDb` /
   `fieldMismatchCount` to see exactly what's wrong, and **stop** —
   investigate before doing anything else; do not proceed to step 4.
4. **Spot-check a few entries** in Postgres against the file directly, for
   peace of mind beyond the automated reconciliation.
5. Only then: switch `lib/amoeEntries.ts`'s read functions (or
   `lib/giveaway.ts`'s call site) to query `AmoeEntry` instead of the file.
   Small, mechanical change once steps 1–4 are done — add a regression test
   asserting free entrants still appear in `getEligibleEntrants()`'s output
   before merging that change.
6. **Do not delete `data/amoe-entries.json`** even after the read-path
   cutover. Per the brief: retire it only after Don explicitly approves,
   with the verified counts as the record of why it's safe.

## Rollback

Every step above is additive and reversible up through step 4. Step 5 (the
read-path switch) is the only step that changes live behavior — if it's ever
wrong, reverting the one call site back to the file functions is a one-line
change, and the file will still contain every entry since dual-write never
stopped writing to it.
