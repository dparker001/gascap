# Rental Calendar Discovery — Revision 2 Decision Packet (C-SEC1, C-ID1, C-LIFE1, C-REM1)

**Status: PLANNED — design only. READY FOR CHATGPT REVIEW.** No code, schema, native build, configuration, production access, PR or implementation.

**Amends:** `docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md` (Rev 1, `32cd843`). This packet **supersedes** Rev 1 §2.2 (scanner), §3 steps 4–8 (identity and rescans), §4 (lifecycle, auto-open, notifications), §5.3–5.4 (data model and duplicates), and §8 (phases).

**Unchanged:** the rest of Rev 1, and the approved direction:
- custom read-only native scanner;
- on-device, never-guess extraction;
- user confirmation through the existing Quick-Save path;
- C0 runs before any native work.

**Baseline:** `main` @ `9cf8e28`.

**Preserved:**
- `RentalSession` gets **no new columns** in C1 or C3.
- Timezone and DST handling: `lib/rentalTimezone.ts`.
- The Pro gate on create only (`getLivePlan`).
- Every reservation is confirmed by the user through Quick-Save.

---

## 1. C-SEC1 — The native privacy boundary

**Principle:** remotely served JavaScript is **untrusted** with respect to calendar data. Everything that limits exposure is compiled into the native binary, and JS cannot widen it.

| Control | Enforced in native code (Swift / Kotlin) | What JS can do |
|---|---|---|
| Scan window | Fixed: **now − 2 days … now + 120 days**. Constants in the binary. | Nothing. `scan()` takes **no window, keyword or query parameters**. |
| Matching | A compiled-in rental dictionary: company names, company email domains (`@hertz.com` …), and phrases ("car rental", "rental car", "pick-up", "drop-off", "reservation", in EN/ES). An event qualifies only if a **company** match plus a rental phrase, or a company-domain organizer, appears in title, location or organizer. | Can only **narrow** results in JS (hide), never widen. A dictionary change ships in a new binary. |
| Exclusions | Recurring events (`hasRecurrenceRules` / Android `RRULE` / `RDATE` set), declined events, and birthday/holiday calendars. | — |
| Output allowlist | `eventRef` (salted hash, §2), `calendarRef` (salted hash), `refKind`, `company` (an **enum**, not raw text), `titleExcerpt` (≤ 80 chars), `location` (≤ 160 chars), `startMs`, `endMs`, `startZone`, `endZone`, `isAllDay`, `confirmationCandidate`. | Nothing else exists to request. |
| Description handling | **No description text leaves native code.** Native looks for a labelled code (`Confirmation`, `Conf #`, `Reservation #`, `Confirmación`) and returns only that code: 5–20 chars, `[A-Z0-9-]`, and never a value that looks like a phone number or flight number. | Receives only `confirmationCandidate` or null. |
| Never returned | Organizer/attendee emails or names, URLs, notes, calendar names, account names, alarms, availability, non-matching events. | — |
| Volume | At most 25 events per scan; at most 1 scan per 60 s. Native refuses beyond these. | — |
| User intent | **A native confirmation sheet** ("Search your calendar for rental-car reservations?") appears before the **first scan of each app session**. Web JS can't render or bypass it. A silent background scan from compromised web code is therefore impossible without a native tap. | Can only call `scan()`, which triggers the sheet. |
| Permissions | iOS: `NSCalendarsFullAccessUsageDescription` (17+), `NSCalendarsUsageDescription` (≤16), via `requestFullAccessToEvents`; no write key. Android: **`READ_CALENDAR` only**; the merged manifest is verified to contain no `WRITE_CALENDAR`. | `checkPermission()`, `requestPermission()` (shows the OS prompt), `openAppSettings()`. |
| No network | The plugin makes no network calls and has no logging of event data (debug builds log counts only). | — |

**Release preconditions** (both outstanding today):
1. `webContentsDebuggingEnabled: false` in release builds, on both platforms.
2. The iOS push-tap handler routes through `safeInternalPath`.

**Permission behaviour to verify (C0b / C2 device matrix):**
- **iOS 17/18:** the full-access prompt; denial and re-request (iOS shows the prompt once, after which only the Settings deep link works); a revoke in Settings is detected on resume; a ≤16 device prompts with the legacy key.
- **Android 13/14/15:** the runtime prompt; "Don't allow" twice puts the app in permanently-denied state (Settings deep link); permission auto-reset for unused apps; work-profile calendars are not visible.

