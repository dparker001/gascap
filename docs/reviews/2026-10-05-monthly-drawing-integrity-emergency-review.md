# Monthly Drawing Integrity — Emergency Review (D7 / D8)

**Status: CURRENT findings + PLANNED options. READ-ONLY.** No production writes, no cron change, no draw rerun, no entrant contact, no rules change.
**Branch:** `audit/phone-verification-bonus` (local).
**Evidence:**
- `scripts/audit-draw-timing.mjs` (reads only; aggregates; run 2026-10-05, `transaction_read_only = on`);
- GitHub Actions run logs for `.github/workflows/crons.yml` (secrets and winner fields redacted);
- source at `main` @ `b7005f0`.

Labels: **[VERIFIED]** = observed in code, logs or DB. **[INFERRED]** = a reasoned risk. **[UNKNOWN]** = evidence missing.

---

## 1. The defect

**[VERIFIED] What the published rules say** (`app/sweepstakes-rules/page.tsx`):
- the Entry Month runs "12:00:00 AM Eastern Time on the first day … to 11:59:59 PM Eastern Time on the last day";
- "A new drawing is held at the end of each Entry Month";
- AMOE (free entry) is accepted "before 11:59:59 PM Eastern Time on the last day";
- one AMOE entry per person per Entry Month.

**[VERIFIED] What the implementation does:**
| Piece | Behaviour |
|---|---|
| Scheduler | `crons.yml` `cron: '50 23 * * *'` → `/api/cron/giveaway-draw`, via `curl -sf --max-time 30` |
| Guard | `isLastDayOfMonth()` on the **UTC** date |
| Period | `currentPeriod()` → `currentMonth()` = **UTC** month (`toISOString().slice(0,7)`) |
| AMOE tagging | `app/api/amoe/route.ts` sets `month = currentMonth()`, the **UTC** month at submission; the one-per-month limit uses it too |
| Activity day keys | the device-local date when the client sends `localDate` (most UI paths), else the **UTC** date (`todayStr()`) |
| Reset | `resetPeriodBonusEntries()` zeroes 7 counters for all users immediately after `recordDraw()` |
| "Pause" | `GIVEAWAY_PAUSED` (currently `false`) only silences an integrity alert. **Nothing pauses the automated draw.** |

**[VERIFIED] Why the delayed job drew early.**
- The resolve step maps `github.event.schedule == "50 23 * * *"` to `giveaway-draw`, whenever the run actually starts. GitHub delays scheduled runs under load.
- **August:** run `33348254576`, scheduled 2026-08-30 23:50Z, started **2026-08-31 01:39:37Z**. Its response: `"ok":true,"period":"2026-08"`, recorded `drawnAt 01:39:41Z` (**Aug 30, 9:39 PM EDT**).
- **September:** run `36659883601`, scheduled 2026-09-29 23:50Z, started **2026-09-30 02:26:52Z**. Its response: `"period":"2026-09"`, `drawnAt 02:26:57Z` (**Sep 29, 10:26 PM EDT**).
- In both cases the delayed run fell on the last **UTC** day, so the guard passed. By the time the on-time run on the true last day arrived, the period already had a draw (idempotent skip).

**[VERIFIED] It will recur unless changed.**
- Every month, any previous-day job delayed past 00:00Z draws about 26 hours early.
- Even with no delay, the last-day run at 23:50Z is **7:50 PM EDT / 6:50 PM EST**, 4–5 hours before the published close.
- **Oct 31** is at risk either way. DST ends Nov 1 at 2:00 AM: Oct 31 is EDT, and the Oct close is **2026-11-01 03:59:59Z**.

## 2. Historical impact assessment (Aug, Sep) — read-only, aggregates

| | August 2026 | September 2026 |
|---|---|---|
| Published close (ET) | Aug 31 11:59:59 PM EDT = **2026-09-01 03:59:59Z** | Sep 30 11:59:59 PM EDT = **2026-10-01 03:59:59Z** |
| Actual draw / snapshot | **2026-08-31 01:39:41Z** (snapshot ≈ same request, ≤1s earlier) | **2026-09-30 02:26:57Z** |
| Early by | ~26h 20m | ~25h 33m |
| Stored totals | winner 16 of **3,079** entries | winner 24 of **159** entries |

