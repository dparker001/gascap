# Monthly Drawing Integrity — Revision 5: WS-1 Conditions C1/C2 + WS-2 L9/L10

**Status: PLANNED — READY FOR REVIEW / awaiting Don's WS-1 coding authorization.** No code, PR, deploy, configuration, drawing, historical-data change, schema or Part B.
**Amends** Rev 4. Everything else in Rev 4 stands. Baseline: `main` @ `b7005f0`.

Code facts re-verified at `b7005f0` (`app/api/admin/sweepstakes/route.ts`):
- POST `month = body.month ?? currentMonth()` (line 120) is shared by **record and `send-winner-email`** (line 134). Release therefore defaults to the UTC month.
- `PUT` (alternate, line 242) and `PATCH` (claim/fulfil, line 491) already return 400 without a valid `?month=` and 404 without an existing draw. PUT also refuses a claimed prize.

---

# Part 1 — WS-1 amendments (merged into the Rev 4 Part 1 packet)

## C1 — Late-draw approval is audit evidence plus a separate Don procedure
The admin secret is the only server-side identity, so the server can't verify *who* approved. `lateDrawApprovalRef` is therefore **audit evidence, not authorization**. The authorization is this procedure:
1. Don records a dated written approval for the specific month: a file `docs/reviews/approvals/<YYYY-MM-DD>-late-draw-<month>.md` (or a GitHub issue) stating the month, the reason, and counsel's acknowledgement.
2. Its identifier is the ref.
3. **Server validation (fail closed):**
   - `lateDrawApprovalRef` must match `^[A-Za-z0-9._:/#-]{6,128}$`. This keeps out free text, PII and secrets.
   - `confirmMonth` must equal `month`, an echo against a mistyped month.
   - Otherwise the response is 400 `late_draw_requires_approval`.
   - Historical months stay rejected **regardless** of the ref.
4. **Storage (no schema change):** `notes = <admin notes verbatim> + "\n[late-draw-approval-ref: <ref>; recorded <ISO>]"`. The admin's original text is preserved byte-for-byte as the prefix, and the ref is never interpreted.
5. The run-book adds: "A late draw requires the approval record to exist **before** the request. Engineering verifies it in review of the draw log."

**Alternative, not recommended for WS-1:** a server-checked one-shot approval token in env (`GIVEAWAY_LATE_DRAW_APPROVAL=<month>:<ref>`). It's a config change and adds a deploy step to an emergency path. It can be revisited with the admin-auth migration (`docs/ADMIN_AUTH_MIGRATION.md`).

## C2 — Explicit month on every lifecycle action
| Action | Rule |
|---|---|
| POST record | `month` required (accepted Rev 4) |
| POST dry run | `month` required |
| **POST `send-winner-email`** | **`month` required**; 400 if absent (no UTC default); 404 if no draw exists for it |
| PUT alternate | Already explicit and requires an existing, unclaimed draw. Unchanged; add a regression test. |
| PATCH claim/fulfil | Already explicit and requires an existing draw. Unchanged; add a regression test. |
| GET (read-only list) | The UTC default stays (no mutation); its label is changed to ET via `currentEntryMonthET` for display only |

**Implementation:** remove the `?? currentMonth()` default. `currentMonth` is no longer imported by the admin route for any mutating path.

## Transaction requirement — duplicate month
```ts
// lib/giveaway.ts
export async function commitDraw(result, notes) {
  try {
    const draw = await prisma.$transaction(async (tx) => {
      const d = await tx.giveawayDraw.create({ data: {...} }); // P2002 aborts the tx here
      await tx.user.updateMany({ data: { /* the 7 counters = 0 */ } });
      return d;
    });
    return { inserted: true as const, draw };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
        && targetIncludes(err, 'month')) {
      return { inserted: false as const };   // caught OUTSIDE the failed transaction
    }
    throw err;
  }
}
```
- The create precedes the reset, so a losing request never reaches the reset. Postgres rolls the aborted transaction back in full.
- Callers send notifications **only** when `inserted === true`, after `commitDraw` returns:
  - **cron:** `200 {skipped:'already_drawn'}`;
  - **admin:** `409 already_drawn`.
- A P2002 on any other target is rethrown (500).

## Added regression tests
- **C1:**
  - a late draw with a missing, malformed, PII-like (`a@b.com`, spaces) or over-long ref → 400;
  - a mismatched `confirmMonth` → 400;
  - a valid ref → record, with the notes prefix equal to the original notes exactly and the ref suffix present;
  - an older month with a valid ref → `historical_month_requires_approval`.
- **C2:**
  - `send-winner-email` without a month → 400, and the dispatcher is not called;
  - with a month that has no draw → 404;
  - with a valid month → dispatched once;
  - PUT/PATCH without a month → 400.