**Disclosures:**
- **In-app:** an explainer before the OS prompt. This doubles as Play's "prominent disclosure".
- **Purpose strings:** EN; ES via `InfoPlist.strings` if localized builds are adopted.
- **Privacy Policy:** a section added.
- **App Store privacy label:** calendar data processed only on the device is not "collected". The fields the user confirms are transmitted, so declare conservatively: *User Content → Other*, linked to the user, app functionality.
- **Play Data safety:** declare **Calendar events** (collected, optional, app functionality, not shared).
- **Counsel/Don confirm** both store declarations.

---

## 2. C-ID1 — Stable reservation identity

Rev 1's `eventKey = hash(eventId + start time)` is withdrawn: a rescheduled pickup would have looked like a new reservation.

### 2.1 Three separate identities

| Identity | Built from | Stability | Used for |
|---|---|---|---|
| **Reservation key** | `company` + normalized confirmation # (upper-case, alphanumerics only), **when both exist** | Survives date/time and location changes, devices, sources (calendar *and* email) | Recognising "same booking" anywhere |
| **External event ref** | iOS `calendarItemExternalIdentifier`; Android `_SYNC_ID`, else `UID_2445` | Stable across devices for synced accounts (iCloud, Google, Exchange); **never includes start time** | Linking a calendar event to a saved rental on any device |
| **Device-local event ref** | iOS `eventIdentifier`; Android `Events._ID`, used only when no external id exists | This device only | Rescans on the same device |

- **Hashing:** every ref is hashed **on device** as `SHA-256(linkSalt ‖ refKind ‖ value)`. `linkSalt = HMAC(RENTAL_LINK_KEY, userId)` is fetched from the server once per sign-in.
- Raw identifiers never leave the phone, and hashes can't be correlated across users.
- Device-local refs also carry `deviceRef` (a salted hash of a random per-install id) so they're only compared on that install.

### 2.2 Storage: a link table, not `RentalSession` columns (C3 schema, separately authorized)

```
RentalSourceLink(
  id, userId, rentalSessionId,                 -- FK-like, onDelete cascade with the rental
  source        'calendar' | 'email',
  refKind       'reservation' | 'external' | 'device_local' | 'email_delivery',
  refHash       TEXT,  deviceRef TEXT NULL,
  fieldHashes   JSONB  -- per-field salted hashes of the CALENDAR's values when last confirmed
                       --   {company, confirmation, pickupAt, returnAt, pickupLoc, returnLoc}
  linkState     'present' | 'missing' | 'dismissed',
  lastSeenAt, createdAt,
  UNIQUE (userId, source, refKind, refHash, COALESCE(deviceRef,''))
)
```

- **One rental can have several links:**
  - the same booking in Outlook and in iCloud;
  - a phone and a tablet;
  - calendar plus a forwarded email.
- **No calendar text is stored.** `fieldHashes` lets a later scan tell **which** calendar field changed, without storing the value. The new value is on the device and the old value is the rental itself.

### 2.3 Matching on every scan (deterministic order)
1. **Recurring events are never imported.** They're excluded in native code (§1).
2. **External or device-local ref already linked:**
   - compare the candidate's field hashes against `fieldHashes`, **not** against the rental. A field the user deliberately edited in GasCap therefore doesn't trigger a prompt; only a change in the *calendar* does;
   - changed → show a "Your calendar changed" card: field-by-field old (rental) vs new (calendar), with *Update rental* / *Keep mine*;
   - *Update* goes through the existing `PATCH`, so the existing tz/DST resolution and reminder-stamp resets apply;
   - *Keep mine* stores the new field hashes so the same change isn't asked about again.
3. **Reservation key matches a saved active rental, but the event isn't linked:**
   - "This looks like your saved Hertz booking — link it?" **The user confirms the link.** Then step 2 applies.
   - This covers cross-device, cross-calendar and a calendar event for an emailed booking.
