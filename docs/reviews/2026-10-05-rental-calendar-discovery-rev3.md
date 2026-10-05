# Rental Calendar Discovery — Revision 3 Final Delta (C-ID2, C-LIFE2, C-REM2, phasing)

**Status: PLANNED — design only. READY FOR CHATGPT REVIEW.** No code, schema, native build, PR, infrastructure or production activity.

**Amends** Rev 2 (`docs/reviews/2026-10-05-rental-calendar-discovery-rev2.md`, `d7fd2f5`):
- C-ID2 amends Rev 2 §1 (scanner output) and §2.2–§2.4 (link model, matching, deletion);
- C-LIFE2 amends §3.2;
- C-REM2 amends §4;
- phasing and gates amend §5, §6 and §9.

Everything else in Rev 1/Rev 2 stands.

**Baseline:** `main` @ `9cf8e28`.

---

## 1. C-ID2 — Complete, verifiable scans and safe absence

### 1.1 Calendar reference (privacy-preserving)
Each scanned calendar gets two salted, on-device hashes. Hash function: `SHA-256(linkSalt ‖ kind ‖ value)`, where `linkSalt` is per user, from Rev 2 §2.1.

| Ref | iOS input | Android input | Scope |
|---|---|---|---|
| `calendarDeviceRef` | `EKCalendar.calendarIdentifier` | `Calendars._ID` | This device only |
| `calendarAccountRef` | `EKSource.sourceIdentifier` + `EKSource.sourceType` | `ACCOUNT_TYPE` + `ACCOUNT_NAME` + `Calendars._SYNC_ID` (if present) | Cross-device, when the account is the same |

- **Raw values never leave native code.** That includes `ACCOUNT_NAME`, which is often an email address.
- Only an enum `sourceType` (`icloud | exchange | google | caldav | local | subscribed | other`) is returned in clear.

**`RentalSourceLink` gains** (amending Rev 2 §2.2):

| Field | Purpose |
|---|---|
| `calendarDeviceRef` | Device-scoped source calendar |
| `calendarAccountRef` (nullable) | Cross-device source calendar |
| `sourceType` | Enum above |
| `refStrength` | `strong` (external id) or `weak` (device-local id) |
| `lastSeenScanId`, `lastSeenAt` | Last complete scan in which the event was present |
| `absentCompleteScans INT`, `firstAbsentAt` | Absence tracking (§1.4) |

### 1.2 Scan manifest: completeness is reported, never assumed
`scan()` (still parameterless) returns **events plus a manifest**:

```
manifest: {
  scanId, permission: 'full'|'denied'|'restricted'|'write_only'|'not_determined',
  windowFromMs, windowToMs,                      // the fixed native window actually queried
  calendars: [{ calendarDeviceRef, calendarAccountRef?, sourceType,
                readable: bool, eventQueryOk: bool }],
  matchedTotal,                                  // rental matches found BEFORE the 25-candidate cap
  returnedCount, truncated: bool,                // truncated = matchedTotal > returnedCount
  presence: [{ eventRef, calendarDeviceRef, refStrength }],  // ALL matched events, refs only, ≤ 500
  presenceComplete: bool,                        // false if > 500 matches or any query error
  ambiguousRefs: [eventRef],                     // same ref seen on >1 event in this scan
  errors: [code]                                 // enum codes only
}
```

- The **25-candidate cap** limits detail records (titles, locations) only.
- The `presence` list carries **salted refs of every matched event** (no text), so presence checks don't depend on the cap.
- If presence itself can't be complete (> 500 matches, a query error, or an unreadable calendar), the manifest says so, and **no negative conclusion is drawn from that scan**.

### 1.3 Identifier hazards

