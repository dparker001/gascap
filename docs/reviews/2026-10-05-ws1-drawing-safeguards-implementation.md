# ChatGPT Review Packet — WS-1 Drawing Safeguards Implementation

**Status: IMPLEMENTED (local branch) — READY FOR REVIEW.** Not pushed, no PR, not deployed. No configuration change, drawing or data change.

## 1. Objective
Implement the October 31 emergency drawing safeguards per Drawing Integrity Rev 4 Part 1, as amended by Rev 5 Part 1 (C1/C2). Don authorized local coding and testing only.

## 2. Repository State
| Item | Value |
|---|---|
| Branch | `fix/giveaway-draw-et-guard` (worktree `/Users/dpark/Projects/gascap-draw-guard`) |
| Base | `origin/main` @ `b7005f0bc03453de4a0088b581cebf580e4544b2` (the review baseline) |
| Implementation commit | `615001c8a245ffb51b6ecfa6a09006be842d07a5` |
| This packet | a following docs-only commit |

Remote: none. Push, PR, merge and deploy are separate gates.

## 3. What I Found (during implementation)
1. **Correction to Rev 4/5:** the old code did **not** reset counters on a losing concurrent request.
   - `recordDraw` (a plain `create`) threw P2002 *before* the reset ran.
   - Old **admin** losers returned 409.
   - Old **cron** losers threw unhandled, giving a **500**.

   The real old defects were:
   - a reset failure was swallowed (`.catch`), leaving a recorded draw with un-reset counters that compounded into the next month;
   - the cron loser returned a 500, not a clean skip.

   The "loser must not reset or notify" invariant is now structural (insert first, one transaction) and tested. It was not an observed old bug.
2. **The admin panel maps every 409 to "A draw for X was already run."** (`app/admin/sweepstakes/page.tsx`). The guard therefore uses **422** for `month_open`, `historical_month_requires_approval` and `late_draw_requires_approval`, so the panel shows the real reason without a UI change. 409 is reserved for `already_drawn`.
3. **The panel's month picker defaults to the UTC month.** At 12:00 AM EDT Nov 1 that's already November; the server refuses it (`month_open`). The run-book says to select October explicitly. The panel sends `month` on every call, so C2 doesn't break it.
4. The panel has no fields for `lateDrawApprovalRef` / `confirmMonth`. Late recovery is by direct API call (documented in the run-book). This is deliberate friction for an exceptional path.
5. **Prisma 7 + adapter-pg P2002 `meta.target` shape** isn't relied on. The duplicate is confirmed by re-reading `GiveawayDraw` by `month` (the only non-UUID unique column), the same pattern as `lib/users.ts` signup race recovery.

## 4. What I Changed
- **`lib/giveawayPeriod.ts` (new, pure):**
  - `currentEntryMonthET`, `entryMonthCloseInstant` (DST-aware via `Intl` `America/New_York`), `isEntryMonthClosed`, `latestClosedEntryMonthET`, `isWithinAutoWindow` (`[close, close+72h)`), `entryMonthState`;
  - `assertRecordableEntryMonth` (order: `invalid_month` → `month_open` → `historical_month_requires_approval` → `already_drawn` → `outside_auto_window` (auto) / `late_draw_requires_approval` (admin));
  - `isValidLateDrawApprovalRef` (`^[A-Za-z0-9._:/#-]{6,128}$`) and `lateDrawNotes` (original notes verbatim + `[late-draw-approval-ref: …; recorded ISO]`).
- **`lib/giveaway.ts` — `commitDraw`:**
  - one `prisma.$transaction`: `giveawayDraw.create`, then the 7-counter `user.updateMany`;
  - P2002 caught **outside** the transaction, confirmed by `findUnique({month})` → `{inserted:false}`, otherwise rethrown;
  - `recordDraw` and `resetPeriodBonusEntries` keep their behaviour (shared row/reset constants) and have no route callers left.
- **Cron `giveaway-draw`:**
  - auth → `GIVEAWAY_AUTO_DRAW !== 'on'` → skip;
  - a non-monthly `GIVEAWAY_CADENCE` → skip (the rules are monthly);
  - target `latestClosedEntryMonthET`, guard in auto mode, `commitDraw`;
  - notifications only if `inserted`;
  - `force` and the UTC `isLastDayOfMonth` are removed.
