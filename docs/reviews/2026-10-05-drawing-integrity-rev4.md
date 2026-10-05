# Monthly Drawing Integrity — Revision 4: WS-1 Authorization Packet + WS-2 L5–L8

**Status: PLANNED — READY FOR REVIEW.** No code, PR, deploy, configuration, drawing, historical-data change, schema, entry grant or Part B.
**Supersedes:**
- Rev 3 §1 (WS-1). The accepted parts are restated here so this packet stands alone.
- Rev 3 L4's `'legacy'` marker month, replaced by L8.

All other accepted Rev 3 decisions stand:
- the L1 writer/closer locks;
- period-specific immutable credits;
- frozen snapshots;
- the outbox;
- L2/L3 except where L6/L5 refine them.

Code facts were re-verified at `main` @ `b7005f0`:
- `recordDraw` is a plain `prisma.giveawayDraw.create` (`lib/giveaway.ts:680`);
- `GiveawayDraw.month @unique`;
- the reset is a separate `updateMany` (`lib/giveaway.ts:713`), called after the record with `.catch()`.

---

# Part 1 — WS-1 Final Authorization Packet

## 1.1 Invariants
1. **Close invariant (accepted).** No path records an Entry Month before 12:00:00 AM ET on the 1st of the next month.
2. **Bounded automatic window (new).** The automatic path may record month M only while `close(M) ≤ now < close(M) + AUTO_WINDOW` (**72 h**, a constant, not env-configurable). Outside the window it fails closed: `skipped: outside_auto_window`, and the integrity `missing-draw` alert surfaces it.
3. **Late recovery is explicit (new).** Admin may record the latest closed month after the window only with a non-empty `lateDrawApprovalRef`, which is stored in `GiveawayDraw.notes`. Months older than the latest closed month remain **always rejected** (`historical_month_requires_approval`). No code path performs a corrective historical drawing.
4. **Single winner of a race (new).** For each month, exactly one `GiveawayDraw` insert succeeds. Only that request resets counters and sends notifications.

**Why 72 h:** the cron fires daily at 23:50Z (7:50 PM EDT / 6:50 PM EST). The window covers the first post-close run plus two retries or GitHub delays, and the stale auto-draw risk is capped at about 3 days.

## 1.2 Approved files (implementation limited to these)
| File | Change |
|---|---|
| `lib/giveawayPeriod.ts` (new) | Rev 3 helpers, plus:<br>• `AUTO_WINDOW_MS = 72*3600e3`<br>• `isWithinAutoWindow(month, now)`<br>• `assertRecordableEntryMonth(month, now, history, { mode: 'auto' \| 'admin', lateDrawApprovalRef? })`<br><br>Error order:<br>1. `invalid_month`<br>2. `month_open`<br>3. `historical_month_requires_approval`<br>4. `already_drawn`<br>5. `outside_auto_window` (auto) / `late_draw_requires_approval` (admin without a ref) |
| `lib/giveaway.ts` | New `commitDraw(result, notes)`. One `prisma.$transaction`:<br>• `giveawayDraw.create`;<br>• P2002 on `month` → return `{ inserted: false }`;<br>• otherwise run the existing reset `updateMany` **inside the same transaction** → `{ inserted: true, draw }`.<br><br>`recordDraw` and `resetPeriodBonusEntries` stay exported but get no new callers. Draw math and the AMOE merge are unchanged. |
| `app/api/cron/giveaway-draw/route.ts` | Auth → `GIVEAWAY_AUTO_DRAW === 'on'` → target `latestClosedEntryMonthET` → guard (`mode: 'auto'`) → `runWeightedDraw` → `commitDraw` → notifications **only if `inserted`**; else `200 {skipped:'already_drawn'}`. `force` and `isLastDayOfMonth` are removed. |
| `app/api/admin/sweepstakes/route.ts` | Record requires `month`, guard (`mode: 'admin'`), `commitDraw`. The loser gets 409 `already_drawn` with no reset or email. A dry run requires a month and returns `monthState` and `withinAutoWindow`. `send-winner-email` and `PUT` (alternate) are unchanged. |
| `app/api/amoe/route.ts` | Uses the ET month (accepted). |
| `app/api/cron/integrity-check/route.ts` | `missing-draw` uses `latestClosedEntryMonthET`. It fires only after `close + AUTO_WINDOW`, never on expected state. |