| Hazard | Rule |
|---|---|
| **Duplicate external ids.** The same invitation can appear in two calendars. iOS `calendarItemExternalIdentifier` can repeat. Android `_SYNC_ID` is unique only within a calendar. | The external ref is `hash(calendarAccountRef ‖ externalId)`, scoped to its calendar. If one ref matches more than one event in a scan → it goes in `ambiguousRefs`, and is not used for automatic linking, change prompts or absence. The user picks. |
| **Unstable device-local ids.** iOS `eventIdentifier` can change after sync. Android `_ID` changes on re-sync or account re-add. | These are `weak` links. They may **suggest** a link (the user confirms). They **never** support absence or change prompts by themselves. If a weak link stops matching, it shows as "unlinked", never "cancelled". |
| **Recurring events** | Still excluded in native code (Rev 2 §1). |
| **Cross-device** | Absence is evaluated only against scans whose `calendarAccountRef`, or for weak links whose `calendarDeviceRef`, matches the link. A phone without that account says nothing about it. |

### 1.4 Absence (the only path to "no longer in your calendar?")
**All** of these must hold:
1. The link is `strong` and its ref is **not** in `ambiguousRefs`, now or at link time.
2. **Two consecutive complete scans, at least 24 h apart,** each with:
   - `permission='full'`;
   - `presenceComplete=true`;
   - the link's calendar present with `readable && eventQueryOk`;
   - the ref absent from `presence`.
3. The rental's last-seen event start and end both lie inside the window with **≥ 24 h margin** at both scans, so an event that simply aged out of the window isn't treated as missing.
4. The linked rental is `active`.

When those hold, the user sees the Rev 2 prompt (*Keep* / *I cancelled it* / *Delete*). **The prompt is the only consequence.** Any unmet condition means `absentCompleteScans` is not incremented. A later presence resets it.

**Tests (pure TS, with synthetic manifests):**
- truncated scan;
- presence incomplete;
- permission downgraded to write-only;
- calendar missing or unreadable;
- account removed;
- duplicate ref;
- weak link only;
- event aged out of the window;
- a single absent scan;
- two scans < 24 h apart;
- two valid scans → prompt.

---

## 2. C-LIFE2 — Schedule validation precedes time-based states

### 2.1 Validation (pure, `lib/rentalCalculations.ts`)
`classifyRentalSchedule(input)` returns one of:

| Class | Condition |
|---|---|
| `invalid` | A supplied time (UTC, or legacy local fallback) is **present but unparseable**, or a supplied zone is not a valid IANA zone (existing `isValidIanaZone`) |
| `inconsistent` | Both instants known and `returnAt ≤ pickupAt` |
| `implausible` | Both known and the duration exceeds 366 days |
| `ok` | Otherwise. Absent times are **not** invalid; they're "unknown" |

### 2.2 Precedence (replaces Rev 2 §3.2; first match wins)

| # | Condition | State |
|---|---|---|
| 1 | `status = completed` | `completed` |
| 2 | `status = cancelled` | `cancelled` |
| **3** | **schedule ∈ {invalid, inconsistent, implausible}** | **`needs_schedule`** |
| 4 | `returnAt` known ∧ `now ≥ returnAt + 72 h` | `stale` |
| 5 | `returnAt` known ∧ `now ≥ returnAt` | `overdue` |
| 6 | `pickupAt` known ∧ `now < pickupAt − 3 h` | `upcoming` |
| 7 | `pickupAt` known ∧ `now < pickupAt` ∧ `setupComplete` | `upcoming` (ready) |
| 8 | `pickupAt` known ∧ `now < pickupAt + 6 h` ∧ `¬setupComplete` | `pickup` |
| 9 | `returnAt` known ∧ `now ≥ returnAt − 24 h` | `near_return` |
| 10 | otherwise | `active` |