1. **AMOE submissions after the draw but before the cutoff.** From the **Postgres mirror** only:
   - **0** tagged with the drawn month and submitted after the draw (these would never be drawn);
   - **0** submitted before the ET close but tagged with the next UTC month (these would be misattributed).

   The mirror holds only **2 AMOE entries ever** (both `2026-09`). **[UNKNOWN]** The authoritative store is `data/amoe-entries.json` on the Railway volume, which can't be read from this environment. The mirror is best-effort, so the file count must be confirmed (§2.7).
2. **Activity and achievement entries in the window.**
   - **Base (activity-day) entries [INFERRED]:** activity on the final day after the draw was not in that month's draw, and it never counts toward the next month either (its day key carries the old month). Today's 10-user draw pool has **1** user with a last-day key and **2** with a next-month day-1 key, in each month. Pool membership and plans have changed since, so this is an approximation.
   - **Achievement counters [VERIFIED by code]:** daily gift, price reports, gig logs, first calc, streak milestones, email verify and phone. Increments after the draw survived (the reset ran *at* the draw), so they were **counted in the following month's draw** instead. They were misattributed, not lost.
   - **Lifetime / referral bonuses** are computed per period and are unaffected.
3. **Could the excluded entries have changed probabilities? [INFERRED]**
   - **August:** at most a few base entries (one day × multiplier) for 1–2 users, against 3,079. That's under a 0.1-point change in any user's odds.
   - **September:** a few entries against 159, up to roughly a 0.6–3-point change for an affected user, depending on the multiplier.
   - AMOE: none known from the mirror (the file is unknown).
   - The outcomes could theoretically differ, so the probability distribution was not the one the rules describe.
4. **Is the original pool reconstructible? Partially. [UNKNOWN for bonuses]**
   - `activeDays` are retained, so base entries can be approximated, but multipliers depend on referral counts *at the time*.
   - The bonus counters were **zeroed**, so they can't be reconstructed.
   - `GiveawayDraw` stores only the winner's count and the total.
   - No per-entrant snapshot exists (this is also D8: the alternate-winner flow recomputes after the reset).
5. **Missing evidence:**
   - the AMOE file;
   - per-entrant weights at draw time;
   - the time-of-day of activity (day keys only);
   - the counter values before the resets;
   - which UI path (local date vs UTC) recorded each day.
6. **For counsel:**
   - (a) Aug and Sep drawings held before the published Entry Month closed;
   - (b) late-window entries excluded or misattributed;
   - (c) AMOE month tagged in UTC and the one-per-month limit in UTC;
   - (d) achievement bonuses that are counted but not disclosed in the rules (see the phone design, D6);
   - (e) April and May draws, which predate the reset, so one-time bonuses kept counting in later draws;
   - (f) whether any notice, re-draw or other remedy is appropriate. That's a legal decision; no action is taken here.
7. **Read-only follow-ups needing Don** (not run):
   - confirm the AMOE file's late-window counts from inside the container (e.g. a `railway ssh` read-only count by `month` and `submittedAt`);
   - optionally, per-entrant reconstruction for counsel (PII, so Don authorizes).

## 3. October 31: minimal, safe operational plan (needs Don's authorization; small code)
There is **no existing pause**, so a purely operational fix isn't possible without disabling *all* crons (the GitHub "disable workflow" switch stops every job). The minimal option is two tiny, independently reviewable changes:

**O-1. A real, fail-safe auto-draw switch.** In `/api/cron/giveaway-draw`, return `skipped` when `GIVEAWAY_AUTO_DRAW !== 'on'`.
- Missing or any other value means **no automated draw**, i.e. **fail closed**.
- The integrity "draw missing" alert keeps keying on `GIVEAWAY_PAUSED`.
- Tests cover off, on and missing.
- Deploy well before Oct 30. Don leaves `GIVEAWAY_AUTO_DRAW` unset.

**O-2. AMOE month in ET.** `app/api/amoe/route.ts` tags `month` with the **America/New_York** calendar month, and applies the one-per-month limit on it. A small pure helper with DST-boundary tests. This makes Oct 31 8:00–11:59 PM ET submissions count for October.

