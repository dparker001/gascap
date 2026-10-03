# ChatGPT Delta Packet — Rental Quick-Save Part A: no-clamp fix

Follow-up to `docs/reviews/2026-10-02-rental-quick-save-part-a.md` (ChatGPT result: PASS WITH ONE REQUIRED CHANGE BEFORE PR).

## Repository state
- **Branch:** `feat/rental-quick-save` (local, **not pushed**, no PR)
- **New Review Target SHA:** `9c875a4` (previous target `82974b6`)
- **Packet commit:** the commit after `9c875a4` adding this file and updating the spec's §3.3 table to the as-built rule (docs only)
- **Delta:** `git diff --name-status fb43dd5..9c875a4`
  ```
  M	__tests__/rentalPartACopy.test.ts
  M	__tests__/rentalTankCapacityTransitions.test.ts
  M	components/rental-return/EditRentalModal.tsx
  M	lib/rentalCalculations.ts
  M	lib/rentalSessions.ts
  M	lib/translations.ts
  ```

## Required change: done
`reconcileForTankCapacityChange()` (domain layer). On `null → value` or `value → different value`:

| Reading | Behaviour |
|---|---|
| Gauge/percent-derived (has a previous capacity) | Rescales to keep the observed fraction (unchanged) |
| Absolute gallons (typed, receipt) ≤ new capacity | **Preserved exactly.** Previously it went through a clamp that also rounded to 6 decimals, so `10.1234567` became `10.123457` |
| Absolute gallons > new capacity | **422 `fuel_reading_exceeds_tank_capacity`**, `field` = `pickupFuelGallons` / `currentFuelGallons`; nothing written |
| `exact` return target ≤ new capacity | Preserved exactly (previously clamped) |
| `exact` return target > new capacity | **422 `fuel_reading_exceeds_tank_capacity`**, `field` = `requiredReturnFuelGallons`; nothing written. No existing domain semantics justify lowering a user-entered target. |
| `full` target | Becomes the new capacity (derived by definition, unchanged from the earlier A1 fix) |
| `same_as_pickup` target | Follows the (preserved or rescaled) pickup reading |
| Explicit corrected value in the same request | Accepted. The explicit value is not reconciled; the route's existing check still rejects an explicit value above the effective capacity (400) |

- **Error class:** the code is added to `RentalFuelErrorCode`, with status 422 via `RentalScheduleError`. The protected create route is unchanged; it maps this class generically.
- **Edit modal:** maps the code to a specific EN/ES message ("That tank size is smaller than a fuel amount already on this rental. Check the tank size, or correct the fuel reading or return target first."). No raw code is ever shown; other errors keep the generic message.
- **Optional copy polish (applied):** the refuel-unknown note now ends "choose Full if you filled the tank, or enter the exact gallons" (ES: "…o ingresa los galones exactos").

## Other review decisions: no change needed
Tank-clear 422; the pickup-save/current-seeding rule; the quick-save zone requirement; cron `needsCarSetup` copy-only; refuel SQL (post-deploy real-Postgres check still planned); the combined A2/A3/A5 commit. All kept as approved.

## Testing (at `9c875a4`)
```
npm test          → 2072 passed / 2072 (128 files)   [was 2062]
npx tsc --noEmit   → exit 0
npm run build      → exit 0 (PWA artifacts restored/removed; tree clean)
```
- **Focused:** 461/461 across 17 files. Protected-path guard + CR-1: 61/61, re-run on the committed state.
- **New server-level tests (8),** through the real PATCH route and domain layer:
  - absolute pickup > new tank (null → value) → 422, row unchanged;
  - absolute current > reduced tank → 422;
  - absolute readings within the tank kept exactly (7+ decimals);
  - explicit corrected reading with the new tank → accepted;
  - explicit reading still too large → 400 (route, unchanged);
  - gauge/percent still rescale (20 → 14: 15 → 10.5);
  - `exact` target > reduced tank → 422;
  - `exact` target that fits is kept, and an explicit new target with the new tank is accepted.
- **Shown failing on the prior code:** 4 of the 8 (the three refusal/preservation cases plus the exact-target refusal). The other 4 assert behaviour the old code already had and still has.
- **Copy:** 2 new tests (Edit-modal mapping + EN/ES strings; refuel note mentions exact gallons).

## Known risks
- **New 422 for some tank edits that used to silently succeed.** A renter who enters a smaller tank than a reading on file now gets a refusal message instead of a silent clamp. That is the intended trade-off. Existing production rentals are unaffected unless someone edits their tank size.
- **Post-deploy checks unchanged:** signed-in production smoke test, and a refuel onto a known level on real Postgres.

## Assessment
**READY FOR REVIEW.** Recommend Don authorize push + PR (no merge) once ChatGPT confirms this delta.