**Not touched:** the workflow and all other crons, the activity-date fallback (O-4), rules, copy and schema.

**Behaviour change, stated:**
- The reset now commits atomically with the draw. A reset failure rolls back the draw (retryable), where today the error is swallowed and counters carry into the next month.
- Notifications still fire after commit, as today. The outbox is WS-2.
- The pre-existing reset-erasure race (increments between pool build and reset) is **unchanged**. It is a WS-2 item and is listed for October.

## 1.3 Tests (additions to Rev 3 §1.5, all retained)
`__tests__/giveawayPeriod.test.ts`:
- **October (EDT):**
  - window boundaries: `close` → in; `close + 72h − 1ms` → in; `close + 72h` → out;
  - the Nov 1 23:50Z run is in.
- **November (EST):** close `05:00Z`, same boundary checks.
- **Admin:**
  - latest closed month outside the window without a ref → `late_draw_requires_approval`;
  - with a ref → OK;
  - an older month with a ref → still `historical_month_requires_approval`.

`__tests__/giveawayDrawGuards.test.ts`:
- **Auto-window:**
  - switch on, day 4 after close, month not drawn → skipped `outside_auto_window`;
  - no `runWeightedDraw`, no `create`, no reset;
  - the integrity check flags it.
- **Race (mocked Prisma, transaction-faithful):**
  - two concurrent `commitDraw` calls for one month: the first create succeeds, the second throws P2002;
  - assert `inserted` true for one call and false for the other;
  - reset `updateMany` called **once**;
  - notification dispatcher called **once**;
  - the loser returns `already_drawn`.
  - Run for cron×cron, cron×admin and admin×admin.
- **Reset failure:** reset throws → transaction rejects → no draw persisted, no notification.
- **Non-P2002 create error:** rethrown (500), no reset.

**Mutation checks** (must fail against old behaviour):
- the old `recordDraw` + `.catch(reset)` path resets on the losing request;
- the old cron with the switch on draws on day 10.

**Limitation:** no real-Postgres CI (D11), so the race test is mocked. The unique constraint itself is the production guarantee.

**Required checks:** `npm test`, `npx tsc --noEmit`, `npm run build`, protected-path guard.

## 1.4 Operational checks and October run-book (accepted; restated)
- Deploy by **Oct 29**, outside 9:45–10:15 AM ET.
- Confirm `GIVEAWAY_AUTO_DRAW` is unset (read-only), then the next cron log shows `skipped: auto-draw disabled`.
- **Nov 1, at or after 12:00:30 AM EDT:**
  - admin dry run `2026-10` (`monthState: closed`, `withinAutoWindow: true`);
  - record with hold-and-verify;
  - archive aggregates for counsel;
  - release emails after verification.
- The run-book sign-off (Don plus counsel checkbox) is required first. The October limitations it covers:
  - ~26 h of September credits;
  - minutes of November credits;
  - local/UTC activity day keys;
  - draw-time eligibility and multiplier;
  - the reset-erasure race.

## 1.5 Authorization requested
**WS-1b — "Authorize coding WS-1 per Rev 4 Part 1":**
1. Implementation limited to the §1.2 files and §1.3 tests, on branch `fix/giveaway-draw-et-guard`.
2. Stop at READY FOR REVIEW.
3. Push, merge and deploy are separate gates.

---

# Part 2 — WS-2 L5–L8 Corrections

## L8 (first, others depend on it) — Source-key registry and non-drawable legacy markers
**Rev 3 defect:** `entryMonth = 'legacy'` breaks the `YYYY-MM` format, lock-key derivation and snapshot filters.