- **Admin `sweepstakes` POST:**
  - `month` required for every action (record, dry run, `send-winner-email`); the `?? currentMonth()` default is removed;
  - record → guard (admin mode) → `commitDraw` → 409 on a lost race;
  - a dry run labels `monthState` and `withinAutoWindow` and writes nothing;
  - GET (read-only preview) defaults to the ET month;
  - PUT and PATCH unchanged (they already require an explicit month and an existing draw).
- **AMOE:** month = `currentEntryMonthET()`, for both the tag and the one-per-month limit.
- **Integrity `missing-draw`:**
  - checks `latestClosedEntryMonthET`;
  - silent while `isWithinAutoWindow` (expected pending state);
  - `GIVEAWAY_PAUSED` unchanged.
- **`docs/GIVEAWAY_DRAW_RUNBOOK.md` (CURRENT):** October procedure with the Don + counsel sign-off block, error codes, the late-draw procedure, and the rules for later enabling the auto draw.

## 5. Architectural Decisions
- **Explicit-approval tokens are audit evidence only (C1).** The server can't verify the approver; authorization is Don's dated written record. A server-checked env token was rejected for WS-1, because it would mean a config change on an emergency path.
- **Reset inside the draw transaction:** a failure now rolls back the draw (retryable) instead of silently leaving stale counters.
- **422 vs 409** chosen for compatibility with the existing panel (finding 2).
- **Non-monthly cadence refused** by the cron. Weekly/daily aren't in the rules, and the admin route already accepts only `YYYY-MM`.

## 6. Security Impact
- **Fail-closed:** a missing or any non-`on` value of `GIVEAWAY_AUTO_DRAW` means no automatic draw.
- **Bypass removed:** the `force` bypass is gone.
- **Auth unchanged:** the cron's `CRON_SECRET` check and the admin `auth()` gate are untouched.
- **No secrets** logged or stored. The approval ref regex excludes `@` and whitespace, so emails and free text can't be stored.

## 7. Data / Database Impact
- **No schema change.** `GiveawayDraw.notes` carries the approval ref.
- **No historical rows touched.**
- **Reset semantics:** the counter reset is unchanged in content, now transactional.
- **Lock duration:** `updateMany` over all users (~hundreds) runs inside the draw transaction, under Prisma's default 5 s interactive-transaction timeout.

## 8. User / Business Impact
- **The automatic draw stops after deploy**, as long as `GIVEAWAY_AUTO_DRAW` stays unset. October is drawn manually on Nov 1 per the run-book.
- **AMOE submissions** 8:00–11:59 PM ET on the last day now count for the correct month.
- **No user-facing copy changed:** the rules already state ET, so help and AI copy are unaffected.

## 9. Testing Performed
| Check | Result |
|---|---|
| Baseline (`main` @ `b7005f0`) | 131 files / 2,092 tests passed |
| **Full suite (branch)** | **135 files / 2,173 tests passed** (+4 files, +81 tests) |
| Focused | `giveawayPeriod` 22 · `giveawayDrawGuards` 48 · `amoeEtMonth` 6 · `integrityMissingDraw` 5 — all pass |
| `npx tsc --noEmit` | clean |
| `npm run build` | exit 0 (build artifacts in `public/` reverted, not committed) |
| `npm run check:crons` | ✓ 21 routes, 19 scheduled, 2 exempt |
| Protected-path guard + CR-1 (`protectedPathGuard`, `cr1CommercialTruthAlignment`) | 61 passed. No protected path touched. |

**Mutation proof:** the 5 modified source files were reverted to `origin/main` while the new tests ran, then restored. **52 of 59 route-level tests failed** against old code, including:
- every fail-closed switch case and `force=1`;
- Oct 31 23:50Z and the replayed 01:39Z delayed-run pattern;
- the 72-hour window;
- the admin missing, open and historical month cases;
- every C1 late-draw case;
- `send-winner-email` without a month;
- the cron loser's 500;
- all AMOE ET boundaries except Nov 1 04:00Z (UTC and ET agree there);
- all 5 `missing-draw` cases.