**Run-book (Don, via admin panel):**
1. **Before Oct 30, 7 PM ET:** confirm the switch is off (cron run logs show `skipped`).
2. **Nov 1, after 12:00:30 AM EDT** (≥ 04:00:30Z):
   - run the **admin draw with `month = "2026-10"` explicitly** (the admin default is the *UTC* month, which would be `2026-11`);
   - dry run first (it consumes nothing), then record with **hold-and-verify** (emails held).
3. **Then:**
   - verify the winner and release the emails through the existing action;
   - archive the dry-run and record outputs for counsel.

**Residuals for Oct 31 under this plan:**
- **Activity:** final-evening activity recorded under a UTC fallback date (`2026-11-01`) still misses October. Most UI paths send the local date, so the impact is small. Documented for counsel.
- **Bonus counters:** increments between ET midnight and the manual draw (minutes) are counted in October, then reset. Minimize the gap by drawing promptly after 12:00:30 AM.
- **AMOE:** remains file-primary; there's no DB lock (documented).

## 4. Durable plan (separate workstream, separately reviewed)
1. **Period = the closed ET Entry Month.** `closedEntryMonthET(now)` returns the month whose close (11:59:59 PM ET, last day) has passed and has no draw yet. The scheduler runs at **05:10 UTC daily**, which is after the ET close in both EDT (04:00Z) and EST (05:00Z). It draws only when `closedEntryMonthET` has no draw. A delayed run can only be **later**, never earlier. `force` is admin-only, with an explicit month.
2. **ET-consistent attribution:**
   - AMOE month in ET (O-2);
   - activity day keys always in the ET calendar day (or keep the local date, but derive the period with an ET-aware rule);
   - `currentMonth()` callers that define *entry periods* move to ET; other UTC uses stay.
3. **Per-entrant snapshot + decrement reset (resolves the reset-erasure race and D8):**
   - inside the draw transaction, write `GiveawayDrawEntrant(drawId, entrantKey, entryCount, breakdown)` for every entrant;
   - "reset" becomes `counter = counter − snapshotted amount` per user, instead of zeroing everyone.
   - Contributions made after the snapshot (e.g. new-month activity after ET midnight, or a phone grant) **survive** and count next month.
   - The alternate-winner flow reuses the **stored** weights (fixes D8).
4. **One draw transaction** for cron and admin, as in phone design Rev 3 §2:
   - `month @unique` plus a recheck inside the transaction; a retry can't draw or decrement twice;
   - the snapshot and the decrement commit together, or neither does.
5. **Notifications outbox:** `GiveawayDraw.notificationsSentAt` (or an outbox row). Notifications are sent after commit and are retry-safe (a committed draw followed by a notification failure gets retried without a re-draw).
6. **HTTP timeout:** the endpoint commits within seconds. If curl's 30s timeout fires after commit, the next run hits the idempotent skip, and the outbox completes the notifications.
7. **Tests:**
   - ET/UTC boundaries (Oct 31 23:59:59 EDT = 03:59:59Z; Nov 30 23:59:59 EST = 04:59:59Z; the DST transition day, Nov 1 01:00–02:00 repeated);
   - delayed-run simulation;
   - retry idempotency;
   - AMOE late-evening tagging;
   - snapshot and decrement correctness;
   - an alternate draw using the stored weights;
   - a real-Postgres transaction test (CI Postgres service: an infra change needing approval).
8. **Schema:** `GiveawayDrawEntrant` table (new) and `GiveawayDraw.notificationsSentAt`. Both need separate production authorization.

## 5. Decisions for Don
- **D7a:** approve O-1 + O-2 for Oct 31 (or another operational choice), plus the run-book above.
- **D7b:** approve the durable plan (§4) as its own workstream, ahead of the phone-bonus implementation (they share the draw transaction).
- **D7c:** counsel review of Aug/Sep (§2.6); confirm the AMOE file counts (§2.7).
- **D8:** stored-snapshot weights for alternate winners (part of §4.3).

**Stop: READY FOR REVIEW.**