**Correction:** separate *idempotency* from *drawable credit*.
- **`EntrySourceKey`** — `sourceKey PK`, `userId`, `kind`, `origin ∈ {'ledger','legacy_marker'}`, `createdAt` (DB clock), `legacyEvidence JSONB NULL`. This is the single dedup authority for one-time and event awards.
- **`EntryCredit`** — `sourceKey PK FK → EntrySourceKey`, plus `entryMonth CHAR(7) NOT NULL CHECK (entryMonth ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')`, `amount`, `occurredAt`, …
- **A marker** is an `EntrySourceKey` row with `origin = 'legacy_marker'` and **no** `EntryCredit`.
  - Snapshots, locks and month validation read only `EntryCredit`, so markers are non-drawable by construction.
  - Markers are not month-attributed and take no month lock.
  - A CHECK/trigger forbids an `EntryCredit` whose key's origin is `legacy_marker`.
- **Backfill (separately gated write; idempotent via `ON CONFLICT DO NOTHING`):**

  | Award | Marker key | Evidence |
  |---|---|---|
  | Email verify | `email_verify:<uid>` | `emailVerifyBonusGranted` |
  | First calc | `first_calc:<uid>` | `calcCount + budgetCalcCount > 0` |
  | Streak milestones | `streak_milestone:<uid>:<n>` | each `streakMilestonesHit` element |
  | Phone | `phone_verification:<uid>` | only the 4 OTP users, not the 152 |

  It prints before/after counts per kind.
- **Tests:**
  - a marker never appears in a snapshot;
  - a later real award for a marked key is rejected (no credit, no legacy increment);
  - the month CHECK rejects `'legacy'` and `'2026-13'`;
  - a backfill rerun gives 0 new rows.

## L7 — Idempotent dual write
**Protocol** (one interactive transaction, inside the L1 lock sequence, for every awarding event):
1. The legacy guard (existing flag or check, unchanged) must pass. If it doesn't, stop.
2. `INSERT INTO "EntrySourceKey" … ON CONFLICT ("sourceKey") DO NOTHING RETURNING 1` via `$queryRaw`.
3. **If no row is returned** (duplicate): **no** `EntryCredit` and **no** legacy update. Return `{ accepted: false }` and log `dual_write_duplicate` (count only, no PII).
4. If a row is returned: `INSERT EntryCredit`, then `UPDATE "User" SET <legacyCounter> = <legacyCounter> + amount` (and any legacy flag) → `{ accepted: true }`.

**Proof:**
- **Atomicity:** the registry, credit and legacy rows commit together or roll back together. A failure at any step leaves no partial state.
- **Concurrent duplicates:** under READ COMMITTED, the second insert on the same key blocks on the unique index until the first commits, then `DO NOTHING` returns no row, so there's no second legacy update.
- **If the first aborts:** the second inserts.
- **Retries:**
  - after commit → duplicate → no-op;
  - after rollback → a fresh accept;
  - a client timeout after commit → the retry is a no-op.

**Key-boundary rule:** each `sourceKey` must equal the legacy idempotency boundary exactly during dual-write (e.g. daily gift keyed on the same date string legacy uses). Gating the legacy update on ledger acceptance therefore never suppresses a legacy-valid award. Any intended boundary change happens only at cutover, with a shadow-report entry.

**Tests:**
- duplicate key → legacy counter unchanged;
- legacy update throws → no registry or credit row;
- interleaved concurrent duplicates (mocked, plus a real Postgres test under D11);
- legacy guard fails → no insert;
- per-kind key-boundary parity with legacy (e.g. two daily gifts on different local dates → two accepts).

## L5 — Historical baseline for the first ledger month (M0)
**Verified pre-ledger state the legacy draw uses** (`getEligibleEntrants`):

