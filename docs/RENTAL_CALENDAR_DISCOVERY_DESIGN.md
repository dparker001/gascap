# Rental Calendar Discovery & Time-Aware Rental Car Mode — Design

**Status: PLANNED — design investigation only. Nothing here is implemented or authorized.**
**Baseline:** `main` @ `9cf8e281af43ff06244eed8b3c1c897d0b4a6a19` (2026-10-05).
**Related:**
- `docs/RENTAL_UPCOMING_IMPORT_SPEC.md` — Part A quick-save, Part B email import
- `docs/RENTAL_INTEGRATION_LEVEL2.md`
- `lib/rentalProvider.ts`
- `docs/NATIVE_HARDENING_REVIEW.md`

---

## 1. Implemented vs missing (audited at `9cf8e28`)

| Capability | State | Evidence |
|---|---|---|
| Quick-save an upcoming reservation | **Implemented** (PR #59). Company, optional confirmation #, pickup/return place + local time + event zone, DST disambiguation. No vehicle/fuel fields. | `components/rental-return/QuickSaveRentalForm.tsx`, `lib/rentalQuickSave.ts:37-68` |
| `RentalSession` storage | **Implemented.** Stored status is only `active \| completed \| cancelled`. Naive local wall-clock + server-derived UTC instant + per-event IANA zone and zone source. | `prisma/schema.prisma:670-786`, `lib/rentalSessions.ts:20,243-331` |
| "Upcoming / Active / Near return" | **Derived for display only.** `resolveRentalLifecycle()` computes it from status + time. Nothing transitions by time. Near-return includes overdue. | `lib/rentalCalculations.ts:484-559` |
| Start / picked-up action | **Missing.** An upcoming rental becomes "in progress" only because the clock passes pickup. | — |
| Complete | **Implemented.** User action, idempotent. Never automatic. | `lib/rentalSessions.ts:683-727` |
| User cancel | **Missing.** Admin-only `cancel`. Users can delete. | `app/api/admin/rental-pilot/[id]/route.ts:37-56` |
| Expire / overdue handling | **Missing.** No state for "return time passed, never completed". | — |
| Pickup/return reminders | **Implemented.** Hourly cron with tiers `pickup24` (20–26h), `pickup2` (0–3h), `return2` (0–3h), `returnDue` (0–36h). Email + push (OneSignal web/Android, APNs iOS), deep link `/rental-return/<id>`, EN/ES. **Not an atomic claim:** overlapping runs could double-send. | `app/api/cron/rental-return-reminder/route.ts:18-22,37-48,238-253` |
| Device-local reminder fallback | **Implemented**, return−2h only, when push is unusable. | `lib/rentalReminder.ts:88-225` |
| Automatic presentation changes | **Partial.** The dashboard section order follows the lifecycle; Prepare-for-Return auto-opens once at near-return; My Rentals groups In Progress / Upcoming; the calculator shows a rental banner. | `rentalCalculations.ts:585-596`, `RentalDashboard.tsx:425-450`, `TargetFillForm.tsx:145-160,616-660` |
| App-mode selection | **Exists but inert for rentals.** `User.userMode='rental'` only changes the starting tab and remounts the calculator. "Rental Car Mode" is not a stored mode. **No automatic switch at pickup.** | `NativeAppShell.tsx:72-75,114-121`, `RentalModeHeader.tsx:19-33` |
| Duplicate prevention | **Missing.** Confirmation # is not unique, not indexed and never checked. Create has no idempotency key (acknowledged backlog). | `lib/rentalSessions.ts:313-319` |
| Provenance | **Partial.** `provider='manual'` + fuel `*Source`. No source/origin/external-ref columns. `NormalizedRentalData.externalRentalId` is never persisted. | `lib/rentalProvider.ts:40-75` |
| Part B forwarded-email import | **Designed, not implemented** (PLANNED; no `RentalImport` model or route). | `docs/RENTAL_UPCOMING_IMPORT_SPEC.md` §4 |
| Calendar access | **None.** No plugin, no Info.plist calendar keys, no `READ_CALENDAR`, no code. | git grep across main, `ios-capacitor`, `android-capacitor` |
| Background execution | **None.** Geofencing and background location were removed 2026-08-05. Alert pushes only (no silent push). | commits `5098208`, `babd027` |

Smaller findings during the audit, out of scope and **not fixed here**:
- `docs/RENTAL_UPCOMING_IMPORT_SPEC.md` §3 and `docs/RENTAL_QUICK_SAVE_PART_A_PLAN.md` still say Part A is "pending review, not merged". It was merged in PR #59.
- `TargetFillForm.tsx:245-261` has a stale "Auto-activate rental mode" comment.
- The iOS push-tap handler navigates to `data.url` without `safeInternalPath` (`NativePushRegistration.tsx:45-48`). The local-notification router does use it.
- Android OneSignal taps have no in-app click handler. Whether rental deep links open inside the app is unverified.
- `hooks/useIsNative.ts` claims a `GasCapiOS` user-agent marker that no config sets.
- `main`'s `codemagic.yaml` is behind `origin/ios-capacitor` (missing the Camera/Photos keys, marketing version 1.0.1 vs 1.1.1).

---

## 2. Native calendar access through the current architecture

### 2.1 Facts that constrain the design
1. **The native shell loads the live website** (`capacitor.config.json` `server.url = https://www.gascap.app/?native=…`).
   - Any calendar data a plugin returns lands in JavaScript **served from our production web deploy**.
   - A compromised deploy, XSS or a malicious dependency could therefore read whatever the plugin exposes.
   - `webContentsDebuggingEnabled: true` is still set for both platforms (NATIVE_HARDENING_REVIEW Finding 1, unfixed).
2. **Capacitor 6.2.1.** The **official `@capacitor/calendar` (1.0.x, Aug 2026) requires `@capacitor/core >= 8`.** The community `@ebarooni/capacitor-calendar` (MIT) has a Capacitor-6 line ending at **6.7.2 (Nov 2024, no longer updated)**. It offers `requestFullCalendarAccess()` and `listEventsInRange({startDate,endDate})`. That call returns **every event** in the range, with `title`, `location`, `description`, `organizer`, start/end, `eventTimezone`, `isAllDay`, `calendarId` and `url`.
3. **iOS 17+** requires `NSCalendarsFullAccessUsageDescription` to read events.
   - Write-only access returns no events.
   - Without the new key, iOS denies access automatically.
   - iOS ≤16 uses `NSCalendarsUsageDescription`.
   - **Full access is all-or-nothing:** the app can read every calendar the user has synced (iCloud, Google, Exchange/Outlook, subscribed). There is no per-calendar grant.
4. **Android** needs `READ_CALENDAR`, a runtime dangerous permission. `CalendarContract` exposes events from every account synced to the device's Calendar Provider (Google, Exchange via the OS account, Samsung, and others).
   - Google Play policy: sensitive permissions must be **necessary for core, listed functionality**, requested in context, and disclosed in the Data safety form.
   - Third-party plugins usually also merge `WRITE_CALENDAR`. It must be stripped (`tools:node="remove"`) to stay read-only.
5. **Native release path:** adding a plugin or permission needs a new binary for each platform:
   - iOS: `ios-capacitor` branch → Codemagic → TestFlight → manual App Store submission. The marketing version must be bumped by hand to ≥1.1.2. The plist keys are added in the Codemagic PlistBuddy step, which exists only on `ios-capacitor`.
   - Android: `android-capacitor` → Play internal track.

   Both require store review, privacy-label and Data-safety updates, and updated app-store copy. Web code must **feature-detect the plugin** (`Capacitor.isPluginAvailable(…)`), because old binaries keep running the new web code.
6. **Background:** neither platform lets this app scan calendars while it is closed. There are no background modes, and adding them for calendar polling would be hard to justify in review. **Scanning happens only while the app is open, when the user asks** (and optionally on app open). Once a rental is saved, the **existing server cron already covers reminders while the app is closed.**
7. **Will rental bookings even be in the calendar? Unknown, and this is the biggest product risk:**
   - Outlook / Outlook.com / Microsoft 365 automatically add "flight, car, and hotel reservations" ([Microsoft](https://support.microsoft.com/en-US/Outlook/automatically-add-events-from-your-email-to-your-calendar)).
   - Apple Mail's Siri Suggestions offer car-rental events from known providers ([Apple](https://support.apple.com/guide/calendar/iclc121e66ee/mac)). Whether *unaccepted* suggestions are visible to EventKit is **UNVERIFIED**.
   - Google Calendar's "Events from Gmail" officially documents flights, hotels, restaurants and ticketed events. **Rental cars are not listed** ([Google](https://developers.google.com/schemas/)).
   - TripIt-style feeds and manual entries vary.

   Event title and body formats are unknown until real samples are collected.

### 2.2 Recommended access design: a minimal, read-only native scanner
**Recommendation: a small custom GasCap plugin, `RentalCalendarScanner` (Swift / Kotlin), instead of a general calendar plugin.**

| | Custom scanner (recommended) | `@ebarooni` 6.7.2 | Upgrade to Capacitor 8 + official plugin |
|---|---|---|---|
| What reaches web JS | Only events matching rental keywords, with **allowlisted fields** | Every event in range, including descriptions | Every event in range |
| Damage if the live site were compromised | Rental-like events only | Entire calendar window | Entire calendar window |
| Write permission | None | Must strip `WRITE_CALENDAR` | Plugin declares read+write |
| Capacitor upgrade | No | No | **Yes**: a separate, high-risk workstream (RevenueCat, OneSignal, every plugin) |
| Maintenance | Ours (~200–300 lines per platform) | Unmaintained Capacitor-6 line | Maintained |

The scanner API (proposed):

```
scan({ fromMs, toMs (≤ 120 days ahead), keywords[] (server-provided list) })
  → { events: [{ eventKey, calendarSourceType, title, location, notesExcerpt?, startMs, endMs,
                 startZone?, endZone?, isAllDay, lastModifiedMs? }] }
```

- **Filtering runs in native code.** An event is returned only if its title, location or organizer matches the rental keyword list (company names plus words such as "car rental", "rental car", "pick-up", "pickup", "drop-off").
- `notesExcerpt` is returned **only** as up to 3 short snippets (≤120 characters each) that contain a confirmation-number pattern. Never the full description.
- `eventKey` = a hash of the platform event id (iOS `calendarItemExternalIdentifier` where present) plus the start time.
- Attendees, organizer emails, URLs, other events and calendar names are **never** returned.
- **Native gets no network access.** Nothing is uploaded by the scanner.

---

## 3. Find My Rentals: recommended user flow

1. **Entry:** My Rentals → "Find rentals in my calendar". It's opt-in, shown only on binaries where the plugin is available, and never on the web.
2. **Explainer first** (before the OS prompt), EN/ES:
   - "GasCap looks only for rental-car bookings in the next 120 days, on this phone."
   - "Nothing from your calendar leaves your phone unless you choose to save a rental."
   - "You can turn this off in Settings."
3. **OS permission prompt**, with the iOS purpose string: *"GasCap reads your calendar only when you tap Find My Rentals, to find upcoming rental-car reservations you can save. Other events are never stored or uploaded."*
4. **On-device scan and extraction.** A pure TS module (`lib/rentalCalendarExtract.ts`, deterministic, **no AI**) turns each candidate into a draft with per-field confidence:
   - **company:** a dictionary match (Avis, Hertz, Enterprise, Budget, National, Alamo, Sixt, Thrifty, Dollar, Payless, Fox, Zipcar, Turo; others become "Unknown — you choose");
   - **confirmation #:** a labelled pattern only (`Confirmation`, `Conf #`, `Reservation #` followed by an alphanumeric code);
   - **pickup:** event start + event zone;
   - **return:** event end, **only if** the event plausibly spans the rental (end > start and not all-day). Separate "pick-up" / "drop-off" events for the same company and confirmation are paired. Otherwise return stays **blank**;
   - **locations:** the event location text, only if present.

   **Never guess:**
   - a field that isn't present stays empty;
   - all-day or floating (zone-less) events leave times **unconfirmed** until the user picks the time and zone;
   - nothing is filled in about the vehicle, tank or fuel.
5. **Review screen:** one card per candidate showing the fields found, the missing ones, and "From your calendar: <date>".
   - Actions: **Save as upcoming** (opens the existing Quick-Save form prefilled, so the existing validation and DST disambiguation apply) or **Not a rental / Ignore**.
   - Ignored event keys are remembered **on this device only**.
6. **Save:** this uses the existing `POST /api/rental-sessions` (Pro-gated) with the provenance described in §5.3. The server sees **only** the fields the user confirmed.
7. **Possible-duplicate warning** before saving (§5.4).
8. **Later scans** (manual, or optionally on app open if the user enabled "Check my calendar when I open GasCap"):
   - new candidates appear;
   - linked rentals whose calendar event **changed** show "Your calendar shows a different pickup time — update?". This is a field-by-field diff; nothing is ever written automatically;
   - linked rentals whose event **disappeared** show "This booking is no longer in your calendar — still renting?" with the options *Keep* or *Delete*. Never deleted automatically.

**Pro gating (Don decides):** recommended option is that scanning is free and on-device, while *saving* requires Pro. This matches today's create gate, and the free user sees the upgrade card on the review screen. Finishing, updating or completing an existing rental is never gated (CLAUDE.md).

---

## 4. Time-aware Rental Car Mode

### 4.1 Display lifecycle (pure function, `lib/rentalCalculations.ts`; **no new stored status**)

| State | Rule (instants from `*DateTimeUtc`) | Primary UI |
|---|---|---|
| `upcoming` | now < pickup − 3h | My Rentals "Upcoming"; Finish-Setup hint |
| `pickup` (new) | pickup − 3h ≤ now < pickup + 6h **and** setup incomplete | "At the counter" card: add vehicle, tank, gauge photo |
| `active` | after pickup, more than 24h to return | Current dashboard |
| `near_return` | ≤24h to return and return not passed | Prepare for Return (existing auto-open) |
| `overdue` (new) | return passed, status still `active` | "Did you return it?" → **Complete** (user) or "Still have it" (edit return time) |
| `stale` (new) | return + 72h passed, still `active` | Same prompt. Dropped from automatic presentation, so it never hijacks the home screen. **Never auto-completed.** |
| `completed` / `cancelled` | stored status | History |

**Rules:**
- No transition writes to the database. Only the user's Complete or Edit does.
- A rental with **unknown** times shows "time not set". It is never placed in a time state by guessing (CLAUDE.md "never invent a reading").

### 4.2 Optional automatic selection at pickup (explicit opt-in)
- **Setting:** "Open my rental automatically at pickup time" (off by default). Stored per user (recommended: `User.rentalAutoOpen Boolean @default(false)`), so the choice follows the user across devices.
- **Behaviour:** this runs on the client only, at app open or resume (`appStateChange`) and on web page load. If exactly one rental is in `pickup` or `active` **and** its auto-open hasn't been shown on this device for that rental and state, the app routes to `/rental-return/<id>` **once**. The once-flag is a device-local key `gc_rental_autoopen:<id>:<state>`.
  - **Multiple overlapping rentals** in an eligible state: no automatic routing. Show "You have 2 rentals in progress", and the user picks.
- **Never:** assume a vehicle or fuel reading, change `userMode`, or auto-complete.
- **The app is closed at pickup:** the existing `pickup2` push (0–3h) deep-links to the rental. That is the "automatic" path when closed. No background work is needed.

### 4.3 Notifications
Reuse the existing cron tiers. Optional additions:
- an `overdue` nudge at return + 2h ("Returned it? Tap to finish"), in an hourly tier with a dedup stamp. Never auto-completes;
- make tier claims atomic (`UPDATE … WHERE <stamp> IS NULL RETURNING`) to close the known double-send window.

### 4.4 Time zones, DST and overlap
- **Calendar events give an instant plus optionally a zone.**
  - With a zone: convert to the zone's wall-clock and run the existing `classifyLocalTime` / `resolveEventUtc`.
  - Without a zone (floating or all-day): **the user must confirm** the time and zone. The device zone is never silently assumed.
  - Event zone source on save: a new `'calendar'` value. Recommended, so provenance stays honest; a decision for Don.
- **DST:** handled by the existing ambiguous/nonexistent handling in quick-save. Tests cover pickup events inside the repeated or skipped hour.
- **Overlap:** handled through `useRentalSessions().primary` (already defined). The auto-open rule refuses to pick when more than one rental qualifies.

---

## 5. Technical requirements

### 5.1 Reuse
- `POST /api/rental-sessions` and its Pro gate (`getLivePlan`)
- Quick-Save form and validation
- `lib/rentalTimezone.ts`
- `lib/rentalCalculations.ts` (lifecycle)
- `rental-return-reminder` cron
- `sendUserPush`
- `RentalDataProvider`: a new `CalendarImportProvider` normalizes into `NormalizedRentalData` (§6), as Part B planned for email

### 5.2 New code (by phase, §8)
- **Native:** `RentalCalendarScanner` plugin (iOS EventKit / Android `CalendarContract`, read-only, filters natively).
- **Web:**
  - `lib/rentalCalendarExtract.ts` (pure, tested);
  - Find My Rentals review UI;
  - lifecycle additions (`pickup`, `overdue`, `stale`);
  - auto-open hook;
  - a Settings toggle and consent revocation;
  - help page + AI APP FEATURES + EN/ES translations.

### 5.3 Data model (additive, direct SQL; separately authorized)

| Column | Purpose |
|---|---|
| `RentalSession.source TEXT NULL` | `'manual' \| 'quick_save' \| 'calendar' \| 'email'`. Provenance only; `provider` stays `'manual'` |
| `RentalSession.sourceRefHash TEXT NULL` | HMAC-SHA256(server key, userId‖eventKey). Partial unique index on `(userId, sourceRefHash)` where not null → the same calendar event can't be imported twice |
| `RentalSession.sourceFingerprint TEXT NULL` | Hash of the extracted fields at save time, to detect "calendar changed" without storing calendar content |
| `User.rentalAutoOpen BOOLEAN NOT NULL DEFAULT false` | §4.2 |
| `User.calendarDiscoveryConsentAt TEXT NULL` | Audit record of opt-in. Cleared on revoke |

**No calendar text is stored server-side beyond the fields the user confirmed** (the same fields quick-save already stores).

### 5.4 Duplicate prevention across manual, calendar and email
- **Hard:** `(userId, sourceRefHash)` for calendar, and Part B's `deliveryKey` for email.
- **Soft warning** (all sources, including manual), checked server-side on create. When the normalized company and confirmation # match, or the company matches and the pickup is within ±2h, return `409 possible_duplicate` with the matching rental's id. The client shows "Looks like you already saved this rental" with *Open it* / *Save anyway* (`?confirmDuplicate=1`). **Never auto-merge.**
- **Request idempotency:** an `Idempotency-Key` header on create. This closes the acknowledged retry duplicate (`lib/rentalSessions.ts:313-319`).

---

## 6. Comparison of reservation sources

| | Manual quick-save (live) | Calendar import (this design) | Forwarded email (Part B, designed) | Rental-company APIs (Level 2) |
|---|---|---|---|---|
| User effort | Type everything | Tap scan, confirm | Forward email, confirm | None after linking |
| Coverage | Universal | Only if bookings reach the calendar (**unverified for Google**) | Any emailed confirmation | Partner companies only |
| Data quality | User-entered | Partial: times and zone good, company/conf # sometimes, never vehicle/fuel | Richest: conf #, times, locations, sometimes car class | Authoritative, including fuel and vehicle |
| Privacy exposure | Minimal | Calendar permission (broad OS grant); mitigated by native filtering | Email content reaches our server + AI provider (transient) | Partner data-sharing agreement |
| Native build / store review | No | **Yes**, both stores | No (Cloudflare + server) | No (server), plus a contract |
| Infrastructure / cost | None | None server-side | Cloudflare Email Routing, worker, AI tokens | Partnership, credentials |
| Works on web | Yes | **No** (native only) | Yes | Yes |
| Change tracking | Manual | On rescan (diff, user-confirmed) | New email = new import | Webhooks |

**Assessment:** calendar import complements Part B; it doesn't replace it. Email reaches web users and Gmail users, whose rental bookings may not appear in Google Calendar. Calendar suits Outlook users and Apple Mail users who accept Siri suggestions, and people who add trips manually. Run the **sample-collection spike before committing to either**.

---

## 7. Security and privacy assessment

| Risk | Mitigation |
|---|---|
| Broad OS grant (full calendar read) | Request it only from an explicit user action. Native-side filtering means only rental candidates enter web JS. Read-only (no write). 120-day window. |
| **Remote-loaded web code holds calendar data** | Native filtering limits the damage. Fix the two existing preconditions first: **set `webContentsDebuggingEnabled:false` for release** (Hardening Finding 1), and add `safeInternalPath` to the iOS push-tap handler. Feature module CSP/review. |
| Unrelated calendar content stored or uploaded | Never. Candidates live in memory only. Ignored keys are device-local. The server receives only confirmed rental fields + an HMAC'd event ref + a fingerprint hash. **No AI on calendar text.** Analytics events carry counts only (candidates found, saved), never titles or locations. |
| Logging | No calendar strings in client or server logs. A test asserts the scanner result is never passed to `console`, analytics or fetch except the confirmed create payload. |
| Consent and revocation | Settings toggle: turn off → stop scanning, clear device-local keys, clear `calendarDiscoveryConsentAt`. Deep link to OS settings to revoke the permission. Saved rentals remain (user data). |
| Disclosure | Privacy Policy and Terms updates. App Store privacy label (likely "not collected", since data stays on device unless the user saves; **counsel/Don to confirm**). Play Data safety form (calendar access declared; processing on device). |
| Store review | Purpose string and in-app explainer. Review notes with a demo account and a test event. A feature that serves the app's core purpose (rental fuel return). |

---

## 8. Incremental phases (each separately authorized)

| Phase | Scope | Native build? | Schema? |
|---|---|---|---|
| **C0 — Evidence spike (read-only research)** | Collect real, anonymized samples of how Avis/Hertz/Enterprise/Budget/National/Alamo bookings appear in calendars: Outlook auto-add, Apple Siri suggestions (accepted vs unaccepted; EventKit visibility), Google (does Gmail add rentals?), TripIt, manual. A throwaway dev build on a **non-release branch** to test EventKit/CalendarContract visibility on Don's devices. **Go/no-go on hit rate.** | Dev-only, not submitted | No |
| **C1 — Time-aware Rental Mode (web-only, valuable regardless)** | `pickup`/`overdue`/`stale` display states + tests; auto-open hook + `rentalAutoOpen` setting; overlap handling; `possible_duplicate` warning + create idempotency key; atomic reminder claims; optional overdue nudge; help/AI/EN-ES; fix stale Part A doc labels | No | `User.rentalAutoOpen` (+ optional idempotency table) |
| **C2 — Native scanner** | `RentalCalendarScanner` iOS/Android, plist keys on `ios-capacitor`, `READ_CALENDAR` only, pod-verification list update, `webContentsDebuggingEnabled:false` for release, version bumps; TestFlight / Play internal only | **Yes** | No |
| **C3 — Find My Rentals** | Extraction module + fixtures, review UI, consent, provenance columns, `CalendarImportProvider`, store listing/privacy updates, then App Store / Play submission | Uses C2 binary | `source`, `sourceRefHash`, `sourceFingerprint`, `calendarDiscoveryConsentAt` |
| **C4 — Change/cancel reconciliation** | Rescan diff, "update?" and "still renting?" prompts; optional scan-on-open | No | No |
| Part B (email) | Stays separately gated. Shares the C1 duplicate layer and the provenance columns | No | Per its spec |
| Level 2 APIs | Only with partner credentials and a written spec (CLAUDE.md) | No | — |

---

## 9. Risks and dependencies
1. **Hit rate is unknown.** Google Calendar may not contain rentals at all, which would make C3 low-value for Gmail users. C0 decides.
2. **App Store / Play rejection** for full calendar access. Mitigate with a narrow purpose, an explainer, and review notes.
3. **Remote-code exposure** of calendar data. Native filtering plus the debug-flag fix are preconditions.
4. **Capacitor 6 is ageing.** The official plugin needs 8. A Capacitor upgrade is a separate future workstream; the custom scanner avoids depending on it.
5. **Native branch drift.** `main`'s `codemagic.yaml` lags `ios-capacitor`. iOS version bumps are manual (they have failed builds before).
6. **Old binaries** run the new web code. The feature must be hidden when the plugin is unavailable.
7. **Calendar formats change.** The extractor must degrade to "fields missing", never to wrong values.
8. **Existing gaps C1 fixes or relies on:** no create idempotency; non-atomic reminder claims; overdue rentals counted as near-return.

## 10. Test strategy
- **Pure units:**
  - extractor fixtures per company and source (from C0 samples, sanitized);
  - **never-guess tests** (missing return, all-day, floating zone, unknown company → blank, not filled);
  - confirmation-pattern false positives (phone numbers, flight numbers);
  - pickup/drop-off pairing;
  - lifecycle states at boundaries (pickup−3h, +6h, return, +72h) across DST in America/New_York, America/Los_Angeles, Europe/London, and floating events;
  - overlap selection.
- **Server:**
  - duplicate warning (manual × calendar × email), `sourceRefHash` uniqueness per user, idempotency-key replay;
  - Pro gate on create only, never on finish/complete;
  - no calendar text in the logged request body.
- **Native (manual device matrix):**
  - iOS 16 / 17 / 18 with iCloud, Google and Exchange accounts;
  - Android 13 / 14 / 15 with Google and Exchange;
  - permission denied, then later granted;
  - revoked in OS settings;
  - old binary hides the feature;
  - scanner returns only allowlisted fields (asserted with a calendar seeded with decoy events).
- **Privacy regression:** a mocked scanner with decoy events; assert that nothing except the confirmed fields reaches `fetch`, analytics or `console`.
- **CLAUDE.md:** fuel math untouched. Rental-calculation changes (lifecycle) need regression tests.

## 11. Decisions for Don
1. **Pursue calendar import at all, given Part B?** Recommendation: run C0 first, then decide C3 against Part B with evidence.
2. **Approve C1** (web-only time-aware Rental Mode) as the first build? It's useful without the calendar.
3. **Scanner approach:** custom read-only native scanner (recommended) vs `@ebarooni` 6.7.2 vs a Capacitor 8 upgrade.
4. **Pro gating:** scanning free, saving Pro (recommended), or the whole feature Pro.
5. **Auto-open default:** off, explicit opt-in (recommended).
6. **New display states:** `pickup` / `overdue` / `stale` and their thresholds (3h / 6h / 72h).
7. **Provenance:** zone source value `'calendar'`, and the new `RentalSession` provenance columns.
8. **Preconditions:** fix `webContentsDebuggingEnabled` for release and the iOS push-tap path before any calendar build.
9. **Disclosures:** privacy label / Data-safety stance and Privacy Policy edits (counsel).
10. **Native release timing:** this rides the next iOS 1.1.2 and Android builds. Submit only after C3 is approved.
