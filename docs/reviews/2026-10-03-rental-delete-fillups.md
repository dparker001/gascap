# ChatGPT Review Packet — Rental Delete / Orphaned Fillup Integrity

## 1. Objective
Fix the pre-existing Phase 3A defect found in the PR #59 production smoke test. Deleting a rental removed only the `RentalSession`, leaving its canonical `Fillup` rows in the renter's personal fill-up list and stats. Requirements:
- the rental and its Fillups are removed atomically at the application layer, scoped by `userId`;
- existing not-found/ownership behaviour is preserved;
- a read-only historical orphan audit is run;
- the condition is made detectable and testable.

No Part B work, no schema change, no historical data change.

## 2. Repository State
- **Branch:** `fix/rental-delete-fillups` (local, **not pushed**), worktree `/Users/dpark/Projects/gascap-delete-fillups`
- **Base:** `main` @ `2391e19` (the PR #59 merge, in production)
- **Review Target SHA:** `adbae15`
- **Packet Commit SHA:** the next commit (adds this file only)
- **Commits:**
  ```
  adbae15 feat(integrity): detect rental fill-ups orphaned by a deleted rental
  c034c9e fix(rental): deleting a rental also deletes its fill-ups, atomically
  ```
- **Relevant PR:** none

## 3. Root Cause (What I Found)
- **Delete path:** `lib/rentalSessions.ts` `deleteRentalSession()` was a single `prisma.rentalSession.deleteMany({ where: { id, userId } })`.
- **No database link:** since the Phase 3A cutover (`lib/rentalFillups.ts`), each rental refuel is a row in the shared `Fillup` table with a nullable `Fillup.rentalSessionId`. There is only an index, no FK and no cascade (`prisma/schema.prisma`). Nothing removed those rows when their rental was deleted.
- **Where the orphans showed up:** `getFillups(userId)` (`lib/fillups.ts`) filters by `userId` only. So **every** rental-linked Fillup, orphaned or not, appears in `/api/fillups` (personal list) and in `getFillupStats()` (stats). The existing-fill-up count in the `/api/fillups` POST path (route line ~55) comes from the same list.
- **Help:** "deleting is permanent and takes that rental's fuel records and photos with it". Photos were already true (they live on the `RentalSession` row); fuel records were false since Phase 3A.

## 4. What I Changed
**`lib/rentalSessions.ts` — `deleteRentalSession(userId, id)`:**
```ts
const owned = await prisma.rentalSession.findFirst({ where: { id, userId }, select: { id: true } });
if (!owned) return false;                       // missing / not owned: nothing deleted, 404 unchanged
const [, rentalDelete] = await prisma.$transaction([
  prisma.fillup.deleteMany({ where: { userId, rentalSessionId: id } }),
  prisma.rentalSession.deleteMany({ where: { id, userId } }),
]);
return rentalDelete.count > 0;
```

**`lib/rentalIntegrity.ts` (new, read-only):**
- `findOrphanRentalFillups({ createdSince? })` — two selects, never writes;
- pure `orphanRentalFillups()`;
- aggregate-only `summarizeOrphans()`;
- `ORPHAN_CHECK_SINCE = '2026-10-03T00:00:00.000Z'`.

**`app/api/cron/integrity-check/route.ts`:** new `orphan-rental-fillups` finding.
- Severity `error`; the sample is Fillup ids only (no emails).
- Scoped to Fillups **created since** `ORPHAN_CHECK_SINCE`, so a pre-fix backlog can never re-alarm daily (CLAUDE.md rule). Any hit means deletion has regressed.

**`__tests__/integrityCheckGetawayStalePending.test.ts`:** stubs `@/lib/rentalIntegrity` at its module boundary. That suite's Prisma mock only has `user`; its assertions are unchanged.

## 5. Architectural Decisions
- **Application-level transaction, not an FK/cascade.** This keeps the repository's deliberate loose-reference design with no schema migration.
- **Array-form `$transaction`.** Both statements commit or neither does; no interactive-transaction callback is needed.
- **The ownership pre-check is outside the transaction**, and it is what guarantees "missing or not-owned → zero Fillups deleted". Without it, a call with a nonexistent id would still delete that user's pre-existing orphans carrying that id.
  - Race: if the rental is deleted concurrently between the check and the transaction, the transaction still removes this user's Fillups for that id and reports `false` (404). That is the desired end state (no orphans).
- **Fillups are matched by `userId` AND `rentalSessionId`.** A row belonging to another user that carries the same `rentalSessionId` is never touched.
- **The integrity check uses a creation-date scope** rather than a deletion-time scope, because deletion time isn't recorded. A Fillup created after the cutoff whose rental is later deleted is removed by the new code, so it can never become an orphan unless deletion regresses.

## 6. Security Impact
- **Authorization unchanged:** the route still resolves `userId` from the server session; a not-owned or missing rental still returns 404.
- **Delete scope:** the new delete is bounded by both `userId` and `rentalSessionId`, so it cannot reach another user's data.
- **No new endpoint, input, secret or permission.**

## 7. Data / Database Impact
- **No schema change, migration, backfill, or historical-data change.**
- **Behaviour change:** from deploy onwards, deleting a rental also permanently deletes that rental's Fillups. This matches what Help already promised.

**Historical orphan audit (production, read-only):** run 2026-10-03 inside `BEGIN TRANSACTION READ ONLY … ROLLBACK` (`transaction_read_only = on`), aggregates only.

| Metric | Result |
|---|---|
| Rental-linked Fillups in production (`rentalSessionId IS NOT NULL`) | **0** |
| Orphan Fillups (no matching RentalSession) | **0** |
| Affected users | 0 |
| Oldest / newest orphan date | — / — |
| By type: trip / final_return / other | 0 / 0 / 0 |
| Total gallons / total cost | 0.00 / 0.00 |

- **Why it is zero:** the only rental Fillups ever written in production were the two PR #59 smoke-test rows, which Don deleted through the normal fill-up UI. The two older completed rentals predate the cutover and use the legacy `refuelLogs` JSON, not Fillups.
- **Do orphans count in personal list/stats in general?** Yes, by query design. `getFillups()` has no `rentalSessionId` filter, so any rental-linked Fillup (orphaned or live) appears in the personal list, stats and the existing-fill-up count. This is architecture (the shared table) and is unchanged here.
- **Historical cleanup: not needed** (nothing to clean).

## 8. User / Business Impact
- **Renters:** deleting a test or abandoned rental no longer leaves phantom fill-ups in personal history and stats.
- **Help:** now accurate. **No copy change was needed**, and none was made.
- **Admin:** the daily integrity email gains one check that is silent unless deletion regresses.

## 9. Testing Performed
At `adbae15`:
```
npm test          → 2087 passed / 2087 (130 files)
npx tsc --noEmit   → exit 0
npm run build      → exit 0 (PWA artifacts restored/removed; tree clean)
```
- **Focused (delete/fillup/rental/integrity/guards):** 163/163 across 10 files, including protectedPathGuard and CR-1.

`__tests__/rentalDeleteFillups.test.ts` (10 tests, lib + real DELETE route):
1. Owned rental + one `trip` Fillup → both deleted.
2. `trip` + `final_return` → both deleted.
3–5. A personal (null) Fillup, another rental's Fillup, and another user's Fillup carrying the **same** `rentalSessionId` all survive.
6. Nonexistent rental → `false`, zero Fillups deleted (including a pre-existing orphan carrying that id), no transaction started.
7. Another user's rental → `false`, nothing deleted.
- **Atomic:** exactly one `$transaction` with 2 ops; and if the rental delete fails, the Fillup delete is **rolled back**.
8. DELETE route: owned → `200 {ok:true}` and the Fillups are gone; missing or not-owned → `404 {error:'Not found'}`, nothing deleted.
9. Help's existing claim is present, and the delete implementation now deletes the rental's Fillups.

**Prior-code failures and the mutation check:**
- 6 of the 10 fail on the prior code.
- Rewriting the fix as two separate awaits instead of one transaction makes the two atomicity tests fail. The harness's `deleteMany` returns lazy, PrismaPromise-like ops that `$transaction` runs and can undo, so rollback is genuinely modelled.

`__tests__/rentalOrphanIntegrity.test.ts` (5 tests):
- the pure orphan filter;
- the aggregate summary leaks no ids or users;
- the query shape (where/select, `createdSince`) with **no write calls**;
- no rental query when there are no linked Fillups;
- the integrity-check wiring.

## 10. Files Changed
`git diff --name-status origin/main...adbae15`:
```
M	__tests__/integrityCheckGetawayStalePending.test.ts
A	__tests__/rentalDeleteFillups.test.ts
A	__tests__/rentalOrphanIntegrity.test.ts
M	app/api/cron/integrity-check/route.ts
A	lib/rentalIntegrity.ts
M	lib/rentalSessions.ts
```
6 files, +349 / −2. No protected path, schema or migration file touched.

## 11. Known Risks / Remaining Questions
- **The atomicity proof is a faithful mock, not real Postgres.** Prisma's array `$transaction` is documented as atomic; a post-deploy smoke test (create a TEST rental, log a fill-up, delete, confirm both gone) would confirm it on real Postgres, as was done for the PR #59 refuel SQL.
- **Deletion is now broader and permanent.** A renter who deletes a rental also loses its fill-up records. This is intended and documented in Help; there is no undo, as before.
- **Integrity-check cutoff:** a real orphan created between 2026-10-03 and the deploy of this fix would be reported (correctly; it is a real orphan) until cleaned. The audit shows none exist now.
- **Existing integrity suites:** `findOrphanRentalFillups` adds two reads to the daily cron; volume is trivial today. Other integrity suites mocking Prisma narrowly may need the same module stub. Only one existed, and it is updated.

## 12. Claude's Assessment
**READY FOR REVIEW.** A narrow, tested fix with no schema or historical-data change; the historical audit shows zero orphans.

## 13. Questions for ChatGPT
1. Is the ownership pre-check outside the transaction acceptable given the race analysis in §5? Or should the existence check move inside an interactive transaction (`$transaction(async tx => …)`)?
2. Should rental-linked Fillups be excluded from the *personal* fill-up list/stats generally (a separate product decision), now that orphans are handled?
3. Is a creation-date cutoff the right way to keep the integrity check quiet on any historical backlog, given deletion time isn't recorded?

## 14. Requested Review Scope
1. `deleteRentalSession()`: scope (`userId` + `rentalSessionId`), atomicity, not-found/ownership behaviour.
2. The fidelity of the transaction test harness (lazy ops + rollback) and the mutation check.
3. That the integrity helper is strictly read-only and the summary is aggregate-only.
