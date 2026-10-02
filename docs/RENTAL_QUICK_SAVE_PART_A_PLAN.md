# Part A Implementation Plan — Quick-Save Upcoming Rental

**Status: PLANNED** (2026-10-02). Implements §3 of `docs/RENTAL_UPCOMING_IMPORT_SPEC.md` (rev 2).
Approved to implement by the ChatGPT design review (PASS WITH CONDITIONS) and Don.

## Branch and scope
- Branch `feat/rental-quick-save` from `main` @ `eb7ef00`, in its own worktree.
- **No schema change, no migration, no production data change, no new infrastructure.**
- **No protected path touched.** The create endpoint `app/api/rental-sessions/route.ts` already requires only `rentalCompany`, so quick-save uses it unchanged. If any commit turns out to need a protected file: STOP and report.
- Cron change limited to reminder **copy** for incomplete setups, plus the fields its query must select to know that. No window, tier or dedup change.
- Stop at **READY FOR REVIEW** with a review packet; no merge.

## Commits (each test-first: regression test shown failing on the prior code)

**A1 — Tank-capacity reconciliation (domain layer)**
- Files: `lib/rentalSessions.ts` (`updateRentalSession`), `lib/rentalCalculations.ts` (pure helper for the three transitions), `app/api/rental-sessions/[id]/route.ts` (accept an explicit `null` tank).
- Behaviour per the spec §3.3 table:
  - `null→value`: recompute `full` target; clamp absolute gallons.
  - `value→value`: unchanged existing rescale.
  - `value→null`: capacity-dependent gallons (the `full` target, and gauge/percent-sourced values) become null; absolute gallons are kept.
- An explicit same-request value always wins.
- Tests: all three transitions × each policy (`same_as_pickup` / `full` / `exact`) × source (gauge / percent / gallons / receipt).

**A2 — Unknown stays unknown (null-handling audit)**
- `RentalDashboard.tsx`: tank bar, `requiredReturnFuelGallons ?? 0` in Prepare for Return, tank-size labels, status chip.
- `FuelLevelInput.tsx`: no empty "E" gauge drawn for an unknown reading.
- `lib/rentalSessions.ts` refuel: `currentFuelGallons ?? 0` + added gallons must not turn unknown into a number. Proposed: the current level stays unknown and is flagged for confirmation; the refuel is still logged and costed. See Decision 1.
- Tests: render/unit tests per path with null tank, fuel and target.

**A3 — No gauge/percent before a tank exists**
- Dashboard pickup-fuel card and Edit modal: gauge and percent modes are hidden or disabled until tank capacity is known, with a "Set the vehicle or tank size first" hint.
- The Edit modal does not offer clearing a tank while gauge/percent readings exist (spec §8.1; no behaviour change today).

**A4 — Quick-save entry path**
- New `components/rental-return/QuickSaveRentalForm.tsx`, reached via a "Booked ahead? Save it as upcoming" link beside "+ New Rental".
- Fields: company, confirmation number (optional), pickup location + date/time (**required**), return location + date/time.
- Reuses `RentalEventScheduleField` and `RentalLocationInput`, so per-event zones, DST blocking and ambiguity choices behave as in the wizard.
- Posts to the existing `POST /api/rental-sessions`. The server's Pro gate and DST/UTC derivation apply unchanged.
- `RentalSetupFlow.tsx` (the full wizard) stays functionally unchanged.

**A5 — "Finish setup" checklist**
- New `components/rental-return/FinishSetupCard.tsx` on the dashboard, shown while the vehicle, tank or pickup fuel is missing.
- Enforced order: vehicle → tank → pickup fuel. Each step opens the existing control (Edit vehicle / VIN scan, tank field, pickup-fuel card).
- Add Fuel and Prepare for Return show "Finish setup first" instead of numbers.

**A6 — Copy (EN + ES)**
- Upcoming Rental Details: "Pickup / Return" in place of "Picked Up / Returned"; completed rentals keep the past tense.
- New strings for the checklist, quick-save and gating hints.
- Fix the PR #58 smoke-test grammar slip: "3 hours behind **of** your current time zone" → "behind your" / "ahead of your".
- Cron (`app/api/cron/rental-return-reminder/route.ts`): pickup2 copy when setup is incomplete ("…finish setting up your rental at the counter: pick the car, then record the fuel") (approved by Don). Its query selects the vehicle, tank and pickup-fuel fields. Existing cron tests extended.

**A7 — Help + APP FEATURES**
- Update `app/help/page.tsx` and the `APP FEATURES` block in `app/api/ai/chat/route.ts`: quick-save, finish-at-the-counter, and no readings before the tank is known.

**A8 — Validation and review packet**
- Focused tests: rental timezone/reminder suites, new Part A suites, protected-path guard, CR-1.
- Full `npm test`, `npx tsc --noEmit`, `npm run build`; restore PWA artifacts; clean tree.
- Review packet `docs/reviews/<date>-rental-quick-save-part-a.md` (14-section template).
- Push and open the PR only on Don's go-ahead (same as PR #58).

## Decisions needed before or while building
1. **Refuel with an unknown current level (A2).** Today: current = 0 + gallons added, which invents a level. Proposed: keep the current level unknown and ask the renter to confirm it after the refuel. Alternative: treat "filled to full" as known (only if the refuel form says so; it doesn't today).
2. **Reminder copy wording (A6).** Final EN/ES text goes in the review packet for Don's sign-off before merge.

## Risks
- `RentalDashboard.tsx` is large (~1,800 lines). A2/A5 touch many render paths, so source-text guard tests may need updates. Each will be reported, not bypassed.
- Existing sessions all have a tank (the wizard required one), so A1/A2 mainly affect quick-saved rentals. Regression tests cover existing complete rentals to show no change.
- Cron copy change: do not merge during the 9:45–10:15 AM ET window.