- **Concurrency:**
  - the transaction-callback `create` rejects with P2002 (`target: ['month']`) → `{inserted:false}`, `updateMany` never called, dispatcher never called;
  - two parallel `commitDraw` calls → exactly one reset, one dispatch;
  - a P2002 with `target: ['id']` → rethrown;
  - a reset failure → the transaction rejects, no dispatch.
- **Mutation proof:** each test fails against `b7005f0`'s `recordDraw` + `.catch(reset)` and the `?? currentMonth()` default.

## Final WS-1 file list (unchanged from Rev 4, plus tests)
- `lib/giveawayPeriod.ts` (new)
- `lib/giveaway.ts` (`commitDraw`)
- `app/api/cron/giveaway-draw/route.ts`
- `app/api/admin/sweepstakes/route.ts`
- `app/api/amoe/route.ts`
- `app/api/cron/integrity-check/route.ts`
- `__tests__/giveawayPeriod.test.ts`, `__tests__/giveawayDrawGuards.test.ts`, `__tests__/amoeDraw.test.ts` (extend)
- the run-book addendum (`docs/`)

## Authorization line for Don
> **"Authorize coding WS-1 per Rev 4 Part 1 as amended by Rev 5 Part 1."**

**Once authorized:**
- branch `fix/giveaway-draw-et-guard`, scoped to the files above;
- run full and focused tests, `tsc`, `build` and the protected-path guard;
- return the full SHA, test counts, diff and risks;
- **stop at READY FOR REVIEW** (no push, PR, deploy, configuration or drawing).

---

# Part 2 — WS-2 corrections

## L9 — Identity history covers creation, deletion and collisions
- **Capture:** a single trigger `AFTER INSERT OR UPDATE OF email, "emailVerified", "isTestAccount" OR DELETE ON "User"` writes `UserIdentityHistory(userId, emailNorm, emailVerified, isTestAccount, deleted bool, validFrom)`. The value of `validFrom` is set per L10.
  - INSERT captures account creation (both `createUser` and the Google path).
  - DELETE writes a tombstone. A user deleted before close isn't in the paid pool, so their AMOE becomes standalone (matches legacy, since the user row no longer exists).
- **Seed:** one row per existing user at deploy, `validFrom = deploy`. A one-time read-only check runs first.
- **Normalization:** `emailNorm = lower(btrim(email))`, the same as `normalizeAmoeEmail` and the signup paths (`createUser` and the Google path both store `email.toLowerCase().trim()`; `findByEmail` is case-insensitive).
  - `User.email @unique` is case-*sensitive* in Postgres, so a collision is **possible only via a manual/admin write**, not through app signup.
- **Collision behaviour (fail loud, never silent):**
  1. Integrity check `identity-email-collision`: flags any `emailNorm` held by >1 live user. Expected count 0, so it never fires on expected state.
  2. At close: if an AMOE `emailNorm` maps to >1 live user, or >1 user in the paid pool shares an `emailNorm`, the close job **aborts with `identity_collision`** and alerts. No snapshot is written, so nobody is excluded or merged by guesswork. An admin resolves the duplicate, then the close reruns.
  3. A future in-app email change is covered automatically by the UPDATE trigger.
- **Tests (real Postgres, D11):**
  - an insert creates a history row;
  - an email change and a verification flip write rows; the value at close is chosen by `validFrom`;
  - a deletion before vs after close;
  - two users with `A@x.com` and `a@x.com` → the close aborts `identity_collision` and the integrity check flags them;
  - an AMOE match against a user created after close → standalone.

## L10 — Eligibility-critical state under the L1 lock protocol
**Approach (equivalently provable, independent of app writers):** a database trigger, not app code, so all ~25 app call sites that write plan or entitlement fields, plus webhooks, crons and manual SQL, are covered without enumeration.

- **Shared function `ledger_writer_clock()` (plpgsql)**, used by credit writers **and** history triggers:
  1. `pg_advisory_xact_lock_shared(NS, monthKey(etMonth(clock_timestamp())))`;
  2. `t := clock_timestamp()`;
  3. if `etMonth(t)` differs, also take the shared lock on it (ascending order; re-entrant if already held);
  4. return `t`.
- **Trigger `user_eligibility_history`:** `AFTER INSERT OR UPDATE OF <columns> OR DELETE ON "User"`, FOR EACH ROW. It calls `ledger_writer_clock()` and writes `UserEligibilityHistory(validFrom = t, …full eligibility tuple…)`. The columns:
  - plan, `isProTrial`, `trialExpiresAt`, `stripeInterval`, `revenueCatActive`, `revenueCatInterval`, `lifetimePerksUntil`;
  - `earlyUpgradeBonusEntries`, `referralLifetimeBonusEntries`;
  - email, `emailVerified`, `isTestAccount`.

  This merges L9's table into one tuple. The excluded-emails list is a code constant whose SHA-256 is stored on each snapshot.