The 7 that pass on old code:
- **already correct:** the wrong-secret 401, AMOE at 04:00Z, `send-winner-email` 404/200 with a month, PUT/PATCH month and draw requirements;
- **passes for a test-harness reason, stated honestly:** "admin reset failure → nothing recorded". The fake DB refuses the old non-transactional `create`. The old code's behaviour — recorded draw kept, reset error swallowed — comes from reading it (`recordDraw` then `resetPeriodBonusEntries().catch(...)`). The `commitDraw`-level rollback test does fail against old code.

**Race evidence:** a transaction-faithful fake models `GiveawayDraw.month` uniqueness (committed or in flight → real `Prisma.PrismaClientKnownRequestError` P2002) and rollback of all staged writes on a callback throw. Covered:
- `commitDraw` × 2 in parallel;
- cron×cron, cron×admin and admin×admin, each giving exactly 1 draw, 1 reset and 1 notification, with the loser returning `already_drawn`;
- a P2002 not tied to this month → rethrown;
- a reset failure → no draw, lock released, retry succeeds.

**Not a real-Postgres proof** (D11). The production guarantee is the existing unique constraint plus Postgres transaction semantics.

## 10. Files Changed
- `lib/giveawayPeriod.ts` (new)
- `lib/giveaway.ts`
- `app/api/cron/giveaway-draw/route.ts`
- `app/api/admin/sweepstakes/route.ts`
- `app/api/amoe/route.ts`
- `app/api/cron/integrity-check/route.ts`
- `__tests__/giveawayPeriod.test.ts`, `__tests__/giveawayDrawGuards.test.ts`, `__tests__/amoeEtMonth.test.ts`, `__tests__/integrityMissingDraw.test.ts` (new)
- `docs/GIVEAWAY_DRAW_RUNBOOK.md` (new)

`amoeDraw.test.ts` was **not** extended. The ET tests live in a separate file so their module mocks don't affect its existing tests.

## 11. Known Risks / Remaining Questions
1. **October legacy accounting:** the limitations stand. The run-book requires Don and counsel sign-off before the Nov 1 draw.
2. **The pre-existing reset-erasure race is unchanged.** Increments between pool build and reset are erased; this is a WS-2 item.
3. **`.github/workflows/crons.yml` line 5 has a stale comment** ("no-ops except the last UTC day of the month"). It's outside the approved files and was left as-is. It's a comment-only follow-up needing a separate cron-file change approval.
4. **No real-DB race test** until D11.
5. **Daily failure emails:** if the auto draw is ever enabled and no entrants are eligible, the existing "auto-draw failed" admin email can now fire on each of up to 3 in-window runs (previously once).
6. **The admin month picker defaults to UTC.** The server refuses a wrong open month, so this is a usability issue only, and the run-book covers it.
7. **Deploy timing:** deploy before Oct 30's 7:50 PM ET run, outside 9:45–10:15 AM ET. After deploy, an unset switch makes every cron run a skip.

## 12. Claude's Assessment
The implementation matches Rev 4/5 Part 1, stays in the approved files, and every change has a behaviour test.

- The invariant "no Entry Month recorded before 12:00:00 AM ET of the next month" is enforced by one pure, boundary-tested function used by both entry points.
- The main residual risk is operational (October legacy accounting and the Nov 1 manual step), not code.

Recommend independent review: this is compliance-sensitive drawing logic.

## 13. Questions for ChatGPT
1. Is 422 for guard refusals (to fit the existing panel) acceptable, or should the panel be changed instead, which would be outside WS-1 scope?
2. Should the cron also refuse when `GIVEAWAY_PAUSED=true`? It's currently alert-only by design, and the switch is the real control.
3. Is the reset-failure → rollback behaviour acceptable, given the extra retry email on the auto path?

## 14. Requested Review Scope
`git diff b7005f0..615001c` — the guard ordering, `commitDraw` error classification, the C1 ref handling, C2 coverage, the integrity grace window, and the run-book accuracy.

**Next authorization required:** "Authorize push of `fix/giveaway-draw-et-guard` and opening a PR (no merge, no deploy)." Merge/deploy (by Oct 29), the read-only Railway env check, and the Nov 1 run-book execution are separate later gates.
