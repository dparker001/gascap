# Protected-Path Review: Rental Event Timezones

**Status:** APPROVED (exact commit only)
**Date:** 2026-10-02
**Feature:** GasCap Rental Event Timezones (branch `feat/rental-event-timezones`)
**Reviewed commit:** `d002c17a88cf28986d900b7404311fceb6e31224` (T2, "feat: server event-timezone model")
**Protected path:** `app/api/rental-sessions/route.ts` (CR-1 protected-path guard)
**Approved by:** Don Parker, after independent review by ChatGPT

## Scope of this approval

This approval applies ONLY to the exact commit and path above. It does not cover
any other commit to `app/api/rental-sessions/route.ts` (earlier or later) or any
other path. A later commit touching this file is unreviewed until its own SHA is
reviewed and recorded in `docs/reviews/protected-path-exceptions.json`.

## The change (POST handler only)

- Passes the approved event-specific timezone fields from the request body into
  `createRentalSession`: `pickupTimeZone`, `pickupTimeZoneSource`,
  `returnTimeZone`, `returnTimeZoneSource`.
- Passes the pickup coordinates: `pickupLatitude`, `pickupLongitude`.
- Passes the transient DST disambiguation fields: `pickupTimeDisambiguation`,
  `returnTimeDisambiguation`.
- Wraps `createRentalSession` so a `RentalScheduleError` becomes a controlled
  HTTP error: 400 for an invalid zone or local datetime, 422 for a nonexistent
  (spring-forward) or unresolved ambiguous (fall-back) local time. Any other
  error is re-thrown unchanged.
- Imports `RentalScheduleError` from `@/lib/rentalSessions`.

## Rationale

Each rental event (pickup, return) is a local wall clock plus its own IANA zone;
the server derives each UTC instant itself from that pair and ignores any
client-supplied UTC value. The previous single device timezone made reminders
fire hours early for cross-timezone bookings and late for one-way rentals (a
LAX pickup / JFK return reminder could arrive after the car was due).

## Not changed (outside this exception, confirmed unchanged)

- The Pro gate for starting a rental.
- GET behavior (including the #57 completed-history Fillup batch).
- Photo-size validation and rental-company validation.
- The successful POST response (`{ session }`, 201).
- No entitlement, subscription, payment, pricing or commercial-copy behavior.

## Test evidence (at the reviewed commit and branch HEAD 438d412)

- `__tests__/rentalEventTimezoneServer.test.ts` (29): validation, DST
  nonexistent/ambiguous (earlier AND later), create (incl. the mandatory LAX ->
  JFK one-way case and proof the old single-zone model fails it), PATCH matrix,
  legacy fallback, viewer-timezone invariance.
- `__tests__/rentalEventTimezoneMatrix.test.ts` (8): end-to-end through the
  real create/update model and the real cron where-clauses (4/8 fail against
  main's cron).
- Full suite at HEAD 438d412: 1983 passed, 1 failed; the single failure was the
  CR-1 guard flagging this commit as not yet reviewed (expected fail-closed
  behavior, resolved by recording this exception). `npx tsc --noEmit` clean;
  `npm run build` compiled successfully.

## Non-blocking follow-up recorded with this review

Local rental notification IDs use hashing and therefore have a theoretical
collision risk. Before final production release, review whether active-reminder
ID allocation should detect/resolve collisions instead of relying solely on the
hash range.