- **Time-based expiries** (`trialExpiresAt`, `lifetimePerksUntil`) are evaluated *against close* using the stored timestamp. `plan` is used as recorded at close, which matches legacy: eligibility is `plan ∈ {pro, fleet}` as stored. Provider events (Stripe/RevenueCat) apply at **receipt time**, the same policy as L1 credits (counsel item).
- **Closer:** unchanged from L1. It takes the exclusive month lock after `close(M)`, then reads:
  - credits for M;
  - **the latest `UserEligibilityHistory` row per user with `validFrom < close(M)`**.

**Proof.** The trigger runs inside the writer's transaction, so the shared lock is held until that transaction commits or aborts.
- A state change with `t < close(M)` holds shared lock M; the closer's exclusive lock waits for its commit, so the row is visible and included.
- A change whose `t ≥ close(M)` is excluded and applies to M+1.
- A change rolled back never existed.

This is the same argument as L1, so no eligibility-affecting commit can race the snapshot.

**Operational guards:**
- the closer uses `lock_timeout = 5min` and retries, alerting if a writer holds the lock longer;
- writers must not hold a transaction open across external API calls (an existing rule; the Stripe/RevenueCat handlers call providers before their DB transaction). This is verified per handler during WS-2b review.

**Tests (real Postgres, D11), both commit orderings:**
1. A plan change commits **before** the closer locks → included.
2. A plan change holds the lock across `close(M)`; the closer blocks, the change commits, the closer includes it.
3. A change begun after the closer holds the lock → `validFrom ≥ close`, excluded from M.
4. The same three cases for an `emailVerified` flip and an `isTestAccount` flip.
5. A rolled-back change → absent.
6. Lifetime Perks expiring 1 ms before vs after close.
7. A trial `trialExpiresAt` before vs after close.

## L5 baseline validation against production aggregates (read-only; separate authorization)
A script `scripts/audit-ledger-baselines.mjs` (header: **READS ONLY**; `SET TRANSACTION READ ONLY`; aggregates, no identifiers) will report:
- **Referral:** the distribution of `referralCount`, compared with independently derivable evidence: users whose `referredBy` equals the referrer's code and who reached paid status, plus `referralCredits` entries. It reports match and mismatch **counts** by bucket.
- **Streak:**
  - stored `streak` vs `computeStreak(activeDays)` recomputed, as counts per `STREAK_BONUS_TIERS` bucket;
  - the count of lapsed-but-tiered users (last active day before the current ET month);
  - the count of streaks crossing a tier boundary at a month start.
- **Recurring:** counts and sums of `earlyUpgradeBonusEntries > 0` and `referralLifetimeBonusEntries > 0` by plan.
- **Identity:** the count of `emailNorm` collisions; expected 0.

**Acceptance:**
- mismatches are explained (e.g. the historical day-key mix) or escalated;
- seeding doesn't proceed while referral mismatches are unexplained.

**Gate WS-2-V:** Don authorizes running the script. Results come back as aggregates.

---

# Part 3 — Gates and risks (delta from Rev 4)
**Gates:**
1. **WS-1b** — coding authorization (the line above), then READY FOR REVIEW.
2. **WS-1c** — push, PR, ChatGPT review, Don merge/deploy by **Oct 29**.
3. **WS-1d** — read-only env check, run-book sign-off (Don + counsel), Nov 1 manual draw.
4. **Counsel** — in parallel, now.
5. **D11** — CI Postgres. A prerequisite for the L1, L7, L9 and L10 tests.
6. **WS-2-V** — read-only baseline aggregates.
7. **WS-2a** — AMOE cutover.
8. **WS-2b** — design approval, PR, schema (registry, credits, the two history tables, triggers, `ledger_writer_clock`), marker backfill, dual-write before M0, baseline seed, shadow M0, cutover, ≥1 month dual-write, legacy retirement.
9. **WS-3** — phone.
10. **Part B.**

**Risks added:**
1. **C1 relies on procedure, not server verification.** Mitigated by the ref format, the confirm-month echo and post-draw review. Real verification waits for the admin-auth migration.
2. **Trigger-based history adds a lock acquisition to every eligibility-field write.** Contention is only with the monthly closer, for seconds.
3. **A collision abort delays the close.** That's intentional: delay beats silent exclusion.
4. **Receipt-time attribution of provider events** (e.g. a RevenueCat webhook delayed past close) is a counsel item.

**Evidence preserved for counsel (unchanged; nothing modified):**
- the June/July undrawn entries (5 AMOE);
- the early August/September draws (run IDs `33348254576` / `36659883601`, `GiveawayDraw` rows);
- the October limitations;
- the undisclosed bonus sources (incl. recurring referral-lifetime, lapsed-streak tiers, AMOE from test/unverified accounts).

**Stop: READY FOR REVIEW.**
