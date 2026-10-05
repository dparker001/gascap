# ChatGPT Review Packet — Rental Calendar Discovery & Time-Aware Rental Car Mode

**Status: PLANNED — design investigation. READY FOR CHATGPT REVIEW.** No code, schema, infrastructure, permissions, native builds, configuration or production touched. Part B is not resumed.
**Design document:** `docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md`. The sections below summarize it; the design doc is authoritative.

## 1. Objective
Decide whether and how GasCap should:
- optionally read the phone calendar to find upcoming rental-car bookings (with user confirmation);
- make Rental Car Mode time-aware (Upcoming → Pickup → Active → Near Return → Overdue/Stale → Completed), with optional, opt-in auto-open at pickup.

## 2. Repository State
- **Baseline:** `main` @ `9cf8e281af43ff06244eed8b3c1c897d0b4a6a19`.
- **Native branches read via git:** `origin/ios-capacitor` @ `cc59200`, `origin/android-capacitor` @ `dfa84d8`.
- **Branch:** local docs-only branch `docs/rental-calendar-discovery`, not pushed.

## 3. What I Found
- **Quick-save, reminders and the lifecycle exist** (details in design §1):
  - Quick-save (PR #59), server reminders (`pickup24`, `pickup2`, `return2`, `returnDue`) and the device return fallback are live.
  - The lifecycle is **display-only**: there is no stored upcoming status and **no time-based transition anywhere**, and overdue rentals are folded into near-return.
- **`userMode='rental'` is nearly inert:** it changes the starting tab only. There's no auto-switch at pickup.
- **No duplicate prevention at all:** the confirmation # isn't unique or checked, and create has no idempotency key (acknowledged backlog).
- **No calendar code, plugin, plist key or Android permission exists.** No background execution either: geofencing was removed 2026-08-05.
- **The native shell loads the live website**, so calendar data returned to JS lives in production web code. `webContentsDebuggingEnabled` is still `true` on both platforms.
- **Plugin versions:**
  - The official `@capacitor/calendar` requires **Capacitor ≥ 8**; GasCap is on **6.2.1**.
  - The only Capacitor-6 calendar plugin (`@ebarooni` 6.7.2, MIT) stopped receiving updates in Nov 2024, and it returns **all** event fields, including descriptions.
- **Where rental bookings come from — the biggest unknown:**
  - Outlook automatically adds car reservations.
  - Apple Siri suggestions cover car rentals; whether EventKit can see unaccepted suggestions is **UNVERIFIED**.
  - **Google's documented auto-add types do not include rental cars.**
- **Side findings, not fixed here:**
  - stale "not merged" labels on the Part A docs;
  - the iOS push-tap handler skips `safeInternalPath`;
  - Android OneSignal taps lack an in-app handler;
  - a claimed `GasCapiOS` user-agent marker that no config sets;
  - `main`'s `codemagic.yaml` lags `ios-capacitor`.

## 4. What I Changed
Two new documents only. No code changed.

## 5. Architectural Decisions (proposed)
1. **A custom read-only native `RentalCalendarScanner`** filters in Swift/Kotlin and returns only allowlisted fields for rental-like events. Preferred over a general plugin (which exposes the whole calendar window to remotely loaded JS) and over a Capacitor 8 upgrade.
2. **Deterministic on-device extraction** (no AI, no upload). Never guesses. Missing fields stay blank. The prefilled **existing** Quick-Save form does validation and DST handling.
3. **Provenance + duplicates:** `RentalSession.source`, an HMAC'd `sourceRefHash` (unique per user), and a `sourceFingerprint` for change detection. A server-side `possible_duplicate` warning covers all sources. Never auto-merge, overwrite or delete.
4. **Time-aware mode stays derived:** new display states `pickup`, `overdue`, `stale` in `rentalCalculations.ts`, with no stored status. Opt-in auto-open is client-side and once per rental/state. With several rentals in progress, the user picks.
5. **Phasing:**
   - **C1 (web-only time-aware mode + duplicate layer) can ship without the calendar.**
   - **C0 evidence spike** gates any native work.

## 6. Security Impact
- **New sensitive capability:** full OS calendar read.
- **Mitigations:**
  - access starts only from a user action;
  - native filtering limits what reaches web JS;
  - read-only, 120-day window;
  - no server storage of calendar content beyond the fields the user confirmed;
  - no AI;
  - no logging or analytics of calendar strings.
- **Preconditions:** set `webContentsDebuggingEnabled:false` for release builds, and apply `safeInternalPath` to the iOS push tap.

## 7. Data / Database Impact (future, separately authorized; additive direct SQL)
- `RentalSession.source`, `sourceRefHash` (partial unique per user), `sourceFingerprint`
- `User.rentalAutoOpen`, `User.calendarDiscoveryConsentAt`
- optionally a create idempotency-key table

No backfill.

## 8. User / Business Impact
- **Calendar import:** less typing for users whose bookings reach their calendar.
- **C1:** better at the counter and at return for everyone (pickup card, overdue prompt instead of a silent "near return").
- **Cost:** native release plus store review for both platforms, and privacy-label / Data-safety updates.

## 9. Testing Performed
None. This is a design-only round. The test strategy is in design §10:
- extractor never-guess fixtures;
- DST and floating-time cases;
- overlap and duplicate checks;
- a decoy-event privacy regression;
- a native device matrix.

## 10. Files Changed
- `docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md` (new)
- `docs/reviews/2026-10-05-rental-calendar-discovery.md` (new, this packet)

## 11. Known Risks / Remaining Questions
1. **Hit rate is unknown,** especially for Google/Gmail. C0 decides.
2. **Store rejection** for a full-calendar grant.
3. **Remote-code exposure** of calendar data.
4. **Capacitor 6 is ageing.**
5. **Native branch drift** and manual version bumps.
6. **Old binaries** running new web code: needs plugin feature detection.
7. **Calendar formats are unknown.**

## 12. Claude's Assessment
- **C1 (web-only time-aware Rental Mode + duplicate/idempotency layer) is the best next build.** It fixes real gaps (no overdue state, no duplicate check, double-send window) and helps every user, with or without a calendar.
- **Calendar discovery is feasible but has uncertain value and a high release cost.** It should not be committed to before C0 shows rental events actually appear in users' calendars.
- **Part B email import likely covers more users (including Gmail and web).** The two share the same duplicate and provenance layer.

## 13. Questions for ChatGPT
1. Is the custom native scanner justified over `@ebarooni` 6.7.2 with JS-side filtering, given the remote-URL architecture? Or is a Capacitor 8 upgrade the better long-term path?
2. Are the display states and thresholds (pickup −3h/+6h, overdue at return, stale at +72h) sound? Should `overdue` be split out of `near_return` as proposed?
3. Duplicate rule: is a soft 409 with "Save anyway", plus a hard `(userId, sourceRefHash)` uniqueness, sufficient?
4. App Store privacy label stance when calendar data is processed only on the device unless the user saves a rental.
5. Should C1 include the atomic reminder-claim fix, or should it be its own small PR?

## 14. Requested Review Scope
- Design doc §2–§8 and the decision list in §11.
- Verify the implemented-vs-missing table against `main` @ `9cf8e28`.

**Stop: READY FOR CHATGPT REVIEW.**
