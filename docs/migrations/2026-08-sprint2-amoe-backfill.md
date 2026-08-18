# AMOE entries: file → Postgres migration

**Status: STAGED — dual-write live, backfill built, read-path cutover NOT
done.** Sprint 2, 2026-08-19.

---

## What shipped this sprint

- `AmoeEntry` Prisma table (additive, in `docs/migrations/2026-08-sprint2-schema.sql`).
- **Dual-write.** `POST /api/amoe` writes the file exactly as before
  (unconditional, primary) and now also mirrors to Postgres (best-effort,
  never blocks or fails the real submission — see `lib/amoeEntriesDb.ts`).
  Every entry submitted from this deploy onward lands in both places.
- **Idempotent backfill**, exposed as `POST /api/admin/amoe-backfill`
  (admin-authenticated, audit-logged). Reads the file, upserts each entry
  into Postgres by `(email, month)`, and reports `fileCount` /
  `dbCountBefore` / `dbCountAfter` / `inserted` / `alreadyPresent`.

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
3. **Check the response.** `verified: true` means `fileCount === dbCountAfter`
   — every file entry is now in Postgres. If `verified: false`, **stop** and
   investigate before doing anything else; do not proceed to step 4.
4. **Spot-check a few entries** in Postgres against the file directly, for
   peace of mind beyond the count match.
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