| Input | Legacy semantics (preserved) | Ledger baseline |
|---|---|---|
| Referral multiplier and +15/referral | `referralCount`, never reset | **`ReferralBaseline(userId, count)`**: `referralCount − count(referral_paid credits for user)`, computed in one REPEATABLE READ statement after dual-write is enabled. Exact even if referrals land mid-seed, because the dual write moves both together. Count at close = baseline + `referral_paid` credits with `occurredAt < close`. |
| Streak bonus | the stored `streak` at draw time: the run ending at the user's **last** active day, not decayed by inactivity | **`ActivityBaseline(userId, days[])`**: a frozen copy of pre-M0 `activeDays`. Streak at close = the consecutive run ending at the user's last active day ≤ close, over baseline days ∪ `active_day` credit days. That reproduces long tiers spanning M0's start. **Flag for Don:** a lapsed streak still earning its tier is today's behaviour; preserved, not endorsed. |
| Lifetime / Perks / Annual | `stripeInterval`, `revenueCatActive/Interval`, `lifetimePerksUntil > now` | `EntitlementHistory` seeded with each user's current state at deploy. Perks expiry is evaluated against **close**, not draw time. |
| Early-upgrade bonus | `earlyUpgradeBonusEntries`, recurring every month while paying | **`RecurringEntitlementHistory(userId, kind, amount, effectiveFrom, effectiveTo)`**, seeded from the current value. A change writes a new row (dual-write). Computed at close, never a credit. |
| Referral-lifetime bonus | `referralLifetimeBonusEntries`, **never reset, so it counts in every monthly draw** | Same table, `kind = referral_lifetime`. **Flag for Don and counsel:** code comments describe a banked one-time substitute; behaviour is recurring. Preserved until decided. |
| Paid-pool gate | `baseEntries > 0` (at least one active day in the period) | ≥1 `active_day` credit in M |

**The no-double-count table** (Rev 3 L3) gains:
- `referral_lifetime` and `early_upgrade`: computed only;
- `referral_paid`: amount 0.

**M0 tests** (fixtures computed both ways; equal except documented key-boundary deltas):
1. A 120-day streak spanning M0's start → 90-day tier.
2. A streak that lapsed before M0 → legacy tier preserved.
3. 7 pre-existing referrals + 1 in M0 → multiplier and +15 × 8, counted once.
4. Lifetime + Perks expiring mid-M0 → base Lifetime bonus at close.
5. A recurring early-upgrade bonus.
6. A recurring referral-lifetime bonus.
7. A Pro user with 0 active days → excluded from the paid pool.

