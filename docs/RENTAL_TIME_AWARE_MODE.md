# Time-aware Rental Car Mode (C1) — CURRENT

**Status: IMPLEMENTED on branch `feat/rental-c1-time-aware-mode`; not merged.** Design: `docs/RENTAL_CALENDAR_DISCOVERY_DESIGN.md` (Rev 1) as amended by `docs/reviews/2026-10-05-rental-calendar-discovery-rev2.md` and `…-rev3.md` (Rev 3 §2.2 and §5 are authoritative for C1). No schema change, no native code, no new notification tier. The calendar scanner, R1 reminder outbox and email import (Part B) are separate, unauthorized workstreams.

## Lifecycle (derived, never stored) — `lib/rentalCalculations.ts`
`resolveRentalLifecycle()`; first match wins. Instants are the UTC values (`rentalEventInstant`); `setupComplete` comes from `rentalLifecycleInput()` (vehicle → tank → pickup fuel).

| # | Condition | State |
|---|---|---|
| 1–2 | `status` completed / cancelled | `completed` / `cancelled` |
| 3 | `classifyRentalSchedule()` ≠ ok | `needs_schedule` |
| 4 | return known ∧ now ≥ return + 72 h | `stale` |
| 5 | return known ∧ now ≥ return | `overdue` |
| 6 | pickup known ∧ now < pickup − 3 h | `upcoming` |
| 7 | pickup known ∧ now < pickup ∧ setupComplete ≠ false (complete **or unknown**) | `upcoming` |
| 8 | pickup known ∧ now < pickup + 6 h ∧ setupComplete = false | `pickup` |
| 9 | return known ∧ now ≥ return − 24 h | `near_return` |
| 10 | otherwise | `active` |

`classifyRentalSchedule`: **invalid** (a present instant is unparseable — the UTC value wins over local, so a bad UTC is never masked — or a stored zone isn't IANA), **inconsistent** (return ≤ pickup), **implausible** (> 366 days). Absent times are unknown, never invalid. An unknown setup state (`setupComplete` omitted) never produces `pickup`: the rental stays `upcoming` until the pickup instant, as before. Nothing completes, cancels or deletes a rental automatically.

## Presentation — `lib/rentalPresentation.ts`
- `groupRentals`: In Progress = pickup/active/near_return/overdue; Upcoming; **Needs your attention** = stale + needs_schedule.
- `selectPrimaryRental`: overdue > pickup > near_return > active > upcoming; stale, needs_schedule, completed, cancelled excluded; ties by earliest relevant instant (return for overdue/near_return, else pickup), then newest `createdAt`, then id.
- Dashboard (`RentalAttentionCard`): "It's pickup time" (Finish-setup does the work), "Did you return it?", stale prompt (returned / still have it / didn't take it / delete), "Check your times". `overdue` and `stale` keep the return-preparation section order.

## Opt-in auto-open — `lib/rentalAutoOpen.ts`, `components/RentalAutoOpen.tsx`
Device-local setting (`gc_rental_autoopen_enabled`, off by default, Settings). Opens `/rental-return/<id>?auto=pickup` only when: enabled; route is `/`; no input focused; cold start, or resume after ≥ 5 min hidden; **exactly one** rental in `pickup`; once-flag `gc_rental_autoopen:<id>:<pickupInstant>` unset. Two or more at pickup → the calculator banner says "N rentals are at pickup — choose one". Storage errors fail off.

## Server
- `POST /api/rental-sessions` (Pro-gated, unchanged gate): optional `clientRentalId` (UUIDv4) becomes the row id. Same user + same content → 200 `{replayed: true}` with the original row; different content or another user's id → 409 `client_rental_id_conflict`; invalid → 400. A concurrent identical request resolves through the unique-id violation (one row). Replay is checked **before** duplicate detection.
- Soft duplicate detection (`lib/rentalDuplicates.ts`): same user's **active** rentals; company + normalized confirmation match, or same company with pickups within ±36 h and no conflicting confirmation. The window rule needs UTC instants on both sides and skips rentals with a malformed schedule. 409 `possible_duplicate {rentalId, matchedOn}`; retry with `confirmDuplicate: true` to save anyway. Never merges.
- `POST /api/rental-sessions/[id]/cancel`: owner-scoped, idempotent (one conditional UPDATE), not Pro-gated; 409 `already_completed` for a returned rental.

## Known limits
- A replay after the row was edited (different content) is reported as a conflict, not a replay: no create fingerprint is stored (no schema change).
- `completeRentalSession` is unchanged and not atomic with cancel; if both race, the later write wins.
- Auto-open needs the app/web page to be opened; while the app is closed the existing server `pickup2` push is the path.
