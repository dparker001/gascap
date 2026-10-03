# ChatGPT Delta Packet — Rental Delete / Orphaned Fillup (review fixes)

Follow-up to `docs/reviews/2026-10-03-rental-delete-fillups.md` (result: PASS WITH TWO REQUIRED CHANGES).

## Repository state
- **Branch:** `fix/rental-delete-fillups` (local, **not pushed**), base `main` @ `2391e19`
- **New Review Target SHA:** `f0a787b` (previous `adbae15`)
- **Delta commits:**
  ```
  f0a787b fix(integrity): orphan rental fill-up check has no creation-date cutoff
  c948cfb fix(rental): delete and refuel serialize on one RentalSession row lock
  ```
- **Delta:** `git diff --name-status 02841d2..f0a787b`
  ```
  M	__tests__/integrityCheckGetawayStalePending.test.ts
  M	__tests__/rentalDeleteFillups.test.ts
  A	__tests__/rentalDeleteRefuelRace.test.ts
  M	__tests__/rentalFillups.test.ts
  M	__tests__/rentalOrphanIntegrity.test.ts
  M	app/api/cron/integrity-check/route.ts
  M	lib/rentalFillups.ts
  M	lib/rentalIntegrity.ts
  A	lib/rentalLock.ts
  M	lib/rentalSessions.ts
  ```
- **Whole branch vs `main`:** 11 files, +776 / −28. No schema, migration, protected path, Help or Part B change.

## Required change 1: delete-vs-refuel race, closed
Verified against the code first: `createRentalFillup()` read the rental (`prisma.rentalSession.findFirst`) **before** its array transaction, and nothing locked the row. With no FK, a delete committing in between left a new orphan. The finding was correct.

**Locking / transaction design.** New `lib/rentalLock.ts`:
```ts
lockOwnedRentalSession(tx, id, userId)
  = tx.$queryRaw`SELECT "id" FROM "RentalSession" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`
  → true if the owned row exists (and is now locked by this transaction)
```
Parameterized tagged template, so nothing is interpolated into the SQL.

**Delete path** (`deleteRentalSession`):
```
$transaction(async tx => {
  lock(id, userId)          → absent: return false (nothing deleted; route 404 unchanged)
  tx.fillup.deleteMany({ userId, rentalSessionId: id })
  tx.rentalSession.deleteMany({ id, userId })
})                          → commit releases the lock
```

**Refuel path** (`createRentalFillup`). Changes made:
- The DB-independent validation stays outside (gallons, type, clientRefuelId, a price signal, price/cost resolution).
- Then:
  ```
  $transaction(async tx => {
    lock(rentalSessionId, userId)  → absent: { not_found }, no Fillup created
    tx.rentalSession.findFirst     (vehicle name/id for the row — now read under the lock)
    final_return pre-check on tx   → { final_return_exists }
    tx.fillup.create(...)
    bumpCurrentFuelGallonsOnCreateSql(tx, …)  (same atomic UPDATE SQL, now on the tx client)
  })
  ```
- **Unchanged:** the unique-constraint / idempotency handling. A P2002 from `tx.fillup.create` aborts and rolls back the transaction, and the existing catch still returns `duplicate` / `final_return_exists` exactly as before. Analytics also still fire only after a successful commit.

**Lock order.** One lock on one row, always the first statement in both transactions, so there is no lock-order inversion between these paths. Under Postgres READ COMMITTED:
- **Refuel first:** the refuel commits its Fillup; the delete, waiting on the lock, then deletes it with the rental.
- **Delete first:** the waiting refuel re-reads after the delete commits, finds no row, returns `not_found`, and creates nothing.