**`needs_schedule` behaviour:**
- **UI:** shows "Check your pickup and return times" with an *Edit* action. Return-prep tools stay reachable but aren't promoted.
- **Excluded from:**
  - auto-open;
  - primary-rental selection;
  - overdue/stale prompts;
  - the C1 duplicate pickup-window soft match (company and confirmation # matching still applies).
- **Reminders (R1):** obligations aren't enqueued for an invalid event. A legacy row's reconciliation reports it as `skipped_invalid_schedule`.

**Added boundary tests:**
- unparseable UTC with a valid local;
- an invalid zone;
- `return = pickup` exactly;
- `return = pickup − 1 ms`;
- duration of 366 days vs 366 days + 1 ms;
- pickup known with return malformed;
- legacy row with no UTC and a local-only fallback;
- `needs_schedule` never auto-opens, even inside a would-be pickup window;
- an edit fixing the times immediately restores normal states.

---

## 3. C-REM2 — Durable reminder obligations

### 3.1 Current providers (verified at `9cf8e28`)

**Email** — `lib/email.ts` `sendMail`:
- It tries **SMTP / nodemailer first** (if `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` are set), then Resend, then a **dev fallback that only logs and returns success**.
- The file header says "Resend first", which contradicts the code. Which provider production uses is **not checked here**, because that would need a gated read-only env-name check.

**Push:**
- `lib/userPush.ts` `sendUserPush` calls OneSignal (web and Android, `include_aliases.external_id`) and APNs (iOS `iosPushToken`, both prod and sandbox hosts).
- It returns **one boolean** — true if *either* provider accepted.
- OneSignal "accepted" means the response has no `errors` field.

**Consequences:**
- a provider failure is invisible whenever the other provider succeeds;
- an unconfigured email setup looks like success.

### 3.2 Obligations are durable data, not cron side effects
- **Channels** become separate rows, one per (rental, kind, eventAt, channel):
  - `email`
  - `push_onesignal`
  - `push_apns` (only when the user has an iOS token)
- **Kinds and windows:**

  | Kind | Window |
  |---|---|
  | `pickup24` | 20–26 h before pickup |
  | `pickup2` | 0–3 h before pickup |
  | `return2` | 0–3 h before return |
  | `returnDue` | 0–36 h before return |
  | `overdue` (later, C1n) | from the moment the return time passes |

  Each row stores `dueFrom` and `dueUntil`, and a per-kind **late policy**: `send_late_until` = the event instant minus a minimum lead.
  - `pickup24` may go out late while pickup is still ≥ 3 h away.
  - `pickup2` and `return2` may go out late until the event instant.
  - `returnDue` may go out late until 2 h before return.
- **Enqueue happens at write time.** Create, schedule-changing `PATCH`, and user cancel/complete run in the same transaction as the rental write:
  - insert all future obligations with `state='pending'` (`ON CONFLICT DO NOTHING` on `(rentalSessionId, kind, channel, eventAt)`);
  - mark obligations for a superseded `eventAt` as `superseded`;
  - mark all obligations for a completed or cancelled rental as `cancelled`.
  - **So an obligation exists in the database even if no cron ever runs.**
- **Reconciliation on every cron run, and on restart.** For every `active` rental with a valid schedule and `eventAt ∈ [now − 7 d, now + 48 h]`, compute the expected obligations and insert missing ones. This repairs anything missed by a crash between rental write and enqueue, or written by legacy code paths.
- **Processing, per due row:**
  1. **Claim** with a lease (Rev 2 §4.2).
  2. **Classify the provider result:**

     | Result | State |
     |---|---|
     | `accepted` | `sent` (+ `providerRef`) |
     | `no_recipient` (OneSignal "not subscribed"; no iOS token) | `skipped` |
     | `unconfigured` (dev fallback, missing APNs or OneSignal env) | `skipped_unconfigured` |
     | `retryable` (SMTP 4xx, Resend 429/5xx, OneSignal 429/5xx, APNs 429/500/503, network) | `failed_retryable`, retried next run while `now ≤ send_late_until` and `attempts < 5` |
     | `permanent` (SMTP 5xx, Resend 4xx except 429, APNs `BadDeviceToken` from both hosts / `Unregistered`) | `failed_permanent` |

     This needs per-provider result types from `sendMail` and `sendUserPush`, with no change to other callers: new `…Detailed()` variants, while the existing functions keep their signatures.
  3. **Missed:** `now > send_late_until` and not sent → `missed_window`, with the reason (`never_claimed`, `retries_exhausted`, `outage`).
- **Restart recovery:** a crashed worker's lease expires after 5 min, and the next run reclaims the row. Attempts are counted, so nothing loops forever.

### 3.3 Detecting outages (including one spanning a whole window)
1. **Durable signal:** an obligation still `pending` or `failed_retryable` past `dueUntil` is queryable by **any** process. It doesn't depend on the reminder cron having run.
2. **Integrity findings** (daily integrity check; counts only, no PII):
   - `rental-reminder-missed`: rows that became `missed_window` or `failed_permanent` in the last 24 h, by kind and channel.
   - `rental-reminder-stuck`: rows `pending` past `dueUntil` that the reminder cron hasn't processed. This catches a whole-window cron outage.
   - `rental-reminder-unconfigured`: any `skipped_unconfigured` in production. This should never happen.
   - `rental-reminder-cron-heartbeat`: the reminder cron's last completed run, from a small `CronHeartbeat(name, lastCompletedAt)` row, is older than 3 h.
   - None of these fire on expected state: future `pending` rows are normal.
3. **Limitation:** if GitHub Actions is down entirely, the daily integrity check doesn't run either. Coverage then relies on GitHub's own workflow-failure emails. An external uptime check of the heartbeat (e.g. a monitoring endpoint) is an **optional infrastructure decision**, gated separately.

### 3.4 Provider idempotency: limits, stated honestly
At-least-once delivery remains. A crash after a provider accepts but before `sent` is written can still duplicate.

| Provider | Server-side dedup | Plan |
|---|---|---|
| SMTP (nodemailer / Gmail) | **None** | Accept a rare duplicate. Set a deterministic `Message-ID: <rental-reminder-<deliveryId>@gascap.app>`; whether Gmail suppresses the repeat is **unverified**, so it isn't relied on. |
| Resend | An idempotency-key header is documented. **Verify the current contract** (header name, window, behaviour on payload mismatch) before relying on it. | Key = delivery `id`, used only if verified. |
| OneSignal | An idempotency key on create-notification is documented. **Verify the current field name and window.** | Key = delivery `id`, used only if verified. |
| APNs | **None server-side.** `apns-collapse-id` (≤ 64 bytes) replaces a duplicate on the device, so the user sees one. | `rental-<rentalId>-<kind>`. Both hosts keep the existing prod+sandbox design. |

Per the CLAUDE.md provider-contract rule:
- mocks must use current official sample payloads;
- tests must cover each provider's accepted, no-recipient and error shapes;
- read-only smoke checks must happen before first production reliance, where practical.

### 3.5 Transition from the `*SentAt` columns
- During R1, the cron writes both delivery rows and the legacy `*SentAt` stamps.
- **Seeding the outbox:**
  - a `sent` row for any tier already stamped;
  - `pending` rows for future tiers;
  - this runs as a separately authorized, idempotent backfill script that prints before/after counts.
- Legacy columns are retired only in a later, separate change.

### 3.6 Phasing (accepted)
- **C1 proceeds independently of R1.** C1 adds **no new notification tier**; the overdue nudge (C1n) is deferred until R1 is live.
- **R1 is its own PR** (with schema: `RentalReminderDelivery` + `CronHeartbeat`).

---

## 4. C0 — Evidence-based commercial thresholds

Rev 2's "≥ 2 of 3 ecosystems" rule is withdrawn. The go/no-go now rests on **expected reach among GasCap's own rental users**, compared with the alternative, Part B (email).

### 4.1 Inputs
**C0d — read-only, aggregate production metrics** (new gate; counts only, no identifiers; `BEGIN TRANSACTION READ ONLY`):

| Variable | Meaning | Source |
|---|---|---|
| `R` | Users who created ≥ 1 rental in the last 90 / 180 days | `RentalSession` |
| `n` | Share of those users active on the **native** apps (`iosPushToken` present, or OneSignal Android platform if derivable) | User data. Calendar import is native-only |
| `b` | Share of rentals created **≥ 3 h before pickup** (booked ahead, i.e. a calendar could have known in advance) | `createdAt` vs `pickupDateTimeUtc` |
| `m_gmail`, `m_outlook`, `m_icloud`, `m_other` | Email-domain mix of `R`: gmail.com / outlook.com, hotmail.com, live.com / icloud.com, me.com / other. Proxy for the user's calendar ecosystem | User email domains, aggregated |

**C0a/C0b observations:** `p_e` = the observed probability that a rental booking appears in the calendar with a usable pickup time and company, per ecosystem `e`. Taken from the manual inventory and the device probe.

### 4.2 Reach estimate and decision rule

```
Calendar reach  ≈ R · n · b · Σ_e (m_e · p_e)
Email reach     ≈ R · b · f       (f = share of booked-ahead users willing to forward, assumed 0.3–0.5 until measured)
```

**Recommended thresholds** (Don sets the final numbers):
- **Build calendar import (C2/C3)** only if:
  - calendar reach is at least **25%** of `R·b` (booked-ahead rental users), **and**
  - it's projected at **≥ 25 users per quarter** at current growth;
  - **and** the native release cost is acceptable to Don.
- **Prefer Part B** if email reach exceeds calendar reach by more than 1.5×, or if calendar reach is under 10% of `R·b`.
- **Otherwise:** build C1 only, revisit when `R` grows, and keep manual quick-save.

Rationale: a native permission, release and store-review cost is justified only when it removes typing for a material share of the users who actually book ahead. Coverage of an ecosystem nobody in our user base uses has no value.

### 4.3 C0 steps (Rev 2 §6, amended)
1. **C0a** — desk + manual inventory. Unchanged.
2. **C0d** — new: the aggregate metrics above.
3. **C0b** — the dev-build probe now **only if** C0a + C0d leave the decision open, e.g. when reach hinges on whether Siri-suggested events are visible.
4. **C0c** — report with the reach calculation, sensitivity ranges for `p_e` and `f`, and a recommendation.

---

## 5. Recommended owner-authorization sequence

| Order | Gate | Authorizes | Depends on |
|---|---|---|---|
| 1 | **G0** | Accept the design (Rev 1 + Rev 2 + Rev 3) | — |
| 2 | **G-C1a** | C1 code PR: lifecycle with `needs_schedule` + precedence, auto-open, primary selection, user cancel, duplicate soft-warning, `clientRentalId` idempotency, help/AI/EN-ES. **No schema, no new notifications.** | G0 |
| 3 | **G-C0a** + **G-C0d** (in parallel with C1) | Desk research + manual inventory; read-only aggregate production metrics | G0 |
| 4 | **G-C1b** | C1 merge + deploy + production verification | G-C1a review |
| 5 | **G-R1a** | R1 outbox code PR (per-channel rows, lease claims, reconciliation, late policy, detailed provider results, integrity findings) | G0 |
| 6 | **G-R1b** | R1 schema (`RentalReminderDelivery`, `CronHeartbeat`, additive SQL) + read-only email-provider env-name check | G-R1a review |
| 7 | **G-R1c** | R1 merge/deploy + idempotent outbox seed backfill (prints before/after) | G-R1b |
| 8 | **G-C1n** | Overdue nudge as an R1 kind | G-R1c |
| 9 | **G-C0b** (only if needed) | Dev-build visibility probe | C0a/C0d results |
| 10 | **Decision D-CAL** | Calendar vs Part B, per §4.2 | C0c report |
| 11+ | **Calendar track:** G-PRE → G-C2 → G-C3a/b/c → G-SUB → G-C4. **Or Part B** under its own gates. | per Rev 2 §9 | D-CAL |

**Stop: READY FOR CHATGPT REVIEW.**