## L6 — Identity history for AMOE matching
- **Email source:**
  - `User.email` is `@unique`;
  - no in-app email-change path was found (the profile route doesn't write `email`; admin PATCH fields are plan, `emailVerified` and `isTestAccount`);
  - to stay reliable against any future or manual change, an **`AFTER UPDATE OF email, emailVerified, isTestAccount` trigger** writes `UserIdentityHistory(userId, emailNorm, emailVerified, isTestAccount, validFrom)`, seeded with current values at deploy.
  - **Email at close** is the history row valid at `close(M)`.
- **Today's `mergeAmoeEntrants` semantics, which the ledger must reproduce:**
  - the paid pool requires all of: Pro/Fleet, verified, not test, not excluded, ≥1 active day;
  - AMOE emails (trimmed, lower-cased; excluded emails dropped) that match a **paid-pool row** add +1 to that row;
  - **all other AMOE, including registered users who are unverified, free, lapsed, test-flagged or have 0 active days, become a standalone row of weight 1**;
  - one submission per email per month.
- **Ledger rule:**
  - match an AMOE credit to `user:<id>` **only if that user is in M's paid pool at close**;
  - otherwise the row is `amoe:<sha256(emailNorm)>` with weight 1.

  Each normalized email resolves to exactly one row, so one person gets one position. (This corrects Rev 3 L2 case (b), which gave an ineligible user a `user:` row: same weight, but the key differs from today. Now identical.)
- **Alternates:** exclude prior selections by both `user:<id>` and the `amoe:<hash>` of that user's email at close, so a winner can't reappear under the other key.
- **Flagged for counsel (behaviour unchanged):**
  - test-flagged or unverified registered users can win through AMOE;
  - no alias normalization (Gmail dots and `+` tags are different people).
- **Tests:**
  1. A verified Pro user with activity plus AMOE → one row, paid + 1.
  2. An unverified registered user plus AMOE → a standalone `amoe:` row of weight 1.
  3. A Pro user with 0 active days plus AMOE → standalone, weight 1 (matches legacy).
  4. Standalone AMOE.
  5. An email changed before vs after close → matched by the history row.
  6. Alternate exclusion across both keys.
  7. Parity test: ledger pool == `getEligibleEntrants` pool on shared fixtures.

## L8 (continued) — When rollback to legacy counters is safe
**Requirements during and after cutover:**
- dual-write continues for **at least one full month** after cutover;
- the legacy reset keeps running **inside each ledger draw's `commitDraw` transaction**, so legacy counters stay period-bounded.

**Rollback to legacy as the draw source for month M is safe only if all hold:**
1. No `GiveawayDraw` exists for M.
2. Dual-write was active for **all of M**: the per-user shadow monitor shows legacy counter = Σ ledger credit amounts for that counter since the last reset, with zero unexplained divergence.
3. The M−1 draw's transaction performed the legacy reset.
4. No outbox notification for M is pending.

**When those hold:** flip the draw-source flag before drawing M. Legacy counters then have exactly today's semantics, including the known timezone residuals.

**Never:**
- re-draw or alter a month already recorded from the ledger;
- roll back mid-month after a failed condition 2. That's a counsel decision.

Credits and markers are never deleted on rollback, so a later roll-forward neither loses nor duplicates anything (keys stay claimed).

**Tests:**
- a rollback-eligibility function for each condition;
- a simulated month with one dual-write gap → ineligible;
- roll forward after rollback → no duplicate credits.

## Phone writer
Unchanged from Rev 3, plus:
- it uses L7 (registry key `phone_verification:<uid>`, legacy `phoneBonusEntries` incremented only on acceptance);
- the 4 legacy OTP users are L8 markers.

---

# Part 3 — Gates and Remaining Risks
**Gates** (each needs separate authorization):

| Gate | Scope |
|---|---|
| **WS-1b** | Code per Part 1, then READY FOR REVIEW |
| **WS-1c** | PR, review, Don merge/deploy (by Oct 29) |
| **WS-1d** | Read-only env check, then run-book sign-off (Don + counsel), then Nov 1 manual draw |
| **Counsel** (parallel, now) | • June/July (5 AMOE never drawn)<br>• early Aug/Sep<br>• undisclosed sources (incl. the recurring referral-lifetime bonus and lapsed-streak tiers)<br>• October residuals<br>• AMOE eligibility of test/unverified accounts<br>• receipt-time policy<br><br>All evidence preserved: Rev 2 §0 aggregates, GitHub Actions run IDs `33348254576` / `36659883601`, `GiveawayDraw` rows (checksum before any WS-2 deploy) |
| **D11** | CI Postgres service (infra) — prerequisite for the L1/L7 real-DB tests |
| **WS-2a** | AMOE cutover (10/10 reconciliation) |
| **WS-2b** | • design approval (Rev 3 + Rev 4)<br>• PR<br>• schema (incl. registry, history tables, triggers)<br>• marker backfill (write)<br>• dual-write before M0<br>• baseline seed<br>• shadow M0 report (per entrant)<br>• cutover<br>• ≥1 month dual-write<br>• legacy retirement |
| **WS-3** | Phone, after WS-2b |
| **Part B** | Last |

**Remaining risks:**
1. **October** is drawn under legacy accounting. The limitations are accepted only through the run-book.
2. **The 72 h window** depends on someone acting. A missed window needs a manual approved recovery; the integrity alert covers detection.
3. **The mocked race test** isn't a real-DB proof until D11. The unique constraint is the backstop.
4. **Reset inside the draw transaction** is a lock-heavy `updateMany` over all users (~hundreds of rows today, acceptable). Revisit at scale.
5. **Legacy semantics preserved by WS-2 that may be undesirable:** lapsed-streak tiers, the recurring referral-lifetime bonus, and AMOE for test/unverified accounts. These are decisions for Don and counsel, not engineering.
6. **Baseline activity days** carry the historical local/UTC key mix into M0 streak computation.

**Stop: READY FOR REVIEW.**