**Concurrency tests:** new `__tests__/rentalDeleteRefuelRace.test.ts` (5 tests).
- **Mock fidelity, stated plainly:** this is not Postgres. `$queryRaw` takes a per-row async mutex held until the interactive transaction ends; after acquiring, it re-reads the row (READ COMMITTED behaviour). Test gates pause one transaction mid-flight so both orderings are deterministic.
- **Delete wins first:** the refuel is blocked (it does nothing while waiting) → `not_found`, 0 Fillups, rental gone.
- **Refuel wins first:** the delete is blocked (the rental still exists) → order `fillup created → fillups deleted:1 → rental deleted`, 0 Fillups, rental gone.
- **Structural:** both functions call the shared `lockOwnedRentalSession(tx, …)` before every Fillup mutation and session read; `createRentalFillup` no longer contains an unlocked `prisma.rentalSession.findFirst`; the lock SQL is the parameterized `FOR UPDATE`.
- **Mutation checks (run, then restored):**
  - removing the lock from **the refuel** fails **both** ordering tests;
  - removing it from **the delete** (replaced with a plain read) also fails **both**.
- **What this proves:** the two code paths serialize on the same lock and behave correctly under each ordering. It does not prove Postgres' locking itself.

**Existing suites moved to the interactive-transaction model; assertions kept:**
- `rentalDeleteFillups.test.ts` (10): the rollback test still proves fill-ups are restored if the rental delete fails. It now also asserts the operation order `lock → fillup.deleteMany → rentalSession.deleteMany`, and for a missing rental only `lock` runs.
- `rentalFillups.test.ts` (39): its `$transaction` mock now supports the callback form (tracked lazy writes, rollback on throw, `$queryRaw` = ownership lock read). All 39, including the rollback-on-session-update-failure and no-lost-update concurrency tests, pass unchanged.

## Required change 2: integrity cutoff removed
- `ORPHAN_CHECK_SINCE` and the `createdSince` option are deleted. `findOrphanRentalFillups()` now returns **every** Fillup with `rentalSessionId != null` whose RentalSession is missing, regardless of creation date. The comment records the rule: optimize the query (anti-join) if it grows, never narrow it.
- `/api/cron/integrity-check` calls `findOrphanRentalFillups()` with no arguments. Finding `orphan-rental-fillups` is still `error`; the sample is Fillup ids only.
- **Tests updated:**
  - a 2025-dated Fillup on a deleted rental is reported;
  - the query's `where` is exactly `{ rentalSessionId: { not: null } }`;
  - source guards assert no `createdSince` / `ORPHAN_CHECK_SINCE` / `createdAt: { gte` remains.
- **Audit context (unchanged):** production has 0 rental-linked Fillups and 0 orphans, so the check is silent unless deletion or the lock regresses.

## Other review decisions: applied as stated
- **Personal list/stats:** unchanged.
- **Historical cleanup:** none needed or done.
- **Help:** unchanged.
- **Existing rollback tests:** kept.

## Validation (at `f0a787b`)
```
npm test          → 2092 passed / 2092 (131 files)
npx tsc --noEmit   → exit 0
npm run build      → exit 0 (PWA artifacts restored/removed; tree clean)
```
- **Focused** (delete, race, refuel, integrity, getaway-integrity, recap, reminder-reset, tank transitions, gauge routes, fuel-confirmation gate, protected-path guard, CR-1): **270/270** across 12 files.

## Remaining limitations
- **Lock semantics are proven by a model, not real Postgres.** A post-deploy check is recommended. A full race can't practically be forced in production, but a sequential check of the three cases each confirms the shipped SQL runs:
  - create a TEST rental, log a fill-up, delete the rental → both gone;
  - log a fill-up on a deleted rental's id → `not_found`;
  - integrity check `?dryRun=true` → no `orphan-rental-fillups` finding.
- **Lock wait:** a delete and a refuel on the same rental now wait for each other, typically milliseconds. Refuels on the same rental were already serialized by Postgres' row lock on the fuel `UPDATE`; the wait is just taken earlier now.
- **Interactive-transaction defaults:** this uses Prisma's interactive `$transaction` default timeouts (maxWait/timeout). Both bodies are a handful of single-row statements, far below the defaults.
- **Other writers that link a Fillup to a rental:** `updateRentalFillup` / `deleteRentalFillup` don't create a link to a different rental, so they're out of scope. Personal fill-up creation never sets `rentalSessionId`.

## Assessment
**READY FOR REVIEW.** Both required changes are made, tested and mutation-checked. Recommend push + PR on Don's go-ahead.