4. **Soft match** (same company, and pickup within ±36 h, and no conflicting confirmation #): "Possible duplicate" with *Link* / *Save as new* / *Ignore*.
5. **Otherwise** → a new candidate.
6. **Ignore** writes a `dismissed` link when the user is signed in (so it holds across devices for external refs). Otherwise it's device-local.

### 2.4 Deletion and cancellation
A link becomes `missing` only if **all** of these hold:
- the scan completed with permission;
- the link's `calendarRef` was seen in this scan (the calendar still exists and is synced);
- the event is absent;
- the rental's pickup or return is inside the scan window;
- for a device-local link, it's the same `deviceRef`.

Then show "This booking is no longer in your calendar — still renting?":
- *Keep* → the link stays `missing`, with no further prompts;
- *I cancelled it* → the user-cancel action (§3.5);
- *Delete*.

**Never automatic.** Permission revoked, account removed or a calendar that wasn't seen → **no conclusion** is drawn.

### 2.5 Duplicate prevention for all sources (C1: no schema)
- **Soft warning on create.** Server-side query on the existing columns: same user, `status='active'`, and either `lower(trim(rentalCompany))` + normalized `rentalConfirmationNumber` match, or the company matches and the pickup is within ±36 h. The response is `409 possible_duplicate {rentalId}`; *Save anyway* retries with `confirmDuplicate: true`.
- **Retry idempotency, with no schema change.** The client sends a UUIDv4 `clientRentalId`, and create uses it as `RentalSession.id`.
  - If the id already exists **for the same user**, return that row (200, `replayed: true`).
  - If it exists for another user, return 409.
  - The server validates UUIDv4 format. This closes the acknowledged retry duplicate (`lib/rentalSessions.ts:313-319`).
- **Hard uniqueness** for calendar and email refs comes in C3 via `RentalSourceLink`'s unique key.

---

## 3. C-LIFE1 — Lifecycle precedence and auto-open

### 3.1 Inputs
- `status`
- `pickupAt` / `returnAt`: the UTC instants (the existing `rentalEventInstant` preference); each may be **unknown**
- `setupComplete` (`!setupIncomplete()`, which already exists)
- `now`

**Constants:** `PICKUP_LEAD = 3 h`, `PICKUP_TAIL = 6 h`, `NEAR_RETURN = 24 h` (existing), `STALE_AFTER = 72 h`.

### 3.2 Exact precedence (first match wins)

| # | Condition | State |
|---|---|---|
| 1 | `status = completed` | `completed` |
| 2 | `status = cancelled` | `cancelled` |
| 3 | `returnAt` known ∧ `now ≥ returnAt + 72 h` | `stale` |
| 4 | `returnAt` known ∧ `now ≥ returnAt` | `overdue` |
| 5 | `pickupAt` known ∧ `now < pickupAt − 3 h` | `upcoming` |
| 6 | `pickupAt` known ∧ `now < pickupAt` ∧ `setupComplete` | `upcoming` (ready) |
| 7 | `pickupAt` known ∧ `now < pickupAt + 6 h` ∧ `¬setupComplete` | `pickup` |
| 8 | `returnAt` known ∧ `now ≥ returnAt − 24 h` | `near_return` |
| 9 | otherwise | `active` |

**Consequences, stated explicitly:**
- **Setup completed before pickup:** stays `upcoming` (rule 6), then `active` / `near_return` at pickup. The "at the counter" card is never shown because it isn't needed.
- **Short rentals** (return < pickup + 24 h): rule 7 shows `pickup` until setup is done or 6 h have passed, because the return calculation needs pickup fuel. After that it's `near_return`. **Rules 3–4 outrank `pickup`**, so a short rental whose return has passed is `overdue` even if setup was never done.
- **Overdue keeps the return-preparation experience.** Today's deliberate decision (`rentalCalculations.ts:519-526`) keeps Find Gas Near Return and Final Fill-Up front and center. `overdue` keeps those sections in `near_return`'s order and **adds** a "Did you return it?" prompt.
- **Stale:**
  - prompt: *Complete* / *Still have it* (edit return) / *I didn't take this rental* (cancel, §3.5) / *Delete*;
  - excluded from banners, auto-open and the "primary rental" choice;
  - **never auto-completed or auto-cancelled.**
- **Unknown times:**
  - no `pickupAt` → rules 5–7 skip (today's rule: "no pickup counts as started");
  - no `returnAt` → rules 3, 4 and 8 skip → `active`, with "Return time not set";
  - nothing is invented.
- **Inconsistent times** (`returnAt ≤ pickupAt`): state `active` plus a `timeIssue` flag ("Check your pickup and return times"). This mirrors server validation and never derives overdue from bad data.
- **Rescheduled rentals:** the state is recomputed from the current times on every render, so an edit moves the rental to the right state immediately. Auto-open once-flags include `pickupAt` (§3.3), so a moved pickup can open once more.
- **Expired reservations** (quick-saved, never picked up, never set up): they pass through `pickup` (≤ 6 h) → `active` / `near_return` → `overdue` → `stale`. The `stale` prompt offers *I didn't take this rental*. Nothing changes without the user.

**Regression tests** (required by CLAUDE.md for rental logic):
- every rule boundary at exactly −1 ms / 0 / +1 ms;
- short rentals (2 h, 23 h);
- setup done before, during and after the pickup window;
- each unknown-time combination;
- inverted times;
- pickup times inside the DST repeated or skipped hour, in New York and London;
- a reschedule.

### 3.3 Auto-open (opt-in, predictable, non-intrusive)
- **Setting:** "Open my rental when it's time to pick it up". **Off by default**, stored **on the device** (`localStorage`), so C1 needs no schema change. It's a device behaviour.
- **Fires only when all of these hold:**
  1. it's a cold start or resume after ≥ 5 min in the background, **and** the current route is home or the calculator — never mid-form or mid-checkout;
  2. **exactly one** rental is in state `pickup`;
  3. the once-flag `gc_rental_autoopen:<id>:<pickupAt>` is not set.

  Then it routes to `/rental-return/<id>` and sets the flag.
- **On the opened screen:** a dismissible header, "Opened automatically at pickup · Turn off".
- **Never:**
  - for `upcoming`, `active`, `near_return`, `overdue` or `stale`;
  - when more than one rental is in `pickup`. Instead, show a non-modal banner: "2 rentals are at pickup — choose one";
  - changes `userMode`, any rental data, or fuel readings.
- **App closed:** the existing `pickup2` push is the path. No background work.

### 3.4 Selecting the "primary" rental (banner and overlap)
- **Priority:** `overdue` > `pickup` > `near_return` > `active` > `upcoming`. `stale`, `completed` and `cancelled` are excluded.
- **Ties:** earliest relevant instant (return for `overdue` / `near_return`, pickup otherwise).
- This replaces the current "first in-progress else soonest upcoming" heuristic with a deterministic rule that has its own tests.

### 3.5 User cancel (C1, no schema)
- `POST /api/rental-sessions/[id]/cancel` → `status='cancelled'`.
- Owner-scoped, idempotent, **not Pro-gated** (it's finishing, not starting).
- Offered only from the `stale` prompt and the "no longer in calendar" prompt, plus the rental's menu.

---

## 4. C-REM1 — Reliable reminder delivery

### 4.1 Current behaviour (`app/api/cron/rental-return-reminder/route.ts:206-262`)
For each job, the cron runs `sendMail` → `sendUserPush(...).catch(()=>{})` → stamps `*SentAt`. That gives:
- **Duplicate sends:** two overlapping runs, or a crash after send but before stamp.
- **Silent loss:**
  - push failures are swallowed, and the email success then stamps the tier;
  - when the email fails, the row stays unstamped and is retried next hour. But **tier windows are narrow (0–3 h)**, so after ~3 failed hours the reminder silently never arrives.
- **No record** of what was attempted.

### 4.2 Recommendation: a per-channel delivery outbox with lease-based claims

```
RentalReminderDelivery(
  id, rentalSessionId, userId,
  kind          'pickup24'|'pickup2'|'return2'|'returnDue'|'overdue',
  channel       'email' | 'push',
  eventAt       TEXT   -- the pickup/return UTC instant this reminder is for
  dueFrom, dueUntil    -- tier window (dueUntil = last useful moment)
  state         'pending'|'claimed'|'sent'|'failed_retryable'|'expired_unsent'|'superseded'|'skipped',
  attempts INT, leaseUntil, lastErrorCode, providerRef, sentAt, createdAt,
  UNIQUE (rentalSessionId, kind, channel, eventAt)
)
```

- **Enqueue:** idempotent `INSERT … ON CONFLICT DO NOTHING` per (rental, tier, channel, eventAt) when a rental enters a tier window.
- **Claim:** `UPDATE … SET state='claimed', leaseUntil=now()+5 min, attempts=attempts+1 WHERE id=$1 AND (state IN ('pending','failed_retryable') OR (state='claimed' AND leaseUntil < now())) RETURNING`. Exactly one worker wins; a crashed worker's lease expires and the row is recovered.
- **Send, then mark:**
  - success → `sent`;
  - failure → `failed_retryable` with backoff (next hourly run);
  - when `now > dueUntil` → `expired_unsent` with `lastErrorCode`.
  - **Nothing is lost silently:** every non-delivery is a durable row state.
- **Push and email are independent rows,** so a push failure no longer hides behind a successful email. `skipped` records "no push token" or "user opted out" explicitly.
- **Reschedule:** a changed `eventAt` produces new rows. Old unsent rows for the old instant become `superseded`. This replaces today's stamp-reset logic for new rows; the existing `*SentAt` columns are kept and still written during transition, then retired later.
- **Remaining duplicate risk:** a crash *after* the provider accepted but *before* `sent` is written. At-least-once delivery is the explicit choice, because a rare duplicate is safer than a lost reminder. It's reduced by provider-side dedup keys, each to be **verified against current provider docs before reliance** (CLAUDE.md provider-contract rule):
  - email provider idempotency key = delivery `id`;
  - OneSignal idempotency key = delivery `id`;
  - APNs `apns-collapse-id` = `rental-<id>-<kind>`. Collapse replaces a duplicate on the device rather than showing two.
- **Visibility:** an integrity-check finding when `expired_unsent` rows were created in the last 24 h (count only). It fires only on real loss, never on expected state.

### 4.3 Separate PR?
**Yes: R1, ahead of C1.**
- It touches cron delivery semantics and adds a table (schema gate), with its own failure modes and tests (claim race, lease recovery, expiry, supersede, per-channel independence).
- C1's optional `overdue` nudge then just enqueues an `overdue` kind.
- C1 can ship without the nudge if R1 is delayed.

---

## 5. Corrected C1 — design and boundaries (web-only)

**In scope:**
1. Lifecycle precedence (§3.2) in `lib/rentalCalculations.ts`, with the regression tests. Dashboard support for `pickup` / `overdue` / `stale`.
2. Opt-in, device-local auto-open (§3.3) and deterministic primary-rental selection (§3.4).
3. User cancel (§3.5).
4. `possible_duplicate` soft warning and `clientRentalId` retry idempotency (§2.5).
5. Help page, AI APP FEATURES, EN/ES translations. Fix the stale "not merged" labels on the Part A docs.

**Out of scope:** calendar, native, Part B, R1 outbox (separate), and any new `RentalSession` or `User` column.

**Schema:** **none.**

**Native build:** none.

**Gating:**
- unchanged — create stays Pro;
- cancel, complete, setup and edit stay ungated;
- auto-open is UI only.

---

## 6. C0 — Evidence study protocol (narrow)

**Question:** do real rental reservations appear in phone calendars with usable fields, and can a native app read them?

| Step | What | Who / where | Data handling |
|---|---|---|---|
| **C0a — desk + manual inventory (no build)** | 1. Desk check of current provider docs: Outlook auto-add (car), Apple Siri Suggestions (car rental, and whether unaccepted suggestions are readable via EventKit), Gmail/Google Calendar (whether rental confirmations are auto-added), TripIt calendar feed. <br>2. On Don's and up to 3 consenting internal testers' own phones: open the **native Calendar app**, review the past 24 months plus upcoming, and record each rental-related event as a **shape** on a sheet: source (Outlook / iCloud-Siri / Google / TripIt / manual), account type, one-event vs pickup+drop-off pair, which of {company, conf #, start/end time, time zone, pickup/return location} are present and where (title / location / notes), all-day or not, recurring or not. | Manual, on testers' devices | **No content copied.** Titles become placeholders (`"<Company> Car Rental – <City>"`); codes and addresses are never written down. The sheet holds shapes and booleans only. |
| **C0b — read-only visibility probe (dev build)** | A throwaway native build from a **non-release branch**, installed directly via Xcode / `adb`. **Not TestFlight or Play**, not submitted, not merged. It requests calendar access and shows on screen only: count of events in the window, count matching the draft dictionary, per-calendar-source counts, and whether `calendarItemExternalIdentifier` / `_SYNC_ID` are present. Also checks Siri-suggested (unaccepted) event visibility. | Don's iPhone + one Android device | **No network, no logging of content, nothing persisted.** Uninstalled afterwards. |
| **C0c — report** | `docs/reviews/<date>-rental-calendar-c0-findings.md`: shapes table, hit-rate per source, identifier availability, recommendation. **Synthetic** fixtures derived from shapes only. | Claude + Don | No real calendar content in the repo. |

**Go / no-go for C2+C3** (Don decides): proceed only if, in the sample:
- **≥ 2 of the 3 major sources** (Outlook, Apple, Google) produce rental events with a **usable pickup time and identifiable company**;
- and a **stable external identifier** is available on iOS and Android for those events.

Otherwise prefer Part B (email) and keep manual quick-save.

---

## 7. Recommended native scanning approach (final)

A custom GasCap plugin, `RentalCalendarScanner`, on Capacitor 6:
- iOS EventKit (`EKEventStore.events(matching:)` with predicate limited to the fixed window);
- Android `CalendarContract.Instances` query limited to the window, excluding recurring masters.

**API:** `checkPermission()`, `requestPermission()`, `openAppSettings()`, `scan()` with no parameters → the §1 allowlisted output.

**Integration:**
- it ships in the next iOS (≥ 1.1.2, `ios-capacitor` Codemagic: plist keys + pod-verification entry) and Android binaries;
- web code feature-detects via `Capacitor.isPluginAvailable('RentalCalendarScanner')` and hides the feature on older binaries.

**Rejected:**
- `@ebarooni` 6.7.2: the whole calendar window reaches remote JS, and the line is unmaintained.
- Capacitor 8 + official plugin: same exposure, and a large unrelated upgrade.

---

## 8. Updated risk assessment and privacy requirements

| Risk | Rev 2 position |
|---|---|
| Remote JS reads calendar | **Mitigated in native code:** fixed window, compiled dictionary, allowlisted output, no description text, volume and rate caps, native confirmation sheet. Plus the two release preconditions (§1). Residual: rental-matching events of the past 2 days / next 120 days could be read by compromised web code after a user tap. |
| Wrong "same reservation" decisions | Identity never includes dates; links are user-confirmed; deletion is never inferred from missing data. |
| Lifecycle mis-states | Exact precedence table plus boundary tests; nothing persisted; never auto-complete or auto-cancel. |
| Reminder loss / duplicates | R1 outbox: no silent loss; at-least-once with provider-side dedup (to verify). |
| Store review | Narrow purpose, explainer, native sheet, read-only, reviewer notes. |
| Hit rate | C0 go/no-go. |
| Old binaries / branch drift | Feature detection; plist changes only on `ios-capacitor`; manual version bump. |

**Privacy requirements (testable):**
- **P1.** Native output contains only the §1 allowlist. Tested with a decoy-seeded calendar.
- **P2.** No description text crosses the bridge.
- **P3.** No calendar-derived value is sent to the server except the fields the user confirmed plus salted ref/field hashes.
- **P4.** No calendar strings in logs, analytics or errors. Tested with a mocked scanner and spies on `fetch`, analytics and `console`.
- **P5.** Revoke clears device-local ignores and consent. Server links remain only as hashes; the user can remove them with the rental.
- **P6.** Policy and store disclosures are updated before submission.

---

## 9. Owner-authorization gates (each separately approved by Don)

| Gate | Authorizes | Not included |
|---|---|---|
| **G0** | Accept this design (Rev 1 + Rev 2) | Any implementation |
| **G-C0a** | Desk research + manual shape inventory on consenting testers' devices | Any build or code |
| **G-C0b** | Throwaway local dev build for the visibility probe (non-release branch, direct install) | TestFlight, Play, merge, submission |
| **G-R1a / b / c** | R1 outbox code PR → schema (`RentalReminderDelivery`, additive SQL) → merge/deploy | C1, calendar |
| **G-C1a / b** | C1 code PR (no schema) → merge/deploy | Native, calendar, schema |
| **G-PRE** | Release preconditions: `webContentsDebuggingEnabled:false` (Codemagic/native config) and the iOS push-tap fix | Calendar plugin |
| **G-C2** | Native scanner code + plist/manifest changes on the native branches → TestFlight / Play **internal** only | Store submission |
| **G-C3a / b / c** | Find My Rentals web code → schema (`RentalSourceLink`) + `RENTAL_LINK_KEY` env → disclosures (Policy, privacy label, Data safety; counsel) | Submission |
| **G-SUB** | App Store / Play production submission with the scanner | — |
| **G-C4** | Change/cancel reconciliation UI | — |

**Part B** keeps its own gates. Level 2 APIs need credentials and a written spec.

**Stop: READY FOR CHATGPT REVIEW.**
