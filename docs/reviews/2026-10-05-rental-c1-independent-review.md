# Rental C1 — Independent Code Review Record

**Status: HISTORICAL record of a completed review (2026-10-05).** Approves the protected-path change in PR #62.

- **PR:** dparker001/gascap#62 — *time-aware Rental Car Mode (C1)*
- **Reviewed head:** `fa412757dfccaef57d3153aa3c91e7ff712d27f7`
- **Reviewer:** ChatGPT (independent). **Verdict: CODE REVIEW PASSED.**
- **Owner approval:** Don Parker, 2026-10-05, for the CR-1 exception below.
- **Design:** `docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md` (Rev 1) as amended by `docs/reviews/2026-10-05-rental-calendar-discovery-rev2.md` and `…-rev3.md`; current behaviour in `docs/RENTAL_TIME_AWARE_MODE.md`.

## Protected-path change under review
`app/api/rental-sessions/route.ts` (CR-1 protected), **+18/−3**, in its own commit **`d343beb0dfaba04e9c6687f322f7774f70f096f2`**: the route now calls `createRentalSessionIdempotent`, validates an optional `clientRentalId` (UUIDv4, else 400 `invalid_client_rental_id`) and maps the results — 201 created, 200 `replayed`, 409 `client_rental_id_conflict`, 409 `possible_duplicate`. Authentication and the Pro gate are untouched and still run first; the existing `RentalScheduleError` mapping is unchanged. No later commit on the branch touches this file.

## Findings and resolutions
| # | Finding (review of `d343beb`) | Resolution |
|---|---|---|
| 1 | Complete and Cancel were not mutually exclusive (a read-then-update let a late complete overwrite a cancel, or the reverse) | Each is one owner-scoped conditional UPDATE (`WHERE id AND userId AND status='active'`); exactly one concurrent attempt wins, repeats return the winner's state; 409 `already_cancelled` / `already_completed`. Deterministic tests over all 120 release orders of 3 completes + 2 cancels (`a5d0213`). |
| 2 | Derived lifecycle states were never refreshed at their time boundaries or after foreground resume | `nextRentalBoundaryMs` + `useRentalClock`: one timer for the earliest boundary, re-read on resume, no polling or network (`a5d0213`). |
| 3 | Auto-open consent was device-wide; async checks could navigate after logout, account change, navigation or disabling | Consent keyed per account; each check carries a generation + `AbortController`, and `canNavigateAfterCheck` re-verifies before navigating (`a5d0213`). |
| 4 | A duplicate "Save anyway" confirmation survived changes to the reservation | Confirmation bound to a key over the reservation-identifying fields; any change voids it (`a5d0213`). |
| 5 | `useRentalClock` kept a stale `now` after schedule edits following a long idle | `start()` refreshes `now` immediately on first run and on every schedule change; tested with a fake clock including a 10-day idle (`fa41275`). |
| 6 | `useRentalSessions` was not keyed to the signed-in account; an old response could update another account's state | Data tagged with its user id and exposed only to that account; logout/switch clears it and cancels the in-flight request; account-switch and logout tests (`fa41275`). |
| 7 | Duplicate-warning binding ignored place coordinates | Coordinates (~1 m) added to the binding key (`fa41275`). |

## Evidence at `fa41275`
- Full suite: 2,359 of 2,360 passing; the single failure was this CR-1 guard awaiting the exception recorded by this commit.
- `tsc --noEmit`, `npm run build` and `npm run check:crons` pass locally.
- Mutation checks were run on the concurrency, stale-response, clock-refresh and binding guards; each broke tests and was restored.

## Scope confirmation
No schema change, no native or calendar code, no new permission, no change to reminder delivery, no overdue notification tier. Merge and deployment remain separate owner gates outside the 9:45–10:15 AM ET window.

## Known limits (documented, accepted)
- A replay after the rental was edited reports a conflict (no stored fingerprint; no schema change).
- `confirmDuplicate` is an explicit user choice at the API level; the binding is enforced in the create forms.
- Timer, foreground-resume and `visibilitychange` behaviour in the iOS/Android WebViews needs an on-device check.
- Backlog: iOS push-tap link check, Android reminder-tap routing, English-only Help text, R1 reminder outbox and the overdue notification (separate workstreams).
